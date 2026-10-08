"""Therapy sessions: start, session key, encrypted chunk upload, finish (plan 0004)."""

import base64
import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Path, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session as DbSession

from app.adapters.kms import KmsProvider, get_kms
from app.adapters.storage import ObjectStore, make_object_store
from app.api.deps import CurrentUserId, Db
from app.api.errors import ApiError
from app.core.data_crypto import DecryptionError, decrypt_json
from app.db.models import (
    AudioChunk,
    AuditLog,
    Client,
    Session,
    Transcript,
    TranscriptWindow,
    WrappedKey,
)
from app.domain.transcript import STEP_MS

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


class SessionKey(BaseModel):
    key: str  # base64 raw AES-256 key

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


def _out(db: DbSession, session: Session) -> SessionOut:
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
    db.add(
        AuditLog(
            actor_user_id=user_id,
            action="session_started",
            entity="session",
            entity_id=str(session.id),
        )
    )
    return _out(db, session)


@router.post("/sessions/{session_id}/key", status_code=204)
def store_session_key(
    session_id: uuid.UUID, body: SessionKey, user_id: CurrentUserId, db: Db, kms: Kms
) -> None:
    session = _get_session(db, session_id)
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


class TranscriptOut(BaseModel):
    session_id: uuid.UUID
    language: str
    stt_model: str
    therapist_speaker: str | None
    segments: list[TranscriptSegment]


class TranscriptUpdate(BaseModel):
    therapist_speaker: Annotated[str, Field(min_length=1, max_length=10)]


def _transcript_out(transcript: Transcript) -> TranscriptOut:
    data = decrypt_json(transcript.segments_enc, f"transcript:{transcript.session_id}:segments")
    roles = transcript.speaker_roles or {}
    return TranscriptOut(
        session_id=transcript.session_id,
        language=transcript.language,
        stt_model=transcript.stt_model,
        therapist_speaker=roles.get("therapist"),
        segments=[TranscriptSegment(**segment) for segment in data["segments"]],
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
    return _transcript_out(transcript)


@router.patch("/sessions/{session_id}/transcript")
def update_transcript(
    session_id: uuid.UUID, body: TranscriptUpdate, user_id: CurrentUserId, db: Db
) -> TranscriptOut:
    """The therapist says which speaker label is them; the other is the client."""
    _get_session(db, session_id)
    transcript = db.get(Transcript, session_id)
    if transcript is None:
        raise ApiError("transcript_not_ready", 404)
    transcript.speaker_roles = {"therapist": body.therapist_speaker}
    db.flush()
    return _transcript_out(transcript)


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
