"""Draft a session note with the LLM (docs/plans/0009-ai-session-report.md).

Two calls: (1) draft the AI fields with sources, (2) check every statement against its
sources. Names are replaced before both calls (ADR 0007). Therapist-only fields are never in
the model's schema (ADR 0008). Logs carry ids and counts only (rule 3)."""

import logging
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Engine, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session as DbSession

from app.adapters.llm import LlmError, LlmProvider
from app.core.data_crypto import DecryptionError, decrypt_json, encrypt_json
from app.db.models import Capture, Report, Session, Transcript
from app.domain.report_draft import (
    NameList,
    NameMasker,
    Note,
    apply_check,
    build_prompt,
    check_prompt,
    default_content,
    empty_ai_fields,
    names_aad,
    parse_draft,
    report_aad,
)
from app.domain.report_template import (
    AI_FIELDS,
    CHECK_SCHEMA,
    CHECK_SYSTEM_PROMPT,
    PROMPT_VERSION,
    TEMPLATE_CODE,
    TEMPLATE_VERSION,
    draft_schema,
)
from app.domain.transcript import Segment, Word, apply_corrections, is_excluded, words_to_segments
from app.workers.transcribe import TransientFailure, notify, transcript_aad

logger = logging.getLogger("sessio.worker.report")

STALE_DRAFTING = timedelta(minutes=15)  # worker restarted mid-job


def find_draft_work(engine: Engine) -> list[uuid.UUID]:
    """Reports the therapist asked a draft for. Never automatic: the therapist first reviews
    the transcript and may leave turns out (ADR 0018)."""
    with DbSession(engine) as db:
        rows = db.execute(
            text(
                """
                SELECT r.session_id FROM reports r
                WHERE r.status = 'pending'
                   OR (r.status = 'drafting' AND r.updated_at < now() - :stale)
                LIMIT 50
                """
            ),
            {"stale": STALE_DRAFTING},
        )
        return [row[0] for row in rows]


def _claim(db: DbSession, session_id: uuid.UUID) -> Report | None:
    db.execute(
        insert(Report)
        .values(
            session_id=session_id,
            template_code=TEMPLATE_CODE,
            template_version=TEMPLATE_VERSION,
            status="pending",
        )
        .on_conflict_do_nothing(index_elements=["session_id", "kind"])
    )
    report = db.scalars(
        select(Report).where(Report.session_id == session_id).with_for_update(skip_locked=True)
    ).first()
    if report is None:
        return None
    stale = report.updated_at < datetime.now(UTC) - STALE_DRAFTING
    if report.status == "pending" or (report.status == "drafting" and stale):
        report.status = "drafting"
        report.failure_reason = None
        report.updated_at = datetime.now(UTC)
        return report
    return None


NOTIFY_ON = {"failed": "report_failed", "no_consent": "report_no_consent"}


def _set_status(engine: Engine, report_id: uuid.UUID, status: str, reason: str | None) -> None:
    with DbSession(engine) as db, db.begin():
        report = db.get(Report, report_id)
        if report is not None and report.status == "drafting":
            report.status = status
            report.failure_reason = reason
            report.updated_at = datetime.now(UTC)
            if status in NOTIFY_ON:
                notify(db, report.session_id, NOTIFY_ON[status])


def _segments(transcript: Transcript) -> list[Segment]:
    if transcript.segments_enc is None:  # signed; a signed note is never drafted again
        raise DecryptionError("transcript signed")
    data = decrypt_json(transcript.segments_enc, transcript_aad(transcript.session_id))
    if data.get("words"):
        base = words_to_segments(Word(**w) for w in data["words"])
    else:
        base = [Segment(**s) for s in data["segments"]]
    # Left-out turns never reach the model (ADR 0018).
    corrected = apply_corrections(
        base, transcript.speaker_overrides or [], transcript.excluded_ranges or []
    )
    return [segment for segment, excluded in corrected if not excluded]


def _notes(db: DbSession, session_id: uuid.UUID, excluded: list[Any]) -> list[Note]:
    rows = db.scalars(
        select(Capture)
        .where(Capture.session_id == session_id, Capture.status == "confirmed")
        .order_by(Capture.at_ms)
    )
    notes = []
    for row in rows:
        if is_excluded(row.at_ms, row.at_ms, excluded):
            continue  # a note from a left-out turn would bring its words back
        payload = decrypt_json(row.payload_enc, f"capture:{row.id}:payload")
        notes.append(Note(str(row.id), row.kind, row.at_ms, str(payload.get("text", ""))))
    return notes


