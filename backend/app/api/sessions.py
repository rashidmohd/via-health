"""Therapy sessions: start, session key, encrypted chunk upload, finish (plan 0004)."""

import base64
import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, Path, Request
from pydantic import AfterValidator, BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session as DbSession

from app.adapters.kms import KmsProvider, get_kms
from app.adapters.storage import ObjectStore, make_object_store
from app.api.deps import CurrentUserId, Db
from app.api.errors import ApiError
from app.core.data_crypto import DecryptionError, decrypt_json, encrypt_json
from app.db.models import (
    AudioChunk,
    AuditLog,
    Capture,
    Client,
    Report,
    Session,
    Transcript,
    TranscriptWindow,
    User,
    WrappedKey,
)
from app.domain.report_draft import NameList, names_aad, report_aad
from app.domain.transcript import (
    MAX_OVERRIDES,
    STEP_MS,
    Segment,
    Word,
    apply_corrections,
    stitch,
    words_to_segments,
)

router = APIRouter(tags=["sessions"])

MAX_CHUNK_BYTES = 1_000_000
MAX_SESSION_AGE = timedelta(days=30)
AUDIO_RETENTION = timedelta(days=30)  # hard max, also a DB CHECK (rule 6)
MimeType = Literal["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]


def get_object_store(db: Db) -> ObjectStore:
    return make_object_store(db)


Store = Annotated[ObjectStore, Depends(get_object_store)]
Kms = Annotated[KmsProvider, Depends(get_kms)]


class SessionStart(BaseModel):
    id: uuid.UUID  # UUIDv7 from the browser, so sessions can start offline
    client_id: uuid.UUID
    started_at: datetime
    mime_type: MimeType

    @field_validator("started_at")
    @classmethod
    def plausible_start(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("timezone required")
        now = datetime.now(UTC)
        if not now - MAX_SESSION_AGE <= value <= now + timedelta(minutes=5):
            raise ValueError("out of range")
        return value


PGP_MESSAGE_HEADER = "-----BEGIN PGP MESSAGE-----"


def armored_message(value: str) -> str:
    """Armored OpenPGP message, made in the browser. The server stores it and never parses it."""
    if not value.lstrip().startswith(PGP_MESSAGE_HEADER):
        raise ValueError("not an armored PGP message")
    return value


class SessionKey(BaseModel):
    key: str  # base64 raw AES-256 key
    # Plan 0014 step C: the same key, encrypted in the browser to the therapist public key, so
    # the audio stays readable to the therapist once the processing key is destroyed.
    therapist_key: (
        Annotated[str, Field(max_length=8_000), AfterValidator(armored_message)] | None
    ) = None

    @field_validator("key")
    @classmethod
    def thirty_two_bytes(cls, value: str) -> str:
        try:
            if len(base64.b64decode(value, validate=True)) == 32:
                return value
        except ValueError:
            pass
        raise ValueError("expected 32 bytes")


class SessionFinish(BaseModel):
    total_chunks: Annotated[int, Field(ge=0, le=100_000)]
    duration_ms: Annotated[int, Field(ge=0, le=24 * 3600 * 1000)]
    ended_at: datetime


class SessionOut(BaseModel):
    id: uuid.UUID
    client_id: uuid.UUID
    client_name: str
    started_at: datetime
    ended_at: datetime | None
    status: str
    audio_state: str
    duration_ms: int | None
    total_chunks: int | None
    uploaded_chunks: int
    failure_reason: str | None
    # While recording: how much audio is already transcribed (plan 0006).
    transcribed_ms: int
    # Session note status (plan 0009); None = not started.
    report_status: str | None
    # The note's "topics" field, short, for the session card. Empty unless draft/approved.
    report_topics: list[str]


def _key_aad(session_id: uuid.UUID) -> str:
    return f"session:{session_id}:processing-key"


def _get_session(db: DbSession, session_id: uuid.UUID) -> Session:
    session = db.get(Session, session_id)  # RLS: only the user's own sessions
    if session is None:
        raise ApiError("session_not_found", 404)
    return session


def _uploaded(db: DbSession, session_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).where(AudioChunk.session_id == session_id)) or 0


def _maybe_complete(db: DbSession, session: Session) -> None:
    if (
        session.status == "recording"
        and session.total_chunks is not None
        and _uploaded(db, session.id) >= session.total_chunks
    ):
        session.status = "uploaded"


def _client_name(client: Client | None) -> str:
    if client is None:
        return ""
    try:
        return str(decrypt_json(client.identity_enc, f"client:{client.id}:identity")["name"])
    except DecryptionError:
        return ""


def hidden_names_aad(client_id: uuid.UUID) -> str:
    return f"client:{client_id}:hidden-names"


def hidden_names(client: Client) -> list[str]:
    if client.hidden_names_enc is None:
        return []
    data = decrypt_json(client.hidden_names_enc, hidden_names_aad(client.id))
    return [str(n) for n in data.get("names", [])]


def snapshot_llm_names(db: DbSession, session: Session) -> None:
    """Names to replace before the LLM call (ADR 0007): client, therapist, "names to hide".
    Stored per session so the worker never needs to read client identity."""
    client = db.get(Client, session.client_id)
    user = db.get(User, session.user_id)
    names = NameList(
        client=[n for n in [_client_name(client)] if n],
        therapist=[user.display_name] if user is not None and user.display_name else [],
        others=hidden_names(client) if client is not None else [],
    )
    session.llm_names_enc = encrypt_json(names.to_json(), names_aad(session.id))


CARD_TOPICS = 5
CARD_TOPIC_CHARS = 80


def _report_card(db: DbSession, session_id: uuid.UUID) -> tuple[str | None, list[str]]:
    """Note status and its topics (same text as in the note, never a separate AI summary)."""
    report = db.scalar(select(Report).where(Report.session_id == session_id))
    if report is None:
        return None, []
    if report.status not in ("draft", "approved") or report.content_enc is None:
        return report.status, []
    try:
        content = decrypt_json(report.content_enc, report_aad(report.id, "content"))
    except DecryptionError:
        return report.status, []
    return report.status, card_topics(content)


def card_topics(content: dict[str, Any]) -> list[str]:
    """The note's topics, shortened for a list row."""
    statements = content.get("ai", {}).get("topics", {}).get("statements", [])
    topics = [str(s.get("text", "")).strip() for s in statements][:CARD_TOPICS]
    return [
        t if len(t) <= CARD_TOPIC_CHARS else t[: CARD_TOPIC_CHARS - 1].rstrip() + "…"
        for t in topics
        if t
    ]


def _out(db: DbSession, session: Session) -> SessionOut:
    report_status, report_topics = _report_card(db, session.id)
    return SessionOut(
        id=session.id,
        client_id=session.client_id,
        client_name=_client_name(db.get(Client, session.client_id)),
        started_at=session.started_at,
        ended_at=session.ended_at,
        status=session.status,
        audio_state=session.audio_state,
        duration_ms=session.duration_ms,
        total_chunks=session.total_chunks,
        uploaded_chunks=_uploaded(db, session.id),
        failure_reason=session.failure_reason,
        transcribed_ms=(
            db.scalar(select(func.count()).where(TranscriptWindow.session_id == session.id)) or 0
        )
        * STEP_MS,
        report_status=report_status,
        report_topics=report_topics,
    )


@router.post("/sessions", status_code=201)
def start_session(body: SessionStart, user_id: CurrentUserId, db: Db) -> SessionOut:
    existing = db.get(Session, body.id)
    if existing is not None:  # retry after a dropped connection
        if existing.client_id != body.client_id:
            raise ApiError("session_conflict", 409)
        return _out(db, existing)
    if db.get(Client, body.client_id) is None:
        raise ApiError("client_not_found", 404)
    session = Session(
        id=body.id,
        client_id=body.client_id,
        user_id=user_id,
        started_at=body.started_at,
        retention_deadline=body.started_at + AUDIO_RETENTION,
        mime_type=body.mime_type,
    )
    db.add(session)
    db.flush()  # DB trigger enforces consent (rule 8)
    snapshot_llm_names(db, session)
    db.add(
        AuditLog(
            actor_user_id=user_id,
            action="session_started",
            entity="session",
            entity_id=str(session.id),
        )
    )
    return _out(db, session)


def _store_therapist_key(db: DbSession, session: Session, armored: str) -> None:
    """Idempotent: a retry sends the same message again."""
    ciphertext = armored.encode()
    existing = db.scalar(
        select(WrappedKey).where(
            WrappedKey.session_id == session.id, WrappedKey.kind == "therapist"
        )
    )
    if existing is not None:
        if existing.ciphertext != ciphertext:
            raise ApiError("key_conflict", 409)
        return
    if session.audio_state != "present":
        raise ApiError("audio_not_accepted", 409)
    db.add(WrappedKey(session_id=session.id, kind="therapist", ciphertext=ciphertext))


@router.post("/sessions/{session_id}/key", status_code=204)
def store_session_key(
    session_id: uuid.UUID, body: SessionKey, user_id: CurrentUserId, db: Db, kms: Kms
) -> None:
    session = _get_session(db, session_id)
    if body.therapist_key is not None:
        _store_therapist_key(db, session, body.therapist_key)
    raw = base64.b64decode(body.key)
    aad = _key_aad(session.id)
    existing = db.scalar(
        select(WrappedKey).where(
            WrappedKey.session_id == session.id, WrappedKey.kind == "processing"
        )
    )
    if existing is not None:
        if kms.unwrap(existing.ciphertext, aad=aad) != raw:
            raise ApiError("key_conflict", 409)
        return
    if session.audio_state != "present":
        raise ApiError("audio_not_accepted", 409)
    db.add(WrappedKey(session_id=session.id, kind="processing", ciphertext=kms.wrap(raw, aad=aad)))


async def chunk_body(
    request: Request,
    content_sha256: Annotated[str, Header(alias="X-Content-SHA256", pattern=r"^[0-9a-f]{64}$")],
) -> bytes:
    """Read the ciphertext with a size limit and verify its checksum."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_CHUNK_BYTES:
        raise ApiError("chunk_too_large", 413)
    body = bytearray()
    async for part in request.stream():
        body += part
        if len(body) > MAX_CHUNK_BYTES:
            raise ApiError("chunk_too_large", 413)
    data = bytes(body)
    if not data or hashlib.sha256(data).hexdigest() != content_sha256:
        raise ApiError("checksum_mismatch", 400)
    return data


@router.put("/sessions/{session_id}/chunks/{seq}", status_code=204)
def upload_chunk(
    session_id: uuid.UUID,
    seq: Annotated[int, Path(ge=0, le=100_000)],
    data: Annotated[bytes, Depends(chunk_body)],
    user_id: CurrentUserId,
    db: Db,
    store: Store,
) -> None:
    content_sha256 = hashlib.sha256(data).hexdigest()
    session = _get_session(db, session_id)
    if session.total_chunks is not None and seq >= session.total_chunks:
        raise ApiError("chunk_out_of_range", 409)
    key = f"sessions/{session.id}/{seq:06d}"
    inserted = db.execute(
        insert(AudioChunk)
        .values(
            session_id=session.id, seq=seq, object_key=key, sha256=content_sha256, bytes=len(data)
        )
        .returning(AudioChunk.seq)
    ).first()  # DB trigger: consent check; identical re-upload is a no-op
    if inserted is not None:
        store.put(key, data)
    _maybe_complete(db, session)


@router.post("/sessions/{session_id}/finish")
def finish_session(
    session_id: uuid.UUID, body: SessionFinish, user_id: CurrentUserId, db: Db
) -> SessionOut:
    session = _get_session(db, session_id)
    if session.total_chunks is not None and session.total_chunks != body.total_chunks:
        raise ApiError("session_conflict", 409)
    if body.ended_at < session.started_at:
        raise ApiError("invalid_input", 422)
    session.total_chunks = body.total_chunks
    session.duration_ms = body.duration_ms
    session.ended_at = body.ended_at
    _maybe_complete(db, session)
    db.flush()
    return _out(db, session)


@router.get("/sessions")
def list_sessions(
    user_id: CurrentUserId, db: Db, client_id: uuid.UUID | None = None
) -> list[SessionOut]:
    query = select(Session).order_by(Session.started_at.desc()).limit(200)
    if client_id is not None:
        query = query.where(Session.client_id == client_id)
    return [_out(db, s) for s in db.scalars(query)]


class TranscriptSegment(BaseModel):
    speaker: str | None
    start_ms: int
    end_ms: int
    text: str
    # Left out of the AI draft by the therapist (ADR 0018); still part of the record.
    excluded: bool = False


class TranscriptOut(BaseModel):
    session_id: uuid.UUID
    language: str
    stt_model: str
    therapist_speaker: str | None
    segments: list[TranscriptSegment]
    # Plan 0008: whole-session speaker check (pending/running/done/failed/skipped).
    refine_status: str
    corrections: int


class TranscriptUpdate(BaseModel):
    therapist_speaker: Annotated[str, Field(min_length=1, max_length=10)]


def transcript_out(transcript: Transcript) -> TranscriptOut:
    if transcript.segments_enc is None:  # signed: only the therapist can read it (plan 0014)
        raise ApiError("record_signed", 409)
    data = decrypt_json(transcript.segments_enc, f"transcript:{transcript.session_id}:segments")
    if data.get("words"):
        base = words_to_segments(Word(**w) for w in data["words"])
    else:
        base = [Segment(**segment) for segment in data["segments"]]
    overrides = transcript.speaker_overrides or []
    roles = transcript.speaker_roles or {}
    return TranscriptOut(
        session_id=transcript.session_id,
        language=transcript.language,
        stt_model=transcript.stt_model,
        therapist_speaker=roles.get("therapist"),
        segments=[
            TranscriptSegment(**s.to_json(), excluded=out)
            for s, out in apply_corrections(base, overrides, transcript.excluded_ranges or [])
        ],
        refine_status=transcript.refine_status,
        corrections=len(overrides),
    )


@router.get("/sessions/{session_id}")
def get_session(session_id: uuid.UUID, user_id: CurrentUserId, db: Db) -> SessionOut:
    return _out(db, _get_session(db, session_id))


@router.get("/sessions/{session_id}/transcript")
def get_transcript(session_id: uuid.UUID, user_id: CurrentUserId, db: Db) -> TranscriptOut:
    _get_session(db, session_id)
    transcript = db.get(Transcript, session_id)
    if transcript is None:
        raise ApiError("transcript_not_ready", 404)
    return transcript_out(transcript)


@router.patch("/sessions/{session_id}/transcript")
def update_transcript(
    session_id: uuid.UUID, body: TranscriptUpdate, user_id: CurrentUserId, db: Db
) -> TranscriptOut:
    """The therapist says which speaker label is them; the other is the client."""
    transcript = _own_transcript(db, session_id)
    transcript.speaker_roles = {"therapist": body.therapist_speaker}
    db.flush()
    return transcript_out(transcript)


SpeakerLabel = Annotated[str, Field(min_length=1, max_length=10)]


class SetSpeaker(BaseModel):
    op: Literal["set"]
    at_ms: Annotated[int, Field(ge=0, le=24 * 3600 * 1000)]
    speaker: SpeakerLabel


class SwapFrom(BaseModel):
    op: Literal["swap_from"]
    at_ms: Annotated[int, Field(ge=0, le=24 * 3600 * 1000)]
    a: SpeakerLabel
    b: SpeakerLabel


class SpeakerCorrection(BaseModel):
    correction: Annotated[SetSpeaker | SwapFrom, Field(discriminator="op")]


def _own_transcript(db: DbSession, session_id: uuid.UUID) -> Transcript:
    _get_session(db, session_id)
    transcript = db.get(Transcript, session_id)
    if transcript is None:
        raise ApiError("transcript_not_ready", 404)
    if transcript.segments_enc is None:
        raise ApiError("record_signed", 409)
    return transcript


@router.post("/sessions/{session_id}/transcript/speakers")
def correct_speakers(
    session_id: uuid.UUID, body: SpeakerCorrection, user_id: CurrentUserId, db: Db
) -> TranscriptOut:
    """The therapist corrects who said what (plan 0008 B). Applied on read, after any automatic
    refinement, so manual corrections always win."""
    transcript = _own_transcript(db, session_id)
    overrides = list(transcript.speaker_overrides or [])
    if len(overrides) >= MAX_OVERRIDES:
        raise ApiError("too_many_corrections", 409)
    transcript.speaker_overrides = [*overrides, body.correction.model_dump()]
    db.flush()
    return transcript_out(transcript)


@router.post("/sessions/{session_id}/transcript/speakers/undo")
def undo_speaker_correction(session_id: uuid.UUID, user_id: CurrentUserId, db: Db) -> TranscriptOut:
    transcript = _own_transcript(db, session_id)
    transcript.speaker_overrides = list(transcript.speaker_overrides or [])[:-1]
    db.flush()
    return transcript_out(transcript)


Ms = Annotated[int, Field(ge=0, le=24 * 3600 * 1000)]


class TurnExclusion(BaseModel):
    start_ms: Ms
    end_ms: Ms
    excluded: bool


@router.post("/sessions/{session_id}/transcript/exclusions")
def set_turn_excluded(
    session_id: uuid.UUID, body: TurnExclusion, user_id: CurrentUserId, db: Db
) -> TranscriptOut:
    """Leave a turn out of the AI draft, or include it again (ADR 0018). Only times are
    stored; the text stays in the record. Locked while a draft is written and after approval."""
    transcript = _own_transcript(db, session_id)
    status = db.scalar(select(Report.status).where(Report.session_id == session_id))
    if status in ("approved", "signed"):
        raise ApiError("report_approved", 409)
    if status in ("pending", "drafting"):
        raise ApiError("report_busy", 409)
    if body.end_ms < body.start_ms:
        raise ApiError("invalid_input", 422)
    ranges = list(transcript.excluded_ranges or [])
    if body.excluded:
        if len(ranges) >= MAX_OVERRIDES:
            raise ApiError("too_many_corrections", 409)
        ranges.append([body.start_ms, body.end_ms])
    else:
        ranges = [[a, b] for a, b in ranges if b < body.start_ms or a > body.end_ms]
    transcript.excluded_ranges = ranges
    db.add(
        AuditLog(
            actor_user_id=user_id,
            action="transcript_turn_excluded" if body.excluded else "transcript_turn_included",
            entity="session",
            entity_id=str(session_id),
        )
    )
    db.flush()
    return transcript_out(transcript)


@router.post("/sessions/{session_id}/retry")
def retry_session(session_id: uuid.UUID, user_id: CurrentUserId, db: Db) -> SessionOut:
    session = _get_session(db, session_id)
    if session.status != "failed":
        raise ApiError("session_not_failed", 409)
    if session.audio_state != "present":
        raise ApiError("audio_not_accepted", 409)
    session.status = "uploaded"  # the worker picks it up within 15 s
    session.failure_reason = None
    db.add(
        AuditLog(
            actor_user_id=user_id,
            action="session_retry",
            entity="session",
            entity_id=str(session.id),
        )
    )
    db.flush()
    return _out(db, session)


# --- live text while recording (plan 0007, part 1) ------------------------------------


class LiveOut(BaseModel):
    covered_ms: int
    segments: list[TranscriptSegment]


@router.get("/sessions/{session_id}/live")
def live_text(session_id: uuid.UUID, user_id: CurrentUserId, db: Db) -> LiveOut:
    """Transcript windows made so far, stitched. About one window behind speech."""
    _get_session(db, session_id)
    rows = list(
        db.scalars(
            select(TranscriptWindow)
            .where(TranscriptWindow.session_id == session_id)
            .order_by(TranscriptWindow.idx)
        )
    )
    windows: list[list[Word]] = []
    for row in rows:
        if row.idx != len(windows):
            break
        data = decrypt_json(row.words_enc, f"transcript-window:{session_id}:{row.idx}")
        windows.append([Word(**w) for w in data["words"]])
    segments = words_to_segments(stitch(windows))
    return LiveOut(
        covered_ms=len(windows) * STEP_MS,
        segments=[TranscriptSegment(**s.to_json()) for s in segments],
    )


# --- captures (documentation chips, plan 0007, part 3) --------------------------------

CaptureKind = Literal["action_item", "date", "term", "bookmark"]
CaptureStatus = Literal["suggested", "confirmed", "dismissed"]


class CaptureIn(BaseModel):
    id: uuid.UUID
    kind: CaptureKind
    key: Annotated[str, Field(min_length=1, max_length=100)]
    at_ms: Annotated[int, Field(ge=0, le=24 * 3600 * 1000)]
    text: Annotated[str, Field(max_length=500)] = ""
    status: CaptureStatus


class CaptureUpdate(BaseModel):
    status: CaptureStatus
    text: Annotated[str, Field(max_length=500)] | None = None


class CaptureOut(BaseModel):
    id: uuid.UUID
    kind: CaptureKind
    key: str
    at_ms: int
    text: str
    status: CaptureStatus


def _capture_aad(capture_id: uuid.UUID) -> str:
    return f"capture:{capture_id}:payload"


def _capture_out(capture: Capture) -> CaptureOut:
    payload = decrypt_json(capture.payload_enc, _capture_aad(capture.id))
    return CaptureOut(
        id=capture.id,
        kind=capture.kind,
        key=capture.key,
        at_ms=capture.at_ms,
        text=payload.get("text", ""),
        status=capture.status,
    )


@router.get("/sessions/{session_id}/captures")
def list_captures(session_id: uuid.UUID, user_id: CurrentUserId, db: Db) -> list[CaptureOut]:
    _get_session(db, session_id)
    rows = db.scalars(
        select(Capture).where(Capture.session_id == session_id).order_by(Capture.at_ms)
    )
    return [_capture_out(c) for c in rows]


@router.post("/sessions/{session_id}/captures")
def save_capture(
    session_id: uuid.UUID, body: CaptureIn, user_id: CurrentUserId, db: Db
) -> CaptureOut:
    """Create or update by key. Idempotent: the browser may send the same capture again."""
    _get_session(db, session_id)
    existing = db.scalar(
        select(Capture).where(Capture.session_id == session_id, Capture.key == body.key)
    )
    if existing is not None:
        existing.status = body.status
        existing.payload_enc = encrypt_json({"text": body.text}, _capture_aad(existing.id))
        db.flush()
        return _capture_out(existing)
    if db.get(Capture, body.id) is not None:
        raise ApiError("capture_conflict", 409)
    capture = Capture(
        id=body.id,
        session_id=session_id,
        kind=body.kind,
        key=body.key,
        at_ms=body.at_ms,
        payload_enc=encrypt_json({"text": body.text}, _capture_aad(body.id)),
        status=body.status,
    )
    db.add(capture)
    db.flush()
    return _capture_out(capture)


@router.patch("/captures/{capture_id}")
def update_capture(
    capture_id: uuid.UUID, body: CaptureUpdate, user_id: CurrentUserId, db: Db
) -> CaptureOut:
    capture = db.get(Capture, capture_id)  # RLS: only own sessions
    if capture is None:
        raise ApiError("capture_not_found", 404)
    capture.status = body.status
    if body.text is not None:
        capture.payload_enc = encrypt_json({"text": body.text}, _capture_aad(capture.id))
    db.flush()
    return _capture_out(capture)
