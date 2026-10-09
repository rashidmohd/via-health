"""Session note: AI draft, therapist edits, signing, addenda (plans 0009, 0014).

The browser may change text and mark AI statements as resolved, but never their sources or
check results: those are taken from the stored AI draft. Approving a note means signing it
(rule 7): the browser signs the note, its transcript and a small index with the therapist key
and encrypts them to the therapist and recovery keys. The server stores the messages, drops its
readable copies and the processing key in the same transaction, and cannot read the record
afterwards. A signed note is read-only (DB trigger); later changes are signed, dated addenda
(§630f BGB). Notes approved before signing existed can be signed later ("sealed")."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter
from pydantic import AfterValidator, BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DbSession

from app.api.deps import CurrentUserId, Db
from app.api.errors import ApiError
from app.api.sessions import (
    _client_name,
    _get_session,
    armored_message,
    card_topics,
    snapshot_llm_names,
    transcript_out,
)
from app.core.data_crypto import decrypt_json, encrypt_json
from app.db.models import (
    AuditLog,
    Client,
    Report,
    ReportVersion,
    Session,
    Transcript,
    TranscriptWindow,
    User,
    WrappedKey,
)
from app.domain.report_draft import default_content, is_blocking, report_aad, wording_hits
from app.domain.report_template import (
    AI_FIELDS,
    TEMPLATE_CODE,
    TEMPLATE_VERSION,
    THERAPIST_FIELDS,
)

router = APIRouter(tags=["reports"])

AiField = Literal[
    "homework_followup",
    "current_situation",
    "topics",
    "interventions",
    "agreements",
    "next_session",
]
TherapistField = Literal["mental_status", "understanding", "progress", "crisis", "notable"]
SessionType = Literal[
    "consultation",
    "probatory",
    "acute",
    "short_term",
    "long_term",
    "relapse_prevention",
    "significant_others",
    "other",
]
EDITABLE = ("draft", "failed", "no_consent")
ReportStatus = Literal[
    "none", "pending", "drafting", "draft", "approved", "failed", "no_consent", "signed"
]
StatementId = Annotated[str, Field(pattern=r"^[0-9a-f]{12}$")]


class Header(BaseModel):
    session_type: SessionType | None = None
    session_no: Annotated[str, Field(max_length=20)] | None = None
    setting: Literal["individual", "couple", "family", "group"] = "individual"
    mode: Literal["in_person", "video"] = "in_person"
    attendees_extra: Annotated[str, Field(max_length=200)] = ""
    location: Annotated[str, Field(max_length=200)] = ""


class StatementIn(BaseModel):
    id: StatementId
    text: Annotated[str, Field(min_length=1, max_length=1000)]
    resolved: bool = False


class AiFieldIn(BaseModel):
    statements: Annotated[list[StatementIn], Field(max_length=30)]


class ContentIn(BaseModel):
    header: Header
    ai: dict[AiField, AiFieldIn]
    therapist: dict[TherapistField, Annotated[str, Field(max_length=5000)]]


class StatementOut(BaseModel):
    id: str
    text: str
    kind: str | None
    origin: Literal["ai", "therapist"]
    refs: list[tuple[int, int]]
    notes: list[str]
    support: str | None
    ai_wording: list[str]
    wording: list[str]  # judgmental / emotion words in the current text
    third_party_name: bool  # the AI used another person's name (ADR 0007)
    resolved: bool
    blocking: bool


class AiFieldOut(BaseModel):
    status: Literal["content", "not_discussed"]
    statements: list[StatementOut]


class ContentOut(BaseModel):
    header: Header
    ai: dict[str, AiFieldOut]
    therapist: dict[str, str]


class VersionOut(BaseModel):
    version: int
    kind: Literal["approval", "addendum"]
    created_at: datetime
    text: str | None  # addendum text, approved (unsigned) notes only
    message: str | None  # signed addendum: OpenPGP message, decrypted in the browser


class SignedOut(BaseModel):
    """A signed note as stored: OpenPGP messages only the therapist (or recovery) key opens."""

    note: str
    transcript: str | None
    index: str
    signer_fingerprint: str
    encrypted_to: list[str]
    signed_at: datetime


class ReportOut(BaseModel):
    session_id: uuid.UUID
    status: ReportStatus
    failure_reason: str | None
    pending_field: str | None
    template_code: str
    template_version: int
    ai_assisted: bool
    llm_model: str | None
    prompt_version: str | None
    content: ContentOut
    default_session_no: int
    blocking: int
    updated_at: datetime | None
    approved_at: datetime | None
    versions: list[VersionOut]
    signed: SignedOut | None


class ApprovedReportOut(BaseModel):
    """A row on the Reports page (plan 0013): approved and signed notes. For a signed note the
    server cannot read number, type and topics; the browser decrypts them from `index`."""

    session_id: uuid.UUID
    client_id: uuid.UUID
    client_name: str
    started_at: datetime
    approved_at: datetime
    signed: bool
    index: str | None
    session_no: str | None
    session_type: SessionType | None
    topics: list[str]
    addenda: int


class DraftRequest(BaseModel):
    field: AiField | None = None  # only this field again; None = the whole note


# v6 fingerprints: SHA-256, lower-case hex (see api/keys.py).
Fingerprint = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


def _message(max_chars: int) -> Any:
    return Annotated[str, Field(max_length=max_chars), AfterValidator(armored_message)]


NoteMessage = _message(400_000)
TranscriptMessage = _message(8_000_000)
IndexMessage = _message(20_000)
AddendumMessage = _message(100_000)


class SignedBy(BaseModel):
    signer_fingerprint: Fingerprint
    encrypted_to: Annotated[list[Fingerprint], Field(min_length=2, max_length=2)]


class SignedAddendumIn(BaseModel):
    version: Annotated[int, Field(ge=2)]
    message: AddendumMessage  # type: ignore[valid-type]


class SignIn(SignedBy):
    note: NoteMessage  # type: ignore[valid-type]
    transcript: TranscriptMessage | None = None  # type: ignore[valid-type]
    index: IndexMessage  # type: ignore[valid-type]
    # Addenda of a note approved before signing existed, signed now as well.
    addenda: Annotated[list[SignedAddendumIn], Field(max_length=200)] = []
    # From `sign/prepare`: the note must not have changed in between.
    approved_at: datetime
    report_updated_at: datetime


class AddendumIn(SignedBy):
    message: AddendumMessage  # type: ignore[valid-type]


class AddendumText(BaseModel):
    version: int
    created_at: datetime
    text: str


class SignPrepareOut(BaseModel):
    """What the browser signs. `note` is the record (content + metadata), `index` the short
    part shown on the Reports page; `transcript` as the therapist sees it, corrections applied."""

    note: dict[str, Any]
    index: dict[str, Any]
    transcript: dict[str, Any] | None
    addenda: list[AddendumText]
    approved_at: datetime
    report_updated_at: datetime
    therapist_fingerprint: str
    recovery_fingerprint: str


# --- helpers ------------------------------------------------------------------------


def _report(db: DbSession, session_id: uuid.UUID) -> Report | None:
    return db.scalar(select(Report).where(Report.session_id == session_id))


def _content(report: Report | None) -> dict[str, Any]:
    if report is None or report.content_enc is None:
        return default_content()
    return decrypt_json(report.content_enc, report_aad(report.id, "content"))


def _draft_statements(report: Report) -> dict[str, dict[str, Any]]:
    if report.draft_enc is None:
        return {}
    draft = decrypt_json(report.draft_enc, report_aad(report.id, "draft"))
    return {
        s["id"]: s
        for field in draft.get("fields", {}).values()
        for s in field.get("statements", [])
    }


def _statement_out(s: dict[str, Any]) -> StatementOut:
    return StatementOut(
        id=s["id"],
        text=s["text"],
        kind=s.get("kind"),
        origin=s.get("origin", "therapist"),
        refs=[(int(a), int(b)) for a, b in s.get("refs", [])],
        notes=s.get("notes", []),
        support=s.get("support"),
        ai_wording=s.get("ai_wording", []),
        wording=wording_hits(s["text"]),
        third_party_name=bool(s.get("third_party_name")),
        resolved=bool(s.get("resolved")),
        blocking=is_blocking(s),
    )


def _content_out(content: dict[str, Any]) -> ContentOut:
    ai = content.get("ai", {})
    return ContentOut(
        header=Header(**content.get("header", {})),
        ai={
            code: AiFieldOut(
                status=ai.get(code, {}).get("status", "not_discussed"),
                statements=[_statement_out(s) for s in ai.get(code, {}).get("statements", [])],
            )
            for code in AI_FIELDS
        },
        therapist={code: content.get("therapist", {}).get(code, "") for code in THERAPIST_FIELDS},
    )


def _blocking(content: dict[str, Any]) -> int:
    return sum(
        1
        for field in content.get("ai", {}).values()
        for s in field.get("statements", [])
        if is_blocking(s)
    )


def _session_no(db: DbSession, session: Session) -> int:
    return (
        db.scalar(
            select(func.count()).where(
                Session.client_id == session.client_id, Session.started_at <= session.started_at
            )
        )
        or 1
    )


def _version_rows(db: DbSession, report: Report) -> list[ReportVersion]:
    return list(
        db.scalars(
            select(ReportVersion)
            .where(ReportVersion.report_id == report.id)
            .order_by(ReportVersion.version)
        )
    )


def _addendum_text(report: Report, row: ReportVersion) -> str:
    assert row.content_enc is not None
    data = decrypt_json(row.content_enc, report_aad(report.id, f"version:{row.version}"))
    return str(data.get("text", ""))


def _versions(db: DbSession, report: Report | None) -> list[VersionOut]:
    if report is None:
        return []
    out = []
    for row in _version_rows(db, report):
        text = None
        if row.kind == "addendum" and row.content_enc is not None:
            text = _addendum_text(report, row)
        out.append(
            VersionOut(
                version=row.version,
                kind=row.kind,
                created_at=row.created_at,
                text=text,
                message=row.pgp_message if row.kind == "addendum" else None,
            )
        )
    return out


def _signed(db: DbSession, report: Report | None) -> SignedOut | None:
    if report is None or report.status != "signed":
        return None
    first = db.get(ReportVersion, (report.id, 1))
    assert first is not None and first.pgp_message is not None  # written with the status
    assert report.signed_at is not None and report.index_pgp is not None  # CHECK signed_complete
    return SignedOut(
        note=first.pgp_message,
        transcript=first.transcript_pgp,
        index=report.index_pgp,
        signer_fingerprint=report.signer_fingerprint or "",
        encrypted_to=list(report.encrypted_to or []),
        signed_at=report.signed_at,
    )


def _out(db: DbSession, session: Session, report: Report | None) -> ReportOut:
    content = _content(report)
    return ReportOut(
        session_id=session.id,
        status=report.status if report is not None else "none",
        failure_reason=report.failure_reason if report else None,
        pending_field=report.pending_field if report else None,
        template_code=report.template_code if report else TEMPLATE_CODE,
        template_version=report.template_version if report else TEMPLATE_VERSION,
        # Signing drops the AI draft; the model name stays and says the note was AI-assisted.
        ai_assisted=report is not None
        and (
            report.draft_enc is not None
            or (report.status == "signed" and report.llm_model is not None)
        ),
        llm_model=report.llm_model if report else None,
        prompt_version=report.prompt_version if report else None,
        content=_content_out(content),
        default_session_no=_session_no(db, session),
        blocking=_blocking(content),
        updated_at=report.updated_at if report else None,
        approved_at=report.approved_at if report else None,
        versions=_versions(db, report),
        signed=_signed(db, report),
    )


def _audit(db: DbSession, user_id: uuid.UUID, action: str, session_id: uuid.UUID) -> None:
    db.add(
        AuditLog(actor_user_id=user_id, action=action, entity="session", entity_id=str(session_id))
    )


def _locked(report: Report) -> ApiError:
    """Why a note cannot be edited or drafted now."""
    if report.status in ("approved", "signed"):
        return ApiError("report_approved", 409)
    return ApiError("report_busy", 409)


def _check_signer(db: DbSession, user_id: uuid.UUID, body: SignedBy) -> None:
    """Rule 7: signed by the therapist key, encrypted to the therapist AND the recovery key.
    The server cannot check the message itself (no OpenPGP on the server, plan 0014); the
    browser decrypts and verifies before sending."""
    user = db.get(User, user_id)
    if user is None or user.key_fingerprints is None:
        raise ApiError("keys_missing", 409)
    therapist = user.key_fingerprints["therapist"]
    recovery = user.key_fingerprints["recovery"]
    if body.signer_fingerprint != therapist or sorted(body.encrypted_to) != sorted(
        [therapist, recovery]
    ):
        raise ApiError("key_mismatch", 409)


# --- routes -------------------------------------------------------------------------


MAX_LISTED = 200


@router.get("/reports")
def list_reports(
    user_id: CurrentUserId, db: Db, client_id: uuid.UUID | None = None
) -> list[ApprovedReportOut]:
    """Approved and signed notes, newest approval first. Drafts stay with their session."""
    query = (
        select(Report, Session)
        .join(Session, Session.id == Report.session_id)
        .where(Report.status.in_(("approved", "signed")))
        .order_by(Report.approved_at.desc())
        .limit(MAX_LISTED)
    )
    if client_id is not None:
        query = query.where(Session.client_id == client_id)
    rows = db.execute(query).all()
    addenda = dict(
        db.execute(
            select(ReportVersion.report_id, func.count())
            .where(
                ReportVersion.kind == "addendum",
                ReportVersion.report_id.in_([report.id for report, _ in rows]),
            )
            .group_by(ReportVersion.report_id)
        ).all()
    )
    names: dict[uuid.UUID, str] = {}
    out = []
    for report, session in rows:
        if session.client_id not in names:
            names[session.client_id] = _client_name(db.get(Client, session.client_id))
        signed = report.status == "signed"
        content = _content(report)  # empty once signed
        header = content.get("header", {})
        assert report.approved_at is not None  # CHECKs approval_complete, signed_complete
        out.append(
            ApprovedReportOut(
                session_id=session.id,
                client_id=session.client_id,
                client_name=names[session.client_id],
                started_at=session.started_at,
                approved_at=report.approved_at,
                signed=signed,
                index=report.index_pgp if signed else None,
                session_no=header.get("session_no"),
                session_type=header.get("session_type"),
                topics=card_topics(content),
                addenda=addenda.get(report.id, 0),
            )
        )
    return out


@router.get("/sessions/{session_id}/report")
def get_report(session_id: uuid.UUID, user_id: CurrentUserId, db: Db) -> ReportOut:
    session = _get_session(db, session_id)
    return _out(db, session, _report(db, session_id))


@router.post("/sessions/{session_id}/report/draft")
def request_draft(
    session_id: uuid.UUID, body: DraftRequest, user_id: CurrentUserId, db: Db
) -> ReportOut:
    """Ask the worker for a (new) AI draft of the whole note or one field. The therapist's own
    fields and the header are kept; the AI fields asked for are replaced."""
    session = _get_session(db, session_id)
    if db.get(Transcript, session_id) is None:
        raise ApiError("transcript_not_ready", 409)
    report = _report(db, session_id)
    if report is not None and report.status not in EDITABLE:
        raise _locked(report)
    if body.field is not None and (report is None or report.status != "draft"):
        raise ApiError("report_not_drafted", 409)
    snapshot_llm_names(db, session)  # "names to hide" may have changed since the session
    if report is None:
        report = Report(
            session_id=session_id,
            template_code=TEMPLATE_CODE,
            template_version=TEMPLATE_VERSION,
            status="pending",
        )
        db.add(report)
    report.status = "pending"
    report.pending_field = body.field
    report.failure_reason = None
    report.updated_at = datetime.now(UTC)
    _audit(db, user_id, "report_draft_requested", session_id)
    db.flush()
    return _out(db, session, report)


@router.put("/sessions/{session_id}/report")
def save_report(
    session_id: uuid.UUID, body: ContentIn, user_id: CurrentUserId, db: Db
) -> ReportOut:
    """Save the therapist's text. Without a report yet, this starts a manual note."""
    session = _get_session(db, session_id)
    report = _report(db, session_id)
    if report is None:
        report = Report(
            session_id=session_id,
            template_code=TEMPLATE_CODE,
            template_version=TEMPLATE_VERSION,
            status="draft",
        )
        db.add(report)
        db.flush()
    elif report.status not in EDITABLE:
        raise _locked(report)

    from_ai = _draft_statements(report)
    ai: dict[str, Any] = {}
    for code in AI_FIELDS:
        statements = []
        field_in = body.ai.get(code)  # type: ignore[call-overload]
        for item in field_in.statements if field_in is not None else []:
            original = from_ai.get(item.id)
            if original is not None:
                statement = {**original, "text": item.text, "resolved": item.resolved}
            else:
                statement = {
                    "id": item.id,
                    "text": item.text,
                    "kind": None,
                    "refs": [],
                    "notes": [],
                    "support": None,
                    "ai_wording": [],
                    "origin": "therapist",
                    "resolved": True,
                }
            statements.append(statement)
        ai[code] = {
            "status": "content" if statements else "not_discussed",
            "statements": statements,
        }
    content = {
        "header": body.header.model_dump(),
        "ai": ai,
        "therapist": {code: body.therapist.get(code, "") for code in THERAPIST_FIELDS},  # type: ignore[call-overload]
    }
    report.content_enc = encrypt_json(content, report_aad(report.id, "content"))
    report.status = "draft"
    report.updated_at = datetime.now(UTC)
    db.flush()
    return _out(db, session, report)


