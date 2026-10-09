"""ORM models. `*_enc` columns hold ciphertext only — never plaintext PHI.

Enum-like columns are text + CHECK constraints so new values can be added
with an additive migration.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    MetaData,
    PrimaryKeyConstraint,
    Text,
    UniqueConstraint,
    false,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

CONSENT_KINDS = ("recording", "ai_processing", "product_improvement")
LANGUAGES = ("de", "en")
AVATAR_KINDS = ("illustrated", "drawn", "initials", "photo")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({quoted})"


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map: dict[Any, Any] = {
        uuid.UUID: UUID(as_uuid=True),
        datetime: DateTime(timezone=True),
        bytes: LargeBinary,
        dict[str, Any]: JSONB,
    }


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(Text, unique=True)
    display_name: Mapped[str] = mapped_column(Text)
    ui_language: Mapped[str] = mapped_column(Text, server_default="de")
    # Plan 0014: OpenPGP keys made in the browser. The private key is passphrase-encrypted
    # (armored); the recovery private key never reaches the server.
    pgp_public_key: Mapped[str | None] = mapped_column(Text)
    pgp_private_key_enc: Mapped[bytes | None]
    recovery_public_key: Mapped[str | None] = mapped_column(Text)
    key_fingerprints: Mapped[dict[str, Any] | None]
    # Plan 0012 / ADR 0011: profile picture. The photo is encrypted (server data key).
    avatar_kind: Mapped[str] = mapped_column(Text, server_default="illustrated")
    avatar_reactions: Mapped[bool] = mapped_column(server_default=false())
    avatar_tilt: Mapped[bool] = mapped_column(server_default=false())
    # ADR 0012: which of the three ready-made characters (Rive input `character`).
    avatar_character: Mapped[int] = mapped_column(Integer, server_default="0")
    # ADR 0013: drawn avatar description (parts + colours), never the photo.
    avatar_appearance: Mapped[dict[str, Any] | None]
    avatar_photo_enc: Mapped[bytes | None]
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (
        CheckConstraint(_in("ui_language", LANGUAGES), name="ui_language"),
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        CheckConstraint(_in("avatar_kind", AVATAR_KINDS), name="avatar_kind"),
        CheckConstraint("avatar_character BETWEEN 0 AND 2", name="avatar_character"),
        CheckConstraint(
            "avatar_kind <> 'photo' OR avatar_photo_enc IS NOT NULL", name="avatar_photo"
        ),
        CheckConstraint(
            "avatar_kind <> 'drawn' OR avatar_appearance IS NOT NULL", name="avatar_drawn"
        ),
        # Plan 0014: the keys are stored together (and only once — DB trigger).
        CheckConstraint(
            "(pgp_public_key IS NULL) = (pgp_private_key_enc IS NULL)"
            " AND (pgp_public_key IS NULL) = (recovery_public_key IS NULL)"
            " AND (pgp_public_key IS NULL) = (key_fingerprints IS NULL)",
            name="keys_complete",
        ),
    )


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    identity_enc: Mapped[bytes]
    preferred_language: Mapped[str] = mapped_column(Text, server_default="de")
    hotwords_enc: Mapped[bytes | None]
    # Plan 0009 / ADR 0007: other people's names, replaced by placeholders before the LLM call.
    hidden_names_enc: Mapped[bytes | None]
    status: Mapped[str] = mapped_column(Text, server_default="active")
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (
        CheckConstraint(_in("preferred_language", LANGUAGES), name="preferred_language"),
        CheckConstraint(_in("status", ("active", "restricted", "archived")), name="status"),
    )


class ConsentText(Base):
    """Immutable once inserted (enforced by trigger)."""

    __tablename__ = "consent_texts"

    id: Mapped[uuid.UUID] = _uuid_pk()
    kind: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer)
    language: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    published_at: Mapped[datetime] = _created_at()

    __table_args__ = (
        UniqueConstraint(
            "kind", "version", "language", name="uq_consent_texts_kind_version_language"
        ),
        CheckConstraint(_in("kind", CONSENT_KINDS), name="kind"),
        CheckConstraint(_in("language", LANGUAGES), name="language"),
    )


class Consent(Base):
    __tablename__ = "consents"

    id: Mapped[uuid.UUID] = _uuid_pk()
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), index=True)
    kind: Mapped[str] = mapped_column(Text)
    consent_text_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("consent_texts.id"))
    granted_at: Mapped[datetime] = _created_at()
    withdrawn_at: Mapped[datetime | None]
    method: Mapped[str] = mapped_column(Text)
    signature_enc: Mapped[bytes | None]
    signed_by: Mapped[str] = mapped_column(Text, server_default="client")

    __table_args__ = (
        CheckConstraint(_in("kind", CONSENT_KINDS), name="kind"),
        CheckConstraint(_in("method", ("tablet_signature", "remote_link")), name="method"),
        CheckConstraint(_in("signed_by", ("client", "guardian")), name="signed_by"),
    )


class Session(Base):
    __tablename__ = "sessions"

    # UUID v7 generated in the browser so recording works offline.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    started_at: Mapped[datetime]
    ended_at: Mapped[datetime | None]
    status: Mapped[str] = mapped_column(Text, server_default="recording")
    audio_state: Mapped[str] = mapped_column(Text, server_default="present")
    total_chunks: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger)
    template_id: Mapped[uuid.UUID | None]
    retention_deadline: Mapped[datetime]
    mime_type: Mapped[str | None] = mapped_column(Text)
    # Stable code (e.g. incomplete_upload, transcription_failed), never free text.
    failure_reason: Mapped[str | None] = mapped_column(Text)
    # Names to replace before the LLM call (ADR 0007), snapshot taken by the API.
    llm_names_enc: Mapped[bytes | None]

    __table_args__ = (
        CheckConstraint(
            _in(
                "status",
                (
                    "recording",
                    "uploaded",
                    "processing",
                    "transcribed",
                    "draft_ready",
                    "signed",
                    "failed",
                ),
            ),
            name="status",
        ),
        CheckConstraint(
            _in("audio_state", ("present", "shred_pending", "shredded")), name="audio_state"
        ),
        # Hard maximum for audio retention (rule 6). Changing it needs an explicit decision.
        CheckConstraint(
            "retention_deadline <= started_at + interval '30 days'", name="retention_max"
        ),
    )


class AudioChunk(Base):
    __tablename__ = "audio_chunks"

    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"))
    seq: Mapped[int] = mapped_column(Integer)
    object_key: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(Text)
    bytes: Mapped[int] = mapped_column(Integer)
    uploaded_at: Mapped[datetime] = _created_at()

    __table_args__ = (
        PrimaryKeyConstraint("session_id", "seq", name="pk_audio_chunks"),
        CheckConstraint("seq >= 0", name="seq_non_negative"),
    )


class WrappedKey(Base):
    __tablename__ = "wrapped_keys"

    id: Mapped[uuid.UUID] = _uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"), index=True)
    kind: Mapped[str] = mapped_column(Text)
    ciphertext: Mapped[bytes]
    kms_key_version: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (
        UniqueConstraint("session_id", "kind", name="uq_wrapped_keys_session_id_kind"),
        CheckConstraint(_in("kind", ("therapist", "processing")), name="kind"),
    )


class AuditLog(Base):
    """Append-only (enforced by trigger). IDs only, no PHI in `meta`."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = _created_at()
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(Text)
    entity: Mapped[str] = mapped_column(Text)
    entity_id: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict[str, Any] | None]


