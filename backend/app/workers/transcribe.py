"""Transcription jobs (docs/plans/0005-transcription.md, 0006-transcribe-during-session.md).

- transcribe_windows: while recording, transcribe each new ~minute of uploaded audio.
- transcribe_session: after upload, finish the remaining windows and store the transcript;
  falls back to one BatchRecognize call if windows cannot be made.

Logs carry ids, sizes and durations only — never transcript text (rule 3)."""

import hashlib
import json
import logging
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import Engine, delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session as DbSession

from app.adapters.kms import KmsProvider
from app.adapters.storage import ObjectStore
from app.adapters.stt import SttError, SttProvider
from app.core.audio import AudioCutError, cut_to_wav, join_segments
from app.core.audio_crypto import ChunkDecryptionError, decrypt_chunk
from app.core.config import get_settings
from app.core.data_crypto import DecryptionError, decrypt_json, encrypt_json
from app.db.models import AudioChunk, Client, Session, Transcript, TranscriptWindow, WrappedKey
from app.domain.transcript import (
    CHUNK_MS,
    STEP_MS,
    Word,
    labels_in_order,
    map_speakers,
    relabel_by_reference,
    stitch,
    window_audio_range,
    windows_for_duration,
    windows_ready_while_recording,
    words_to_segments,
)

logger = logging.getLogger("sessio.worker.transcribe")

LANGUAGE_CODES = {"de": "de-DE", "en": "en-US"}
PARALLEL_WINDOWS = 4
JOINED_MIME_TYPE = "audio/webm;codecs=opus"  # several segments are re-encoded (ADR 0022)


class PermanentFailure(Exception):
    """Retrying cannot help. `code` is stored on the session and translated in the UI."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class TransientFailure(Exception):
    """Worth another attempt later (e.g. Speech-to-Text unavailable)."""


def _audit(
    db: DbSession, action: str, session_id: uuid.UUID, meta: dict[str, str] | None = None
) -> None:
    # Explicit SQL without RETURNING: the worker may append to the audit log but not read it.
    db.execute(
        text(
            "INSERT INTO audit_log (action, entity, entity_id, meta) "
            "VALUES (:action, 'session', :entity_id, CAST(:meta AS jsonb))"
        ),
        {
            "action": action,
            "entity_id": str(session_id),
            "meta": json.dumps(meta) if meta else None,
        },
    )


def notify(db: DbSession, session_id: uuid.UUID, kind: str) -> None:
    """Notification for the session's therapist (plan 0010): ids and a kind code only.
    Written in the same transaction as the state change, so exactly once per change."""
    db.execute(
        text(
            "INSERT INTO notifications (user_id, kind, session_id) "
            "SELECT user_id, :kind, id FROM sessions WHERE id = :id"
        ),
        {"kind": kind, "id": str(session_id)},
    )


def key_aad(session_id: uuid.UUID) -> str:
    return f"session:{session_id}:processing-key"


def transcript_aad(session_id: uuid.UUID) -> str:
    return f"transcript:{session_id}:segments"


def _transcript_blob(session_id: uuid.UUID, words: list[Word]) -> bytes:
    """Encrypted transcript: words (for later speaker correction) and segments (for reading)."""
    return encrypt_json(
        {
            "words": [w.to_json() for w in words],
            "segments": [s.to_json() for s in words_to_segments(words)],
        },
        transcript_aad(session_id),
    )


def find_ready(engine: Engine) -> list[uuid.UUID]:
    with DbSession(engine) as db:
        return list(db.scalars(select(Session.id).where(Session.status == "uploaded").limit(50)))


def _claim(db: DbSession, session_id: uuid.UUID) -> Session | None:
    """Mark the session `processing`. Also re-claims `processing` (worker restarted mid-job);
    the queue's job id guarantees one runner per session."""
    session = db.scalars(
        select(Session)
        .where(Session.id == session_id, Session.status.in_(("uploaded", "processing")))
        .with_for_update(skip_locked=True)
    ).first()
    if session is not None:
        session.status = "processing"
        session.failure_reason = None
    return session


