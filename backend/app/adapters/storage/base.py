from typing import Protocol


class ObjectStore(Protocol):
    """Stores ciphertext only. Sync API; workers call it via a thread."""

    def put(self, key: str, data: bytes) -> None: ...

    def get(self, key: str) -> bytes:
        """Return object bytes in memory. Never write to disk (rule 2)."""
        ...

    def delete_prefix(self, prefix: str) -> int: ...