class LoginCode(Base):
    """One-time email code. Holds only HMACs, no user data, so no RLS."""

    __tablename__ = "login_codes"

    id: Mapped[uuid.UUID] = _uuid_pk()
    email_hash: Mapped[str] = mapped_column(Text, index=True)
    code_hash: Mapped[str] = mapped_column(Text)
    ip_hash: Mapped[str | None] = mapped_column(Text, index=True)
    created_at: Mapped[datetime] = _created_at()
    expires_at: Mapped[datetime]
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    consumed_at: Mapped[datetime | None]


class AuthSession(Base):
    """A login session of a user (therapist). Not a therapy `Session`."""

    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = _created_at()
    last_seen_at: Mapped[datetime] = _created_at()
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]

    __table_args__ = (
        CheckConstraint("expires_at <= created_at + interval '12 hours'", name="max_lifetime"),
    )


class ObjectBlob(Base):
    """Interim encrypted object storage until GCS (plan 0004). Ciphertext only."""

    __tablename__ = "object_blobs"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"), index=True)
    data: Mapped[bytes]
    created_at: Mapped[datetime] = _created_at()


class Transcript(Base):
    """Final transcript of a session. Segments are encrypted (interim key, ADR 0004)."""

    __tablename__ = "transcripts"

    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"), primary_key=True)
    segments_enc: Mapped[bytes]
    # Which speaker label is the therapist, e.g. {"therapist": "1"}; set by the therapist.
    speaker_roles: Mapped[dict[str, Any] | None]
    language: Mapped[str] = mapped_column(Text)
    stt_model: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    # Plan 0008: whole-session speaker check after the quick window transcript.
    refine_status: Mapped[str] = mapped_column(Text, server_default="skipped")
    # Therapist's speaker corrections, applied on read (times and labels only, no text).
    speaker_overrides: Mapped[list[Any] | None] = mapped_column(JSONB)
    # Turns the therapist left out of the AI draft, as [start_ms, end_ms] ranges (ADR 0018).
    # The text itself stays in the record; times only, no text.
    excluded_ranges: Mapped[list[Any] | None] = mapped_column(JSONB)

    __table_args__ = (
        CheckConstraint(
            _in("refine_status", ("pending", "running", "done", "failed", "skipped")),
            name="refine_status",
        ),
    )


