from app.adapters.stt.base import Segment


class FakeSttProvider:
    """Deterministic transcripts for tests and local development without Google."""

    def __init__(self, segments: list[Segment] | None = None) -> None:
        self.calls: list[dict[str, object]] = []
        self._segments = segments

    def transcribe(
        self, audio: bytes, *, mime_type: str, language: str, job_id: str
    ) -> list[Segment]:
        self.calls.append(
            {"bytes": len(audio), "mime_type": mime_type, "language": language, "job_id": job_id}
        )
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
