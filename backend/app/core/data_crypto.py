"""AES-256-GCM for client data under the interim server key (ADR 0004).

Format: version byte 0x01 | 12-byte random nonce | ciphertext+tag.
The AAD names the row and field, so a ciphertext only decrypts where it was written.
"""

import json
import os
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings

VERSION = b"\x01"
NONCE_BYTES = 12


class DecryptionError(Exception):
    """Wrong key, wrong row/field, or tampered data. Carries no data."""


def _cipher() -> AESGCM:
    return AESGCM(bytes.fromhex(get_settings().client_data_key))


def encrypt_bytes(plaintext: bytes, aad: str) -> bytes:
    nonce = os.urandom(NONCE_BYTES)
    return VERSION + nonce + _cipher().encrypt(nonce, plaintext, aad.encode())


def decrypt_bytes(blob: bytes, aad: str) -> bytes:
    if len(blob) < 1 + NONCE_BYTES or blob[:1] != VERSION:
        raise DecryptionError("unsupported format")
    nonce, ciphertext = blob[1 : 1 + NONCE_BYTES], blob[1 + NONCE_BYTES :]
    try:
        return _cipher().decrypt(nonce, ciphertext, aad.encode())
    except InvalidTag:
        raise DecryptionError("authentication failed") from None


def encrypt_json(value: dict[str, Any], aad: str) -> bytes:
    return encrypt_bytes(json.dumps(value, separators=(",", ":")).encode(), aad)


def decrypt_json(blob: bytes, aad: str) -> dict[str, Any]:
    value = json.loads(decrypt_bytes(blob, aad))
    if not isinstance(value, dict):
        raise DecryptionError("unexpected content")
    return value
