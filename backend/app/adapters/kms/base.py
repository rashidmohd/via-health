from typing import Protocol


class KmsUnavailable(Exception):
    """The key service could not be reached or refused the call. Carries no key material."""


class KmsProvider(Protocol):
    """Wraps session keys so workers can process audio. `aad` binds a wrapped key to its
    session (Cloud KMS: additionalAuthenticatedData)."""

    def wrap(self, plaintext_key: bytes, *, aad: str) -> bytes: ...

    def unwrap(self, wrapped_key: bytes, *, aad: str) -> bytes: ...
