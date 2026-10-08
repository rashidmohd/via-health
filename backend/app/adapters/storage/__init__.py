from sqlalchemy.orm import Session as DbSession

from app.adapters.storage.base import ObjectStore
from app.core.config import get_settings


def make_object_store(db: DbSession) -> ObjectStore:
    settings = get_settings()
    if settings.object_store == "gcs":
        from app.adapters.storage.gcs import GcsObjectStore

        return GcsObjectStore(settings.gcs_bucket, settings.gcp_project_id)
    from app.adapters.storage.postgres import PostgresObjectStore

    return PostgresObjectStore(db)


__all__ = ["ObjectStore", "make_object_store"]
