"""Transcript building blocks: words, segments, and transcription in overlapping windows
while the session is still recording (docs/plans/0006-transcribe-during-session.md).

All times are milliseconds from the start of the recording."""

from bisect import bisect_left
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, replace
from typing import Any

CHUNK_MS = 10_000  # browser slice length (apps/web/src/recorder/recorder.ts)
STEP_MS = 43_000  # new audio per window
OVERLAP_MS = 15_000  # repeated from the previous window, used to match speakers (plan 0008 C)
# STEP + OVERLAP = 58 s, below the 60 s limit of synchronous Recognize.
MATCH_TOLERANCE_MS = 800


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


# --- speaker refinement (plan 0008 A) ---------------------------------------------


def relabel_by_reference(words: Sequence[Word], reference: Sequence[Word]) -> list[Word]:
    """Give each word the speaker of the nearest reference word (whole-session diarization),
    keeping the existing label names: reference labels are renamed to the labels they overlap
    most. Words without a reference word nearby keep their label. Text never changes."""
    ref = sorted((w for w in reference if w.speaker is not None), key=lambda w: w.start_ms)
    if not ref:
        return list(words)
    starts = [w.start_ms for w in ref]

    def nearest(word: Word) -> Word | None:
        i = bisect_left(starts, word.start_ms)
        best = min(
            (ref[j] for j in (i - 1, i) if 0 <= j < len(ref)),
            key=lambda r: abs(r.start_ms - word.start_ms),
            default=None,
        )
        if best is None or abs(best.start_ms - word.start_ms) > MATCH_TOLERANCE_MS:
            return None
        return best

    matches = [(w, nearest(w)) for w in words]
    votes: Counter[tuple[str, str]] = Counter(
        (r.speaker, w.speaker)  # type: ignore[misc]
        for w, r in matches
        if r is not None and w.speaker is not None
    )
    rename: dict[str, str] = {}
    used: set[str] = set()
    for (ref_label, label), _count in votes.most_common():
        if ref_label not in rename and label not in used:
            rename[ref_label] = label
            used.add(label)
    known = labels_in_order(words)
    for ref_label in labels_in_order(ref):
        if ref_label not in rename:
            free = [k for k in known if k not in used]
            new_label = free[0] if free else str(len(known) + 1)
            if new_label not in known:
                known.append(new_label)
            rename[ref_label] = new_label
            used.add(new_label)

    return [
        replace(w, speaker=rename[r.speaker]) if r is not None and r.speaker else w
        for w, r in matches
    ]


# --- manual corrections (plan 0008 B) ----------------------------------------------

MAX_OVERRIDES = 500


def apply_overrides(
    segments: Sequence[Segment], overrides: Sequence[dict[str, Any]]
) -> list[Segment]:
    """Apply the therapist's corrections in order, then join neighbours with the same speaker.

    - {"op": "set", "at_ms": t, "speaker": s}: the line at time t is by s.
    - {"op": "swap_from", "at_ms": t, "a": x, "b": y}: from time t on, x and y are swapped."""
    out = list(segments)
    for op in overrides:
        at = int(op.get("at_ms", 0))
        if op.get("op") == "set" and out:
            idx = _segment_at(out, at)
            out[idx] = replace(out[idx], speaker=str(op["speaker"]))
        elif op.get("op") == "swap_from":
            a, b = str(op["a"]), str(op["b"])
            out = [
                replace(s, speaker=b if s.speaker == a else a if s.speaker == b else s.speaker)
                if s.start_ms >= at
                else s
                for s in out
            ]
    return _join(out)


def _segment_at(segments: Sequence[Segment], at_ms: int) -> int:
    for i, s in enumerate(segments):
        if s.start_ms <= at_ms <= s.end_ms:
            return i
    return min(range(len(segments)), key=lambda i: abs(segments[i].start_ms - at_ms))


def _join(segments: Sequence[Segment]) -> list[Segment]:
    joined: list[Segment] = []
    for s in segments:
        if joined and joined[-1].speaker == s.speaker:
            last = joined[-1]
            joined[-1] = Segment(last.speaker, last.start_ms, s.end_ms, f"{last.text} {s.text}")
        else:
            joined.append(s)
    return joined