def _check_processable(db: DbSession, session: Session) -> None:
    if session.audio_state != "present":
        raise PermanentFailure("audio_not_accepted")
    if not db.execute(
        text("SELECT client_has_recording_consent(:c)"), {"c": session.client_id}
    ).scalar_one():
        raise PermanentFailure("consent_missing")


def _chunks(db: DbSession, session_id: uuid.UUID) -> list[AudioChunk]:
    return list(
        db.scalars(
            select(AudioChunk).where(AudioChunk.session_id == session_id).order_by(AudioChunk.seq)
        )
    )


def _contiguous(chunks: list[AudioChunk]) -> int:
    """Number of chunks 0..n-1 without a gap (later ones may still be uploading)."""
    count = 0
    for chunk in chunks:
        if chunk.seq != count:
            break
        count += 1
    return count


def _load_audio(
    db: DbSession,
    session: Session,
    kms: KmsProvider,
    store: ObjectStore,
    chunks: list[AudioChunk],
) -> bytearray:
    """Decrypt `chunks` (must be 0..n-1) in memory and join them strictly by seq. Several
    segments (reconnected microphone, ADR 0022) are joined into one WebM/Opus file."""
    wrapped = db.scalar(
        select(WrappedKey.ciphertext).where(
            WrappedKey.session_id == session.id, WrappedKey.kind == "processing"
        )
    )
    if wrapped is None:
        raise PermanentFailure("key_missing")
    key = kms.unwrap(bytes(wrapped), aad=key_aad(session.id))

    with ThreadPoolExecutor(max_workers=8) as pool:  # object reads are network-bound
        ciphertexts = list(pool.map(lambda c: store.get(c.object_key), chunks))

    segments: list[tuple[int, int, bytearray]] = []  # (segment, start_ms, audio)
    try:
        for chunk, ciphertext in zip(chunks, ciphertexts, strict=True):
            if hashlib.sha256(ciphertext).hexdigest() != chunk.sha256:
                raise PermanentFailure("chunk_corrupt")
            if not segments or chunk.segment != segments[-1][0]:
                if segments and chunk.segment < segments[-1][0]:
                    raise PermanentFailure("chunk_corrupt")
                segments.append((chunk.segment, chunk.segment_start_ms, bytearray()))
            segments[-1][2].extend(decrypt_chunk(key, str(session.id), chunk.seq, ciphertext))
    except (ChunkDecryptionError, KeyError):
        for _, _, part in segments:
            _wipe(part)
        raise PermanentFailure("chunk_corrupt") from None
    if len(segments) <= 1:
        return segments[0][2] if segments else bytearray()
    try:
        return bytearray(join_segments([(start, bytes(part)) for _, start, part in segments]))
    except AudioCutError:
        raise PermanentFailure("audio_undecodable") from None
    finally:
        for _, _, part in segments:
            _wipe(part)


def _mime_type(session: Session, chunks: list[AudioChunk]) -> str:
    if any(chunk.segment > 0 for chunk in chunks):
        return JOINED_MIME_TYPE
    return session.mime_type or "audio/webm"


def _assemble_audio(
    db: DbSession, session: Session, kms: KmsProvider, store: ObjectStore
) -> tuple[bytearray, str]:
    """The whole session's audio and its mime type."""
    _check_processable(db, session)
    chunks = _chunks(db, session.id)
    if session.total_chunks is None or [c.seq for c in chunks] != list(range(session.total_chunks)):
        raise PermanentFailure("incomplete_upload")
    return _load_audio(db, session, kms, store, chunks), _mime_type(session, chunks)


def _language(db: DbSession, session: Session) -> str:
    # Column-level grant: the worker may read the language, never client identity.
    preferred = db.scalar(select(Client.preferred_language).where(Client.id == session.client_id))
    return LANGUAGE_CODES.get(preferred or "de", "de-DE")


# --- windows ------------------------------------------------------------------------


def window_aad(session_id: uuid.UUID, idx: int) -> str:
    return f"transcript-window:{session_id}:{idx}"


