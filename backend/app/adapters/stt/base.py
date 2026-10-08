from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class TranscriptSegment:
    start_ms: int
    end_ms: int
    text: str
    speaker: str | None = None


class SttProvider(Protocol):
    async def recognize_window(self, audio: bytes, *, language: str) -> list[TranscriptSegment]:
        """Transcribe a sub-minute window held in memory."""
        ...

    async def batch_recognize(
        self, object_uris: list[str], *, language: str, diarize: bool
    ) -> list[TranscriptSegment]:
        """Transcribe the full session audio with optional diarization."""
        ...
