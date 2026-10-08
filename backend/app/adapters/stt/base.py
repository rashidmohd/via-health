from dataclasses import asdict, dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class Segment:
    """A run of words by one speaker. `speaker` is the model's label ("1", "2"); the therapist
    decides which label is them."""

    speaker: str | None
    start_ms: int
    end_ms: int
    text: str

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


class SttError(Exception):
    """Transcription failed. `retryable` = worth another attempt (service unavailable…).
    Messages never contain transcript text."""

    def __init__(self, reason: str, *, retryable: bool) -> None:
        super().__init__(reason)
        self.retryable = retryable


class SttProvider(Protocol):
    def transcribe(
        self, audio: bytes, *, mime_type: str, language: str, job_id: str
    ) -> list[Segment]:
        """Transcribe a whole session with speaker separation. Audio is plaintext in memory;
        any temporary copy the provider needs must be deleted before returning."""
        ...
