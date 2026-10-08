"""Decrypt audio chunks exactly as the browser encrypted them (apps/web/src/recorder/crypto.ts).

Chunk format: 0x01 | 12-byte IV | AES-256-GCM ciphertext+tag, AAD = "<session_id>|<seq>".
Plaintext stays in memory only (rule 2)."""

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

CHUNK_VERSION = 0x01
IV_BYTES = 12


class ChunkDecryptionError(Exception):
    pass


def decrypt_chunk(key: bytes, session_id: str, seq: int, chunk: bytes) -> bytes:
    if len(chunk) <= 1 + IV_BYTES or chunk[0] != CHUNK_VERSION:
        raise ChunkDecryptionError("unsupported chunk")
    iv, ciphertext = chunk[1 : 1 + IV_BYTES], chunk[1 + IV_BYTES :]
    try:
        return AESGCM(key).decrypt(iv, ciphertext, f"{session_id}|{seq}".encode())
    except InvalidTag:
        raise ChunkDecryptionError("authentication failed") from None