SIGN_WINDOW = timedelta(hours=1)  # between `sign/prepare` and `sign`


def _note_record(
    session: Session, client_name: str, report: Report, content: dict[str, Any], **meta: Any
) -> dict[str, Any]:
    """The signed note: self-contained, so the recovery key alone gives a readable record."""
    return {
        "session": {
            "id": str(session.id),
            "client_id": str(session.client_id),
            "client_name": client_name,
            "started_at": session.started_at.isoformat(),
        },
        "content": content,
        "template": {"code": report.template_code, "version": report.template_version},
        "ai_assisted": report.draft_enc is not None,
        "llm_model": report.llm_model,
        "prompt_version": report.prompt_version,
        **meta,
    }


@router.post("/sessions/{session_id}/report/sign/prepare")
def prepare_signing(session_id: uuid.UUID, user_id: CurrentUserId, db: Db) -> SignPrepareOut:
    """What the browser signs. Runs the approval checks (unresolved AI statements, session
    number) without changing anything; `sign` must follow within an hour."""
    session = _get_session(db, session_id)
    report = _report(db, session_id)
    user = db.get(User, user_id)
    if user is None or user.key_fingerprints is None:
        raise ApiError("keys_missing", 409)
    if report is None or report.status not in ("draft", "approved"):
        raise ApiError(
            "report_signed" if report and report.status == "signed" else "report_not_drafted", 409
        )
    client_name = _client_name(db.get(Client, session.client_id))
    addenda: list[AddendumText] = []
    if report.status == "draft":
        content = _content(report)
        if _blocking(content):
            raise ApiError("report_unresolved", 409)
        if content["header"].get("session_no") is None:
            content["header"]["session_no"] = str(_session_no(db, session))
        approved_at = datetime.now(UTC)
        note = _note_record(
            session,
            client_name,
            report,
            content,
            approved_at=approved_at.isoformat(),
            approved_by=str(user_id),
        )
    else:  # approved before signing existed: sign what was approved, unchanged
        assert report.approved_at is not None
        approved_at = report.approved_at
        rows = _version_rows(db, report)
        first = rows[0]
        assert first.version == 1 and first.content_enc is not None
        snapshot = decrypt_json(first.content_enc, report_aad(report.id, "version:1"))
        content = snapshot["content"]
        note = {**snapshot, "session": _note_record(session, client_name, report, {})["session"]}
        addenda = [
            AddendumText(version=r.version, created_at=r.created_at, text=_addendum_text(report, r))
            for r in rows
            if r.kind == "addendum"
        ]
    transcript = db.get(Transcript, session_id)
    return SignPrepareOut(
        note=note,
        index={
            "session_no": content["header"].get("session_no"),
            "session_type": content["header"].get("session_type"),
            "topics": card_topics(content),
        },
        transcript=(
            transcript_out(transcript).model_dump(mode="json")
            if transcript is not None and transcript.segments_enc is not None
            else None
        ),
        addenda=addenda,
        approved_at=approved_at,
        report_updated_at=report.updated_at,
        therapist_fingerprint=user.key_fingerprints["therapist"],
        recovery_fingerprint=user.key_fingerprints["recovery"],
    )