def draft_report(
    session_id: uuid.UUID, *, engine: Engine, llm: LlmProvider, last_attempt: bool = True
) -> str:
    """Returns `draft`, `skipped`, `no_consent` or `failed`. Raises TransientFailure to retry."""
    started = time.monotonic()
    with DbSession(engine) as db, db.begin():
        if db.get(Transcript, session_id) is None:
            return "skipped"
        report = _claim(db, session_id)
        if report is None:
            return "skipped"
        report_id = report.id
        only_field = report.pending_field if report.pending_field in AI_FIELDS else None

    with DbSession(engine) as db:
        session = db.get(Session, session_id)
        transcript = db.get(Transcript, session_id)
        assert session is not None and transcript is not None
        if not db.execute(
            text("SELECT client_has_recording_consent(:c)"), {"c": session.client_id}
        ).scalar_one():
            _set_status(engine, report_id, "no_consent", None)
            return "no_consent"
        if session.llm_names_enc is None:
            _set_status(engine, report_id, "failed", "names_missing")
            return "failed"
        try:
            names = NameList.from_json(decrypt_json(session.llm_names_enc, names_aad(session_id)))
            segments = _segments(transcript)
            notes = _notes(db, session_id, transcript.excluded_ranges or [])
        except DecryptionError:
            _set_status(engine, report_id, "failed", "decryption_failed")
            return "failed"
        language = transcript.language.split("-")[0]
        therapist_label = (transcript.speaker_roles or {}).get("therapist")

    fields = (only_field,) if only_field else AI_FIELDS
    masker = NameMasker(names, language)
    try:
        if not segments:
            drafted = {code: {"status": "not_discussed", "statements": []} for code in fields}
        else:
            system, prompt = build_prompt(
                segments=segments,
                notes=notes,
                therapist_label=therapist_label,
                language=language,
                fields=fields,
                mask=masker.mask,
            )
            raw = llm.generate_json(system=system, prompt=prompt, schema=draft_schema(fields))
            drafted = parse_draft(
                raw, fields=fields, segments=segments, notes=notes, restore=masker.restore
            )
            to_check = check_prompt(
                drafted,
                segments=segments,
                notes=notes,
                therapist_label=therapist_label,
                language=language,
                mask=masker.mask,
            )
            checked = (
                llm.generate_json(system=CHECK_SYSTEM_PROMPT, prompt=to_check, schema=CHECK_SCHEMA)
                if to_check
                else {}
            )
            apply_check(drafted, checked)
    except LlmError as error:
        if error.retryable and not last_attempt:
            _set_status(engine, report_id, "pending", None)
            raise TransientFailure(str(error)) from None
        _set_status(engine, report_id, "failed", "drafting_failed")
        logger.warning("draft failed session_id=%s error=%s", session_id, error)
        return "failed"

    with DbSession(engine) as db, db.begin():
        report = db.get(Report, report_id, with_for_update=True)
        if report is None or report.status != "drafting":
            return "skipped"
        draft = (
            decrypt_json(report.draft_enc, report_aad(report_id, "draft"))
            if report.draft_enc
            else {}
        )
        content = (
            decrypt_json(report.content_enc, report_aad(report_id, "content"))
            if report.content_enc
            else default_content()
        )
        draft_fields = draft.get("fields") or empty_ai_fields()
        for code, value in drafted.items():
            draft_fields[code] = value
            content["ai"][code] = value
        report.draft_enc = encrypt_json(
            {"fields": draft_fields, "model": llm.model}, report_aad(report_id, "draft")
        )
        report.content_enc = encrypt_json(content, report_aad(report_id, "content"))
        report.status = "draft"
        report.pending_field = None
        report.llm_model = llm.model
        report.prompt_version = PROMPT_VERSION
        report.updated_at = datetime.now(UTC)
        notify(db, session_id, "report_ready")
        db.execute(
            text(
                "INSERT INTO audit_log (action, entity, entity_id, meta) "
                "VALUES ('report_drafted', 'session', :id, CAST(:meta AS jsonb))"
            ),
            {"id": str(session_id), "meta": f'{{"fields": "{len(drafted)}"}}'},
        )
    statements = sum(len(v["statements"]) for v in drafted.values())
    logger.info(
        "drafted session_id=%s fields=%d statements=%d seconds=%.1f",
        session_id, len(drafted), statements, time.monotonic() - started,
    )  # fmt: skip
    return "draft"


def draft_report_unconfigured(engine: Engine, session_id: uuid.UUID) -> str:
    """No usable LLM settings (e.g. API key missing): mark the report failed, never retry."""
    with DbSession(engine) as db, db.begin():
        report = _claim(db, session_id)
        if report is None:
            return "skipped"
        report.status = "failed"
        report.failure_reason = "llm_not_configured"
        notify(db, session_id, "report_failed")
    logger.warning("draft failed session_id=%s error=llm_not_configured", session_id)
    return "failed"
