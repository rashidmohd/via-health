from typing import Protocol


class KmsProvider(Protocol):
    """Wraps session keys so workers can process audio. `aad` binds a wrapped key to its
    session (Cloud KMS: additionalAuthenticatedData)."""

    def wrap(self, plaintext_key: bytes, *, aad: str) -> bytes: ...

    def unwrap(self, wrapped_key: bytes, *, aad: str) -> bytes: ...