class TranscriptWindow(Base):
    """About one minute of transcript made while the session is still recording (plan 0006).
    Words are encrypted; rows are deleted once the final transcript is stored."""

    __tablename__ = "transcript_windows"

    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"))
    idx: Mapped[int] = mapped_column(Integer)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    words_enc: Mapped[bytes]
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (PrimaryKeyConstraint("session_id", "idx", name="pk_transcript_windows"),)


class Capture(Base):
    """A documentation chip for a session (plan 0007): task, appointment, term or bookmark.
    Suggested by fixed keyword rules or the bookmark button; the therapist confirms or
    dismisses it. Text is encrypted. Never sentiment, mood or risk."""

    __tablename__ = "captures"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"), index=True)
    kind: Mapped[str] = mapped_column(Text)
    # Stable per session (kind + time), so a suggestion is decided only once.
    key: Mapped[str] = mapped_column(Text)
    at_ms: Mapped[int] = mapped_column(Integer)
    payload_enc: Mapped[bytes]
    status: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (
        UniqueConstraint("session_id", "key", name="uq_captures_session_id_key"),
        CheckConstraint(_in("kind", ("action_item", "date", "term", "bookmark")), name="kind"),
        CheckConstraint(_in("status", ("suggested", "confirmed", "dismissed")), name="status"),
    )


REPORT_STATUSES = ("pending", "drafting", "draft", "approved", "failed", "no_consent")


class Report(Base):
    """Session note (plan 0009). `draft_enc` is what the AI wrote (kept unchanged),
    `content_enc` the therapist's current text. Read-only once approved (DB trigger)."""

    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = _uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"))
    kind: Mapped[str] = mapped_column(Text, server_default="session_note")
    template_code: Mapped[str] = mapped_column(Text)
    template_version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text)
    # Set when only one AI field is to be drafted again.
    pending_field: Mapped[str | None] = mapped_column(Text)
    draft_enc: Mapped[bytes | None]
    content_enc: Mapped[bytes | None]
    llm_model: Mapped[str | None] = mapped_column(Text)
    prompt_version: Mapped[str | None] = mapped_column(Text)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _created_at()
    approved_at: Mapped[datetime | None]
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))

    __table_args__ = (
        UniqueConstraint("session_id", "kind", name="uq_reports_session_id_kind"),
        CheckConstraint(_in("kind", ("session_note",)), name="kind"),
        CheckConstraint(_in("status", REPORT_STATUSES), name="status"),
        CheckConstraint(
            "status <> 'approved' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)",
            name="approval_complete",
        ),
    )


class ReportVersion(Base):
    """Append-only (DB trigger): version 1 is the approved note, later ones are addenda."""

    __tablename__ = "report_versions"

    report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reports.id"))
    version: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(Text)
    content_enc: Mapped[bytes]
    created_at: Mapped[datetime] = _created_at()
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))

    __table_args__ = (
        PrimaryKeyConstraint("report_id", "version", name="pk_report_versions"),
        CheckConstraint(_in("kind", ("approval", "addendum")), name="kind"),
        CheckConstraint("version >= 1", name="version_positive"),
    )


NOTIFICATION_KINDS = (
    "transcript_ready",
    "transcription_failed",
    "report_ready",
    "report_failed",
    "report_no_consent",
)


class Notification(Base):
    """A background event for the therapist (plan 0010). Ids and a kind code only — no PHI."""

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(Text)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"))
    created_at: Mapped[datetime] = _created_at()
    read_at: Mapped[datetime | None]

    __table_args__ = (
        CheckConstraint(_in("kind", NOTIFICATION_KINDS), name="kind"),
        Index("ix_notifications_user_id_created_at", "user_id", "created_at"),
    )
