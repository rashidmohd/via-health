from app.adapters.kms.base import KmsProvider
from app.adapters.kms.local import LocalKmsProvider


def get_kms() -> KmsProvider:
    return LocalKmsProvider()


__all__ = ["KmsProvider", "get_kms"]