def _stored_windows(db: DbSession, session_id: uuid.UUID) -> list[list[Word]]:
    """Stored windows 0..m-1 (stops at the first gap)."""
    rows = db.scalars(
        select(TranscriptWindow)
        .where(TranscriptWindow.session_id == session_id)
        .order_by(TranscriptWindow.idx)
    )
    windows: list[list[Word]] = []
    for row in rows:
        if row.idx != len(windows):
            break
        data = decrypt_json(row.words_enc, window_aad(session_id, row.idx))
        windows.append([Word(**w) for w in data["words"]])
    return windows


def _transcribe_windows(
    audio: bytes,
    stored: list[list[Word]],
    target: int,
    stt: SttProvider,
    language: str,
) -> list[list[Word]]:
    """Make windows len(stored)..target-1. Recognition runs in parallel; speaker labels are
    then matched window by window. Returns only the new windows."""
    indices = list(range(len(stored), target))
    if not indices:
        return []
    wavs = [cut_to_wav(audio, *window_audio_range(idx)) for idx in indices]
    with ThreadPoolExecutor(max_workers=PARALLEL_WINDOWS) as pool:
        raw = list(
            pool.map(lambda wav: stt.recognize_window(wav, language=language) if wav else [], wavs)
        )
    del wavs

    done = list(stored)
    for idx, words in zip(indices, raw, strict=True):
        offset = window_audio_range(idx)[0]
        absolute = [w.shifted(offset) for w in words]
        previous = done[-1] if done else []
        known = labels_in_order(w for window in done for w in window)
        done.append(map_speakers(previous, absolute, known))
    return done[len(stored) :]


def _store_windows(
    db: DbSession, session_id: uuid.UUID, first_idx: int, windows: list[list[Word]]
) -> None:
    for offset, words in enumerate(windows):
        idx = first_idx + offset
        start, end = window_audio_range(idx)
        db.execute(
            insert(TranscriptWindow)
            .values(
                session_id=session_id,
                idx=idx,
                start_ms=start,
                end_ms=end,
                words_enc=encrypt_json(
                    {"words": [w.to_json() for w in words]}, window_aad(session_id, idx)
                ),
            )
            .on_conflict_do_nothing(index_elements=["session_id", "idx"])
        )


def find_window_work(engine: Engine) -> list[uuid.UUID]:
    """Recording sessions with at least one more window of uploaded audio than transcribed."""
    with DbSession(engine) as db:
        rows = db.execute(
            text(
                """
                SELECT s.id FROM sessions s
                WHERE s.status = 'recording' AND s.audio_state = 'present'
                  AND s.started_at > now() - interval '12 hours'
                  AND floor(greatest((SELECT count(*) FROM audio_chunks c
                                      WHERE c.session_id = s.id) - 1, 0)
                            * :chunk_ms / :step_ms)
                      > (SELECT count(*) FROM transcript_windows w WHERE w.session_id = s.id)
                LIMIT 50
                """
            ),
            {"chunk_ms": CHUNK_MS, "step_ms": STEP_MS},
        )
        return [row[0] for row in rows]


def process_windows(
    session_id: uuid.UUID,
    *,
    engine: Engine,
    store_for: Callable[[DbSession], ObjectStore],
    kms: KmsProvider,
    stt: SttProvider,
) -> str:
    """While recording: transcribe newly complete windows. Returns `windows`, `idle`,
    `skipped` or `error`; never fails the session (the final step has a fallback)."""
    started = time.monotonic()
    with DbSession(engine) as db:
        session = db.get(Session, session_id)
        if session is None or session.status != "recording":
            return "skipped"
        try:
            _check_processable(db, session)
        except PermanentFailure:
            # Consent withdrawn: transcript text made so far is deleted too (rule 10).
            db.execute(delete(TranscriptWindow).where(TranscriptWindow.session_id == session_id))
            db.commit()
            return "skipped"
        chunks = _chunks(db, session_id)
        n = _contiguous(chunks)
        stored = _stored_windows(db, session_id)
        target = windows_ready_while_recording(n)
        if target <= len(stored):
            return "idle"
        language = _language(db, session)
        try:
            audio = _load_audio(db, session, kms, store_for(db), chunks[:n])
        except PermanentFailure:
            return "error"

    try:
        new = _transcribe_windows(bytes(audio), stored, target, stt, language)
    except (AudioCutError, SttError) as error:
        logger.warning("window failed session_id=%s error=%s", session_id, type(error).__name__)
        return "error"
    finally:
        _wipe(audio)

    with DbSession(engine) as db, db.begin():
        status = db.scalar(select(Session.status).where(Session.id == session_id).with_for_update())
        if status != "recording":  # finished meanwhile; the final step makes its own windows
            return "skipped"
        _store_windows(db, session_id, len(stored), new)
    logger.info(
        "windows session_id=%s new=%d total=%d seconds=%.1f",
        session_id, len(new), len(stored) + len(new), time.monotonic() - started,
    )  # fmt: skip
    return "windows"