@router.post("/sessions/{session_id}/report/sign")
def sign_report(session_id: uuid.UUID, body: SignIn, user_id: CurrentUserId, db: Db) -> ReportOut:
    """Store the signed note and drop every readable server copy, in one transaction (rules 7,
    17): note text and AI draft, transcript, leftover transcript windows, and the processing
    key (so stored audio can no longer be decrypted by the server). Audio deletion itself is
    the shred job (`audio_state = shred_pending`)."""
    session = _get_session(db, session_id)
    report = _report(db, session_id)
    _check_signer(db, user_id, body)
    if report is not None and report.status == "signed":
        raise ApiError("report_signed", 409)
    if report is None or report.status not in ("draft", "approved"):
        raise ApiError("report_not_drafted", 409)
    if body.report_updated_at != report.updated_at:
        raise ApiError("report_changed", 409)
    now = datetime.now(UTC)
    transcript = db.get(Transcript, session_id)
    readable = transcript is not None and transcript.segments_enc is not None
    if readable != (body.transcript is not None):
        raise ApiError("invalid_input", 422)
    signed_by: dict[str, Any] = {
        "signer_fingerprint": body.signer_fingerprint,
        "encrypted_to": sorted(body.encrypted_to),
    }

    if report.status == "draft":
        if _blocking(_content(report)):
            raise ApiError("report_unresolved", 409)
        if body.addenda or not now - SIGN_WINDOW <= body.approved_at <= now:
            raise ApiError("report_changed", 409)
        db.add(
            ReportVersion(
                report_id=report.id,
                version=1,
                kind="approval",
                pgp_message=body.note,
                transcript_pgp=body.transcript,
                created_by=user_id,
                **signed_by,
            )
        )
        report.approved_at = body.approved_at
        report.approved_by = user_id
    else:  # seal a note approved before signing existed, with its addenda
        rows = _version_rows(db, report)
        messages = {a.version: a.message for a in body.addenda}
        expected = {r.version for r in rows if r.kind == "addendum"}
        if len(messages) != len(body.addenda) or set(messages) != expected:
            raise ApiError("report_changed", 409)
        if body.approved_at != report.approved_at:
            raise ApiError("report_changed", 409)
        for row in rows:
            row.content_enc = None
            row.pgp_message = body.note if row.kind == "approval" else messages[row.version]
            row.transcript_pgp = body.transcript if row.kind == "approval" else None
            row.signer_fingerprint = signed_by["signer_fingerprint"]
            row.encrypted_to = signed_by["encrypted_to"]

    report.status = "signed"
    report.content_enc = None
    report.draft_enc = None
    report.signed_at = now
    report.index_pgp = body.index
    report.updated_at = now
    report.signer_fingerprint = signed_by["signer_fingerprint"]
    report.encrypted_to = signed_by["encrypted_to"]

    if transcript is not None and readable:
        transcript.segments_enc = None
        if transcript.refine_status in ("pending", "running"):
            transcript.refine_status = "skipped"
    db.execute(delete(TranscriptWindow).where(TranscriptWindow.session_id == session_id))
    db.execute(
        delete(WrappedKey).where(
            WrappedKey.session_id == session_id, WrappedKey.kind == "processing"
        )
    )
    session.audio_state = "shred_pending"
    session.status = "signed"
    _audit(db, user_id, "report_signed", session_id)
    db.flush()
    return _out(db, session, report)


@router.post("/sessions/{session_id}/report/addenda")
def add_addendum(
    session_id: uuid.UUID, body: AddendumIn, user_id: CurrentUserId, db: Db
) -> ReportOut:
    """A dated, signed addendum ("Nachtrag") to a signed note; the note stays unchanged."""
    session = _get_session(db, session_id)
    report = _report(db, session_id)
    if report is None or report.status not in ("approved", "signed"):
        raise ApiError("report_not_approved", 409)
    if report.status != "signed":
        raise ApiError("report_not_signed", 409)
    _check_signer(db, user_id, body)
    version = (
        db.scalar(
            select(func.max(ReportVersion.version)).where(ReportVersion.report_id == report.id)
        )
        or 0
    ) + 1
    db.add(
        ReportVersion(
            report_id=report.id,
            version=version,
            kind="addendum",
            pgp_message=body.message,
            created_by=user_id,
            signer_fingerprint=body.signer_fingerprint,
            encrypted_to=sorted(body.encrypted_to),
        )
    )
    _audit(db, user_id, "report_addendum", session_id)
    db.flush()
    return _out(db, session, report)
