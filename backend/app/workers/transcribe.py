"""transcribe_session: uploaded session → transcript (docs/plans/0005-transcription.md).

Logs carry ids, sizes and durations only — never transcript text (rule 3)."""

import hashlib
import json
import logging
import time
import uuid
from collections.abc import Callable

from sqlalchemy import Engine, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session as DbSession

from app.adapters.kms import KmsProvider
from app.adapters.storage import ObjectStore
from app.adapters.stt import SttError, SttProvider
from app.core.audio_crypto import ChunkDecryptionError, decrypt_chunk
from app.core.config import get_settings
from app.core.data_crypto import encrypt_json
from app.db.models import AudioChunk, Client, Session, Transcript, WrappedKey

logger = logging.getLogger("sessio.worker.transcribe")

LANGUAGE_CODES = {"de": "de-DE", "en": "en-US"}


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


def key_aad(session_id: uuid.UUID) -> str:
    return f"session:{session_id}:processing-key"


def transcript_aad(session_id: uuid.UUID) -> str:
    return f"transcript:{session_id}:segments"


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


def _assemble_audio(
    db: DbSession, session: Session, kms: KmsProvider, store: ObjectStore
) -> bytearray:
    if session.audio_state != "present":
        raise PermanentFailure("audio_not_accepted")
    if not db.execute(
        text("SELECT client_has_recording_consent(:c)"), {"c": session.client_id}
    ).scalar_one():
        raise PermanentFailure("consent_missing")

    chunks = list(
        db.scalars(
            select(AudioChunk).where(AudioChunk.session_id == session.id).order_by(AudioChunk.seq)
        )
    )
    if session.total_chunks is None or [c.seq for c in chunks] != list(range(session.total_chunks)):
        raise PermanentFailure("incomplete_upload")

    wrapped = db.scalar(
        select(WrappedKey.ciphertext).where(
            WrappedKey.session_id == session.id, WrappedKey.kind == "processing"
        )
    )
    if wrapped is None:
        raise PermanentFailure("key_missing")
    key = kms.unwrap(bytes(wrapped), aad=key_aad(session.id))

    audio = bytearray()
    try:
        for chunk in chunks:  # strictly by seq: chunk 0 holds the container header
            ciphertext = store.get(chunk.object_key)
            if hashlib.sha256(ciphertext).hexdigest() != chunk.sha256:
                raise PermanentFailure("chunk_corrupt")
            audio += decrypt_chunk(key, str(session.id), chunk.seq, ciphertext)
    except (ChunkDecryptionError, KeyError):
        _wipe(audio)
        raise PermanentFailure("chunk_corrupt") from None
    return audio


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

    try:
        with DbSession(engine) as db:
            session = db.get(Session, session_id)
            assert session is not None
            # Column-level grant: the worker may read the language, never client identity.
            preferred = db.scalar(
                select(Client.preferred_language).where(Client.id == session.client_id)
            )
            language = LANGUAGE_CODES.get(preferred or "de", "de-DE")
            mime_type = session.mime_type or "audio/webm"
            audio = _assemble_audio(db, session, kms, store_for(db))
        size = len(audio)
        try:
            segments = stt.transcribe(
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

    if not segments:
        _fail(engine, session_id, "no_speech")
        return "failed"

    settings = get_settings()
    with DbSession(engine) as db, db.begin():
        db.execute(
            insert(Transcript)
            .values(
                session_id=session_id,
                segments_enc=encrypt_json(
                    {"segments": [s.to_json() for s in segments]}, transcript_aad(session_id)
                ),
                language=language,
                stt_model=settings.stt_model if settings.stt_provider == "google" else "fake",
            )
            .on_conflict_do_update(
                index_elements=["session_id"],
                set_={
                    "segments_enc": insert(Transcript).excluded.segments_enc,
                    "language": language,
                },
            )
        )
        session = db.get(Session, session_id)
        assert session is not None
        session.status = "transcribed"
        _audit(db, "session_transcribed", session_id)
    logger.info(
        "transcribed session_id=%s audio_bytes=%d segments=%d seconds=%.1f",
        session_id,
        size,
        len(segments),
        time.monotonic() - started,
    )
    return "transcribed"
