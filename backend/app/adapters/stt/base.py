from typing import Protocol

from app.domain.transcript import Segment, Word

__all__ = ["TEMP_PREFIX", "Segment", "SttError", "SttProvider", "Word"]

# Bucket prefix for temporary decrypted audio a provider needs (`stt-tmp/<job id>`, job id =
# session id, optionally with a suffix). The shred job deletes leftovers under it.
TEMP_PREFIX = "stt-tmp/"


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

    def diarize_words(
        self, audio: bytes, *, mime_type: str, language: str, job_id: str
    ) -> list[Word]:
        """Whole-session recognition with speaker diarization, as words with absolute times.
        Used to correct speaker labels (plan 0008). Same temporary-copy rule as `transcribe`."""
        ...

    def recognize_window(self, audio_wav: bytes, *, language: str) -> list[Word]:
        """Synchronous recognition of ≤ 60 s of WAV audio with speaker diarization.
        Times are relative to the start of `audio_wav`; labels are the model's own."""
        ...
