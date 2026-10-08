import uuid
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.api.errors import ApiError
from app.core.security import keyed_hash
from app.db.session import bind_user, get_engine

AUTH_COOKIE = "sessio_auth"


def get_db(engine: Annotated[Engine, Depends(get_engine)]) -> Iterator[Session]:
    """One transaction per request, as `sessio_app`. Commits unless the handler raises."""
    db = Session(engine)
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


Db = Annotated[Session, Depends(get_db)]


def session_token_hash(token: str) -> str:
    return keyed_hash("session", token)


def current_user_id(request: Request, db: Db) -> uuid.UUID:
    """Resolve the login cookie and scope this request's transaction to that user (RLS)."""
    token = request.cookies.get(AUTH_COOKIE)
    if not token:
        raise ApiError("not_authenticated", 401)
    user_id = db.execute(
        text("SELECT auth_session_user(:h)"), {"h": session_token_hash(token)}
    ).scalar_one()
    if user_id is None:
        raise ApiError("not_authenticated", 401)
    bind_user(db, user_id)
    return uuid.UUID(str(user_id))


CurrentUserId = Annotated[uuid.UUID, Depends(current_user_id)]
