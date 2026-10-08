"""Notification tab (plan 0010): background events for the logged-in therapist.
Rows carry ids and a kind code; the client name is added here, for the therapist only."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update

from app.api.deps import CurrentUserId, Db
from app.api.sessions import _client_name
from app.db.models import Client, Notification, Report, Session

router = APIRouter(tags=["notifications"])


class NotificationOut(BaseModel):
    id: uuid.UUID
    kind: str
    session_id: uuid.UUID
    client_name: str
    created_at: datetime
    read: bool


class NotificationsOut(BaseModel):
    items: list[NotificationOut]
    unread: int
    # Drafts waiting for review (computed, not stored).
    notes_to_review: int


class MarkRead(BaseModel):
    ids: Annotated[list[uuid.UUID], Field(max_length=200)] = []
    all: bool = False


@router.get("/notifications")
def list_notifications(
    user_id: CurrentUserId, db: Db, limit: Annotated[int, Query(ge=1, le=100)] = 50
) -> NotificationsOut:
    rows = db.execute(
        select(Notification, Client)
        .join(Session, Session.id == Notification.session_id)
        .join(Client, Client.id == Session.client_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    ).all()
    names: dict[uuid.UUID, str] = {}
    items = []
    for notification, client in rows:
        if client.id not in names:
            names[client.id] = _client_name(client)
        items.append(
            NotificationOut(
                id=notification.id,
                kind=notification.kind,
                session_id=notification.session_id,
                client_name=names[client.id],
                created_at=notification.created_at,
                read=notification.read_at is not None,
            )
        )
    unread = db.scalar(select(func.count()).where(Notification.read_at.is_(None))) or 0
    to_review = db.scalar(select(func.count()).where(Report.status == "draft")) or 0
    return NotificationsOut(items=items, unread=unread, notes_to_review=to_review)


@router.post("/notifications/read", status_code=204)
def mark_read(body: MarkRead, user_id: CurrentUserId, db: Db) -> None:
    query = update(Notification).where(Notification.read_at.is_(None))
    if not body.all:
        if not body.ids:
            return
        query = query.where(Notification.id.in_(body.ids))
    db.execute(query.values(read_at=datetime.now(UTC)))  # RLS: own rows only
