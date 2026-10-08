from typing import Protocol


class LlmProvider(Protocol):
    async def draft(self, *, system: str, prompt: str) -> str:
        """Return a draft. Never final: the therapist always reviews (rule 14)."""
        ...
