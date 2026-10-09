"""Shred job and retention sweep (docs/plans/0015-shred-and-retention.md, rules 6 and 10).

A session's audio is destroyed when the note is signed, when consent is withdrawn
(`audio_state = shred_pending`), or when the unsigned session reaches `retention_deadline`.
Keys go first (crypto-shred), then the stored objects. Safe to run again at any point."""

import logging
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy import Engine, delete, or_, select
from sqlalchemy.orm import Session as DbSession

from app.adapters.storage import ObjectStore
from app.adapters.stt.base import TEMP_PREFIX
from app.db.models import Session, TranscriptWindow, WrappedKey
from app.workers.transcribe import _audit

logger = logging.getLogger("sessio.worker.shred")


def find_shred_work(engine: Engine) -> list[uuid.UUID]:
    with DbSession(engine) as db:
        return list(
            db.scalars(
                select(Session.id)
                .where(
                    or_(
                        Session.audio_state == "shred_pending",
                        (Session.audio_state == "present")
                        & (Session.retention_deadline < datetime.now(UTC)),
                    )
                )
                .limit(50)
            )
        )


def shred_session(
    session_id: uuid.UUID, *, engine: Engine, store_for: Callable[[DbSession], ObjectStore]
) -> str:
    """Returns `shredded` or `skipped`."""
    with DbSession(engine) as db, db.begin():
        session = db.get(Session, session_id, with_for_update=True)
        if session is None or session.audio_state == "shredded":
            return "skipped"
        reason = "marked"
        if session.audio_state == "present":
            if session.retention_deadline >= datetime.now(UTC):
                return "skipped"
            session.audio_state = "shred_pending"  # retention reached (rule 6)
            reason = "retention"
        # Crypto-shred, committed before anything else: without the keys every remaining copy
        # of the audio (bucket, backups, a delete that fails below) is unreadable.
        db.execute(delete(WrappedKey).where(WrappedKey.session_id == session_id))
        db.execute(delete(TranscriptWindow).where(TranscriptWindow.session_id == session_id))

    with DbSession(engine) as db, db.begin():
        store = store_for(db)
        objects = store.delete_prefix(f"sessions/{session_id}/")
        # Temporary Speech-to-Text copies (`stt-tmp/<id>`, `stt-tmp/<id>-refine`) are deleted
        # by the adapter after each call; this catches a worker that died in between.
        store.delete_prefix(f"{TEMP_PREFIX}{session_id}")
        session = db.get(Session, session_id)
        assert session is not None
        session.audio_state = "shredded"
        _audit(db, "audio_shredded", session_id, {"objects": str(objects), "reason": reason})
    logger.info("shredded session_id=%s objects=%d reason=%s", session_id, objects, reason)
    return "shredded"
