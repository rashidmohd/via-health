from typing import Protocol


class KmsProvider(Protocol):
    async def wrap(self, plaintext_key: bytes) -> bytes: ...

    async def unwrap(self, wrapped_key: bytes) -> bytes: ...
