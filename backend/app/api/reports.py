"""Session note: AI draft, therapist edits, approval, addenda (plan 0009).

The browser may change text and mark AI statements as resolved, but never their sources or
check results: those are taken from the stored AI draft. An approved note is read-only (also a
DB trigger); later changes are dated addenda (§630f BGB)."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.api.deps import CurrentUserId, Db
from app.api.errors import ApiError
from app.api.sessions import _client_name, _get_session, card_topics, snapshot_llm_names
from app.core.data_crypto import decrypt_json, encrypt_json
from app.db.models import AuditLog, Client, Report, ReportVersion, Session, Transcript
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
    text: str | None  # addendum text


class ReportOut(BaseModel):
    session_id: uuid.UUID
    status: Literal["none", "pending", "drafting", "draft", "approved", "failed", "no_consent"]
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


class ApprovedReportOut(BaseModel):
    """A row on the Reports page (plan 0013): approved notes only."""

    session_id: uuid.UUID
    client_id: uuid.UUID
    client_name: str
    started_at: datetime
    approved_at: datetime
    session_no: str | None
    session_type: SessionType | None
    topics: list[str]
    addenda: int


class DraftRequest(BaseModel):
    field: AiField | None = None  # only this field again; None = the whole note


class AddendumIn(BaseModel):
    text: Annotated[str, Field(min_length=1, max_length=5000)]


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


def _versions(db: DbSession, report: Report | None) -> list[VersionOut]:
    if report is None:
        return []
    rows = db.scalars(
        select(ReportVersion)
        .where(ReportVersion.report_id == report.id)
        .order_by(ReportVersion.version)
    )
    out = []
    for row in rows:
        text = None
        if row.kind == "addendum":
            data = decrypt_json(row.content_enc, report_aad(report.id, f"version:{row.version}"))
            text = str(data.get("text", ""))
        out.append(
            VersionOut(version=row.version, kind=row.kind, created_at=row.created_at, text=text)
        )
    return out


def _out(db: DbSession, session: Session, report: Report | None) -> ReportOut:
    content = _content(report)
    return ReportOut(
        session_id=session.id,
        status=report.status if report is not None else "none",
        failure_reason=report.failure_reason if report else None,
        pending_field=report.pending_field if report else None,
        template_code=report.template_code if report else TEMPLATE_CODE,
        template_version=report.template_version if report else TEMPLATE_VERSION,
        ai_assisted=report is not None and report.draft_enc is not None,
        llm_model=report.llm_model if report else None,
        prompt_version=report.prompt_version if report else None,
        content=_content_out(content),
        default_session_no=_session_no(db, session),
        blocking=_blocking(content),
        updated_at=report.updated_at if report else None,
        approved_at=report.approved_at if report else None,
        versions=_versions(db, report),
    )


def _audit(db: DbSession, user_id: uuid.UUID, action: str, session_id: uuid.UUID) -> None:
    db.add(
        AuditLog(actor_user_id=user_id, action=action, entity="session", entity_id=str(session_id))
    )


# --- routes -------------------------------------------------------------------------


MAX_LISTED = 200


@router.get("/reports")
def list_reports(
    user_id: CurrentUserId, db: Db, client_id: uuid.UUID | None = None
) -> list[ApprovedReportOut]:
    """Approved notes, newest approval first. Drafts stay with their session until approved."""
    query = (
        select(Report, Session)
        .join(Session, Session.id == Report.session_id)
        .where(Report.status == "approved")
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
        content = _content(report)
        header = content.get("header", {})
        assert report.approved_at is not None  # CHECK approval_complete
        out.append(
            ApprovedReportOut(
                session_id=session.id,
                client_id=session.client_id,
                client_name=names[session.client_id],
                started_at=session.started_at,
                approved_at=report.approved_at,
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
        raise ApiError("report_busy" if report.status != "approved" else "report_approved", 409)
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
        raise ApiError("report_busy" if report.status != "approved" else "report_approved", 409)

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


@router.post("/sessions/{session_id}/report/approve")
def approve_report(session_id: uuid.UUID, user_id: CurrentUserId, db: Db) -> ReportOut:
    """The therapist approves the note. Blocked while AI statements are unresolved
    (rule 14). Stores version 1 and makes the note read-only."""
    session = _get_session(db, session_id)
    report = _report(db, session_id)
    if report is None or report.status != "draft":
        raise ApiError("report_not_drafted", 409)
    content = _content(report)
    if _blocking(content):
        raise ApiError("report_unresolved", 409)
    if content["header"].get("session_no") is None:
        content["header"]["session_no"] = str(_session_no(db, session))
    now = datetime.now(UTC)
    report.content_enc = encrypt_json(content, report_aad(report.id, "content"))
    snapshot = {
        "content": content,
        "template": {"code": report.template_code, "version": report.template_version},
        "ai_assisted": report.draft_enc is not None,
        "llm_model": report.llm_model,
        "prompt_version": report.prompt_version,
        "approved_at": now.isoformat(),
        "approved_by": str(user_id),
    }
    db.add(
        ReportVersion(
            report_id=report.id,
            version=1,
            kind="approval",
            content_enc=encrypt_json(snapshot, report_aad(report.id, "version:1")),
            created_by=user_id,
        )
    )
    report.status = "approved"
    report.approved_at = now
    report.approved_by = user_id
    report.updated_at = now
    _audit(db, user_id, "report_approved", session_id)
    db.flush()
    return _out(db, session, report)


@router.post("/sessions/{session_id}/report/addenda")
def add_addendum(
    session_id: uuid.UUID, body: AddendumIn, user_id: CurrentUserId, db: Db
) -> ReportOut:
    """A dated addendum ("Nachtrag") to an approved note; the approved text stays unchanged."""
    session = _get_session(db, session_id)
    report = _report(db, session_id)
    if report is None or report.status != "approved":
        raise ApiError("report_not_approved", 409)
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
            content_enc=encrypt_json(
                {"text": body.text.strip()}, report_aad(report.id, f"version:{version}")
            ),
            created_by=user_id,
        )
    )
    _audit(db, user_id, "report_addendum", session_id)
    db.flush()
    return _out(db, session, report)