def _wipe(buffer: bytearray) -> None:
    """Best effort: overwrite plaintext audio before releasing it."""
    buffer[:] = bytes(len(buffer))


def _fail(engine: Engine, session_id: uuid.UUID, code: str) -> None:
    with DbSession(engine) as db, db.begin():
        session = db.get(Session, session_id)
        if session is not None and session.status == "processing":
            session.status = "failed"
            session.failure_reason = code
            _audit(db, "session_failed", session_id, {"reason": code})
            notify(db, session_id, "transcription_failed")
    logger.warning("transcription failed session_id=%s reason=%s", session_id, code)


def process_session(
    session_id: uuid.UUID,
    *,
    engine: Engine,
    store_for: Callable[[DbSession], ObjectStore],
    kms: KmsProvider,
    stt: SttProvider,
    last_attempt: bool = True,
) -> str:
    """Returns `transcribed`, `skipped` or `failed`. Raises TransientFailure to be retried."""
    started = time.monotonic()
    with DbSession(engine) as db, db.begin():
        session = _claim(db, session_id)
        if session is None:
            return "skipped"

    method = "windows"
    try:
        with DbSession(engine) as db:
            session = db.get(Session, session_id)
            assert session is not None
            language = _language(db, session)
            duration_ms = session.duration_ms or (session.total_chunks or 0) * CHUNK_MS
            audio, mime_type = _assemble_audio(db, session, kms, store_for(db))
            stored = _stored_windows(db, session_id)
        size = len(audio)
        try:
            words: list[Word] | None = None
            try:
                target = max(windows_for_duration(duration_ms), len(stored))
                new = _transcribe_windows(bytes(audio), stored, target, stt, language)
                words = stitch(stored + new)
            except (AudioCutError, SttError) as error:
                if isinstance(error, SttError) and error.retryable and not last_attempt:
                    raise
                logger.warning(
                    "windows failed, using batch session_id=%s error=%s",
                    session_id, type(error).__name__,
                )  # fmt: skip
            if words is None:
                method = "batch"
                words = stt.diarize_words(
                    bytes(audio), mime_type=mime_type, language=language, job_id=str(session_id)
                )
        finally:
            _wipe(audio)
    except PermanentFailure as failure:
        _fail(engine, session_id, failure.code)
        return "failed"
    except SttError as error:
        if error.retryable and not last_attempt:
            raise TransientFailure(str(error)) from None
        _fail(engine, session_id, "transcription_failed")
        return "failed"

    segments = words_to_segments(words)
    if not segments:
        _fail(engine, session_id, "no_speech")
        return "failed"

    # Window labels are quick but less reliable; a whole-session pass corrects them (plan 0008).
    refine_status = "pending" if method == "windows" else "skipped"
    settings = get_settings()
    with DbSession(engine) as db, db.begin():
        db.execute(
            insert(Transcript)
            .values(
                session_id=session_id,
                segments_enc=_transcript_blob(session_id, words),
                language=language,
                stt_model=settings.stt_model if settings.stt_provider == "google" else "fake",
                refine_status=refine_status,
            )
            .on_conflict_do_update(
                index_elements=["session_id"],
                set_={
                    "segments_enc": insert(Transcript).excluded.segments_enc,
                    "language": language,
                    "refine_status": refine_status,
                },
            )
        )
        db.execute(delete(TranscriptWindow).where(TranscriptWindow.session_id == session_id))
        session = db.get(Session, session_id)
        assert session is not None
        session.status = "transcribed"
        _audit(db, "session_transcribed", session_id, {"method": method})
        notify(db, session_id, "transcript_ready")
    logger.info(
        "transcribed session_id=%s method=%s audio_bytes=%d segments=%d seconds=%.1f",
        session_id,
        method,
        size,
        len(segments),
        time.monotonic() - started,
    )
    return "transcribed"


