from functools import lru_cache

from app.adapters.stt.base import Segment, SttError, SttProvider
from app.core.config import get_settings


@lru_cache
def get_stt() -> SttProvider:
    settings = get_settings()
    if settings.stt_provider == "google":
        from app.adapters.stt.google import GoogleChirp3Provider

        return GoogleChirp3Provider(
            project=settings.gcp_project_id,
            location=settings.stt_location,
            model=settings.stt_model,
            bucket=settings.gcs_bucket,
        )
    from app.adapters.stt.fake import FakeSttProvider

    return FakeSttProvider()


__all__ = ["Segment", "SttError", "SttProvider", "get_stt"]
