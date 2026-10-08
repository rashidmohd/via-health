"""Database access. Every app connection runs as `sessio_app`, so row-level security
always applies; each transaction is scoped to one user via `app.user_id`."""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from typing import Any

from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.orm import Session

from app.core.config import get_settings

APP_ROLE = "sessio_app"


def make_engine(url: str) -> Engine:
    engine = create_engine(url, pool_pre_ping=True)

    @event.listens_for(engine, "connect")
    def _drop_privileges(dbapi_connection: Any, _record: Any) -> None:
        with dbapi_connection.cursor() as cursor:
            cursor.execute(f"SET ROLE {APP_ROLE}")
        dbapi_connection.commit()

    return engine


@lru_cache
def get_engine() -> Engine:
    return make_engine(get_settings().database_url)


def bind_user(db: Session, user_id: uuid.UUID) -> None:
    """Scope the current transaction to one user (transaction-local)."""
    db.execute(text("SELECT set_config('app.user_id', :uid, true)"), {"uid": str(user_id)})


@contextmanager
def user_session(user_id: uuid.UUID, engine: Engine | None = None) -> Iterator[Session]:
    """A transaction as `user_id`. Commits on success, rolls back on error."""
    with Session(engine or get_engine()) as db, db.begin():
        bind_user(db, user_id)
        yield db
