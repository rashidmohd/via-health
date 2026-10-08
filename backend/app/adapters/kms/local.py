"""Interim processing key until Cloud KMS is set up (plan 0004).

AES-256-GCM with a key derived from CLIENT_DATA_KEY via HKDF, so it is independent of the
client-data key without adding a new secret."""

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import get_settings
from app.core.data_crypto import decrypt_bytes, encrypt_bytes

HKDF_INFO = b"sessio/processing-key/v1"


def _processing_key() -> bytes:
    master = bytes.fromhex(get_settings().client_data_key)
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=HKDF_INFO).derive(master)


class LocalKmsProvider:
    def wrap(self, plaintext_key: bytes, *, aad: str) -> bytes:
        return encrypt_bytes(plaintext_key, f"kms:{aad}", key=_processing_key())

    def unwrap(self, wrapped_key: bytes, *, aad: str) -> bytes:
        return decrypt_bytes(wrapped_key, f"kms:{aad}", key=_processing_key())