# --- speaker refinement (plan 0008 A) -------------------------------------------------


def find_refine_work(engine: Engine) -> list[uuid.UUID]:
    with DbSession(engine) as db:
        return list(
            db.scalars(
                select(Transcript.session_id)
                .join(Session, Session.id == Transcript.session_id)
                .where(Transcript.refine_status == "pending", Session.audio_state == "present")
                .limit(20)
            )
        )


def _set_refine_status(engine: Engine, session_id: uuid.UUID, status: str) -> None:
    with DbSession(engine) as db, db.begin():
        transcript = db.get(Transcript, session_id)
        if transcript is not None and transcript.refine_status == "running":
            transcript.refine_status = status


def refine_speakers(
    session_id: uuid.UUID,
    *,
    engine: Engine,
    store_for: Callable[[DbSession], ObjectStore],
    kms: KmsProvider,
    stt: SttProvider,
    last_attempt: bool = True,
) -> str:
    """Correct the speaker labels of a window transcript with one whole-session diarization.
    Only labels change, never text. Returns `done`, `skipped` or `failed`."""
    started = time.monotonic()
    with DbSession(engine) as db, db.begin():
        transcript = db.scalars(
            select(Transcript)
            .where(
                Transcript.session_id == session_id,
                Transcript.refine_status.in_(("pending", "running")),
            )
            .with_for_update(skip_locked=True)
        ).first()
        if transcript is None:
            return "skipped"
        transcript.refine_status = "running"

    try:
        with DbSession(engine) as db:
            session = db.get(Session, session_id)
            assert session is not None
            language = _language(db, session)
            audio, mime_type = _assemble_audio(db, session, kms, store_for(db))
        try:
            reference = stt.diarize_words(
                bytes(audio), mime_type=mime_type, language=language, job_id=f"{session_id}-refine"
            )
        finally:
            _wipe(audio)
    except PermanentFailure as failure:
        # Consent withdrawn or audio gone: keep the labels we have.
        _set_refine_status(engine, session_id, "skipped")
        logger.info("refine skipped session_id=%s reason=%s", session_id, failure.code)
        return "skipped"
    except SttError as error:
        if error.retryable and not last_attempt:
            _set_refine_status(engine, session_id, "pending")
            raise TransientFailure(str(error)) from None
        _set_refine_status(engine, session_id, "failed")
        logger.warning("refine failed session_id=%s error=%s", session_id, type(error).__name__)
        return "failed"

    with DbSession(engine) as db, db.begin():
        transcript = db.get(Transcript, session_id)
        # Signed meanwhile: the server copy is gone and stays gone (plan 0014).
        if (
            transcript is None
            or transcript.refine_status != "running"
            or transcript.segments_enc is None
        ):
            return "skipped"
        try:
            data = decrypt_json(transcript.segments_enc, transcript_aad(session_id))
        except DecryptionError:
            transcript.refine_status = "failed"
            return "failed"
        if not data.get("words"):
            transcript.refine_status = "skipped"
            return "skipped"
        words = [Word(**w) for w in data["words"]]
        fixed = relabel_by_reference(words, reference)
        changed = sum(1 for a, b in zip(words, fixed, strict=True) if a.speaker != b.speaker)
        transcript.segments_enc = _transcript_blob(session_id, fixed)
        transcript.refine_status = "done"
        _audit(db, "speakers_refined", session_id, {"changed_words": str(changed)})
    logger.info(
        "refined session_id=%s words=%d changed=%d seconds=%.1f",
        session_id, len(words), changed, time.monotonic() - started,
    )  # fmt: skip
    return "done"
