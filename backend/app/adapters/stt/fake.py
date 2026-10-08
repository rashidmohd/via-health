from app.adapters.stt.base import Segment, Word


class FakeSttProvider:
    """Deterministic transcripts for tests and local development without Google."""

    def __init__(self, segments: list[Segment] | None = None) -> None:
        self.calls: list[dict[str, object]] = []
        self._segments = segments
        self.diarized_words: list[Word] | None = None

    def transcribe(
        self, audio: bytes, *, mime_type: str, language: str, job_id: str
    ) -> list[Segment]:
        self.calls.append(
            {"bytes": len(audio), "mime_type": mime_type, "language": language, "job_id": job_id}
        )
        return self._fixed_segments(language)

    def _fixed_segments(self, language: str) -> list[Segment]:
        if self._segments is not None:
            return self._segments
        hello = (
            "Hallo, wie geht es Ihnen heute?"
            if language.startswith("de")
            else "Hello, how are you today?"
        )
        reply = (
            "Danke, besser als letzte Woche."
            if language.startswith("de")
            else "Thanks, better than last week."
        )
        return [
            Segment(speaker="1", start_ms=0, end_ms=2500, text=hello),
            Segment(speaker="2", start_ms=2600, end_ms=5200, text=reply),
        ]

    def diarize_words(
        self, audio: bytes, *, mime_type: str, language: str, job_id: str
    ) -> list[Word]:
        """Whole-session speakers as words. Default: the window words, labels as given."""
        self.calls.append(
            {"bytes": len(audio), "mime_type": mime_type, "language": language, "job_id": job_id}
        )
        if self.diarized_words is not None:
            return self.diarized_words
        return [
            Word(s.speaker, s.start_ms, s.end_ms, s.text) for s in self._fixed_segments(language)
        ]

    def recognize_window(self, audio_wav: bytes, *, language: str) -> list[Word]:
        """Two speakers: one word at 12 s ("A"), one at 30 s ("B"), relative to the window —
        after the 10 s overlap, so each window contributes both words to the transcript."""
        self.calls.append({"window_bytes": len(audio_wav), "language": language})
        return [Word("A", 12_000, 12_400, "hallo"), Word("B", 30_000, 30_400, "danke")]
