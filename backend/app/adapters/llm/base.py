from typing import Any, Protocol


class LlmError(Exception):
    """Drafting failed. `retryable` = worth another attempt (quota, service unavailable…).
    Messages never contain prompt or output text (rule 3)."""

    def __init__(self, reason: str, *, retryable: bool) -> None:
        super().__init__(reason)
        self.retryable = retryable


class LlmProvider(Protocol):
    model: str

    def generate_json(self, *, system: str, prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
        """Structured output matching `schema` (JSON Schema). Never final: the therapist always
        reviews (rule 14). No caching, no grounding, no tools (rule 5)."""
        ...

    def describe_image_json(
        self, *, system: str, prompt: str, image: bytes, mime_type: str, schema: dict[str, Any]
    ) -> dict[str, Any]:
        """Structured output about one image (avatar appearance, ADR 0013). The image is sent
        once and not kept by us; the caller reviews the answer."""
        ...
