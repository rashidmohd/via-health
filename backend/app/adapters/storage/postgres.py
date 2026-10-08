"""Interim object store in Postgres until GCS is set up (plan 0004).

Keys look like `sessions/<session_id>/<seq>`; the session id is stored for RLS."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session as DbSession

from app.db.models import ObjectBlob


def session_id_from_key(key: str) -> uuid.UUID:
    prefix, session_id, *_ = key.split("/")
    if prefix != "sessions":
        raise ValueError("unsupported key")
    return uuid.UUID(session_id)


class PostgresObjectStore:
    def __init__(self, db: DbSession) -> None:
        self._db = db

    def put(self, key: str, data: bytes) -> None:
        self._db.execute(
            insert(ObjectBlob)
            .values(key=key, session_id=session_id_from_key(key), data=data)
            .on_conflict_do_nothing(index_elements=["key"])
        )

    def get(self, key: str) -> bytes:
        data = self._db.scalar(select(ObjectBlob.data).where(ObjectBlob.key == key))
        if data is None:
            raise KeyError("object not found")
        return bytes(data)

    def delete_prefix(self, prefix: str) -> int:
        result = self._db.execute(delete(ObjectBlob).where(ObjectBlob.key.startswith(prefix)))
        return int(result.rowcount)  # type: ignore[attr-defined]
