"""Transcript building blocks: words, segments, and transcription in overlapping windows
while the session is still recording (docs/plans/0006-transcribe-during-session.md).

All times are milliseconds from the start of the recording."""

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, replace
from typing import Any

CHUNK_MS = 10_000  # browser slice length (apps/web/src/recorder/recorder.ts)
STEP_MS = 48_000  # new audio per window
OVERLAP_MS = 10_000  # repeated from the previous window, used to match speakers
# STEP + OVERLAP = 58 s, below the 60 s limit of synchronous Recognize.
MATCH_TOLERANCE_MS = 500


@dataclass(frozen=True)
class Word:
    speaker: str | None
    start_ms: int
    end_ms: int
    text: str

    def to_json(self) -> dict[str, Any]:
        return asdict(self)

    def shifted(self, offset_ms: int) -> "Word":
        return replace(self, start_ms=self.start_ms + offset_ms, end_ms=self.end_ms + offset_ms)


@dataclass(frozen=True)
class Segment:
    """A run of words by one speaker. `speaker` is a label ("1", "2"); the therapist decides
    which label is them."""

    speaker: str | None
    start_ms: int
    end_ms: int
    text: str

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def words_to_segments(words: Iterable[Word]) -> list[Segment]:
    """Group consecutive words with the same speaker."""
    segments: list[Segment] = []
    run: list[Word] = []

    def flush() -> None:
        if run:
            text = " ".join(w.text for w in run).strip()
            if text:
                segments.append(Segment(run[0].speaker, run[0].start_ms, run[-1].end_ms, text))
            run.clear()

    for word in words:
        if run and word.speaker != run[0].speaker:
            flush()
        run.append(word)
    flush()
    return segments


# --- windows -----------------------------------------------------------------------


def window_audio_range(idx: int) -> tuple[int, int]:
    """Audio sent for window `idx`: its new part plus the overlap before it."""
    start = idx * STEP_MS
    return max(0, start - OVERLAP_MS), start + STEP_MS


def windows_ready_while_recording(contiguous_chunks: int) -> int:
    """Windows whose audio is fully uploaded. One chunk of margin: the newest slice may be
    shorter than CHUNK_MS."""
    available_ms = max(0, contiguous_chunks - 1) * CHUNK_MS
    return available_ms // STEP_MS


def windows_for_duration(duration_ms: int) -> int:
    return max(1, -(-duration_ms // STEP_MS))  # ceil


def _cut(idx: int) -> int:
    """Window idx owns words starting from the middle of its overlap."""
    return 0 if idx == 0 else idx * STEP_MS - OVERLAP_MS // 2


def stitch(windows: Sequence[Sequence[Word]]) -> list[Word]:
    """Join consecutive windows (index = window idx), dropping the duplicated overlap."""
    out: list[Word] = []
    for idx, words in enumerate(windows):
        low, high = _cut(idx), _cut(idx + 1) if idx + 1 < len(windows) else None
        out.extend(w for w in words if w.start_ms >= low and (high is None or w.start_ms < high))
    return out


def _norm(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())


def map_speakers(previous: Sequence[Word], new: Sequence[Word], known: Sequence[str]) -> list[Word]:
    """Rename the speaker labels of `new` (raw labels of one window, absolute times) to the
    labels used so far.

    Words in the overlap appear in both windows; each raw label takes the known label it
    shares most words with. Labels without a match take a free known label (two-person
    sessions), otherwise a new one. `known` = labels used so far, in order of appearance."""
    overlap_end = max((w.end_ms for w in previous), default=0)
    pairs: Counter[tuple[str, str]] = Counter()
    for word in new:
        if word.speaker is None or word.start_ms > overlap_end:
            continue
        candidates = [
            p
            for p in previous
            if p.speaker is not None and abs(p.start_ms - word.start_ms) <= MATCH_TOLERANCE_MS
        ]
        if not candidates:
            continue
        same_text = [p for p in candidates if _norm(p.text) == _norm(word.text)]
        best = min(same_text or candidates, key=lambda p: abs(p.start_ms - word.start_ms))
        assert best.speaker is not None
        pairs[(word.speaker, best.speaker)] += 1

    mapping: dict[str, str] = {}
    used: set[str] = set()
    for (raw, label), _count in pairs.most_common():
        if raw not in mapping and label not in used:
            mapping[raw] = label
            used.add(label)

    next_known = list(known)
    for word in new:
        unmapped = word.speaker
        if unmapped is None or unmapped in mapping:
            continue
        free = [known_label for known_label in next_known if known_label not in used]
        new_label = free[0] if free else str(len(next_known) + 1)
        if new_label not in next_known:
            next_known.append(new_label)
        mapping[unmapped] = new_label
        used.add(new_label)

    return [replace(w, speaker=mapping.get(w.speaker) if w.speaker else None) for w in new]


def labels_in_order(words: Iterable[Word]) -> list[str]:
    seen: list[str] = []
    for word in words:
        if word.speaker is not None and word.speaker not in seen:
            seen.append(word.speaker)
    return seen
