from functools import lru_cache

from app.adapters.kms.base import KmsProvider
from app.adapters.kms.local import LocalKmsProvider
from app.core.config import get_settings


@lru_cache
def get_kms() -> KmsProvider:
    settings = get_settings()
    if settings.kms_provider == "gcp":
        from app.adapters.kms.google import GoogleKmsProvider

        return GoogleKmsProvider(settings.kms_key_name)
    return LocalKmsProvider()


__all__ = ["KmsProvider", "get_kms"]
