from app.domain.transcript import (
    OVERLAP_MS,
    STEP_MS,
    Word,
    labels_in_order,
    map_speakers,
    stitch,
    window_audio_range,
    windows_for_duration,
    windows_ready_while_recording,
    words_to_segments,
)


def w(speaker: str | None, start_s: float, text: str) -> Word:
    return Word(speaker, int(start_s * 1000), int(start_s * 1000) + 400, text)


def test_window_ranges_stay_below_sync_limit() -> None:
    assert window_audio_range(0) == (0, STEP_MS)
    start, end = window_audio_range(3)
    assert start == 3 * STEP_MS - OVERLAP_MS
    assert end - start < 60_000


def test_ready_windows_need_full_audio_plus_margin() -> None:
    # 48 s per window, 10 s chunks, newest chunk not counted
    assert windows_ready_while_recording(5) == 0  # 40 s usable
    assert windows_ready_while_recording(6) == 1  # 50 s usable
    assert windows_ready_while_recording(11) == 2  # 100 s usable
    assert windows_for_duration(1) == 1
    assert windows_for_duration(STEP_MS) == 1
    assert windows_for_duration(STEP_MS + 1) == 2


def test_stitch_drops_duplicated_overlap() -> None:
    first = [w("1", 1, "eins"), w("2", 40, "vierzig"), w("2", 45, "fünfundvierzig")]
    # window 1 repeats 38–48 s and continues
    second = [w("1", 40, "vierzig"), w("1", 45, "fünfundvierzig"), w("1", 50, "fünfzig")]
    texts = [x.text for x in stitch([first, second])]
    assert texts == ["eins", "vierzig", "fünfundvierzig", "fünfzig"]


def test_speakers_matched_across_windows_even_when_labels_swap() -> None:
    previous = [w("1", 30, "wie"), w("2", 39, "gut"), w("2", 41, "danke"), w("1", 46, "schön")]
    # The model labelled the same voices the other way round in the next window.
    new_raw = [w("B", 39, "gut"), w("B", 41, "danke"), w("A", 46, "schön"), w("A", 55, "weiter")]
    mapped = map_speakers(previous, new_raw, known=["1", "2"])
    assert [(x.text, x.speaker) for x in mapped] == [
        ("gut", "2"),
        ("danke", "2"),
        ("schön", "1"),
        ("weiter", "1"),
    ]


def test_unmatched_label_takes_the_free_known_speaker() -> None:
    previous = [w("1", 40, "ja")]
    new_raw = [w("X", 40, "ja"), w("Y", 52, "neu")]
    mapped = map_speakers(previous, new_raw, known=["1", "2"])
    assert [x.speaker for x in mapped] == ["1", "2"]


def test_third_voice_gets_new_label() -> None:
    previous = [w("1", 40, "ja"), w("2", 44, "nein")]
    new_raw = [w("a", 40, "ja"), w("b", 44, "nein"), w("c", 50, "hallo")]
    assert [x.speaker for x in map_speakers(previous, new_raw, known=["1", "2"])] == ["1", "2", "3"]


def test_first_window_and_segments() -> None:
    words = map_speakers([], [w("7", 0, "Guten"), w("7", 0.5, "Tag."), w("3", 2, "Hallo.")], [])
    assert labels_in_order(words) == ["1", "2"]
    segments = words_to_segments(words)
    assert [(s.speaker, s.text) for s in segments] == [("1", "Guten Tag."), ("2", "Hallo.")]


def test_no_diarization_labels_stay_empty() -> None:
    assert [x.speaker for x in map_speakers([], [w(None, 1, "x")], [])] == [None]


# --- plan 0008: refinement and manual corrections ----------------------------------

from app.domain.transcript import Segment, apply_overrides, relabel_by_reference  # noqa: E402


def test_refinement_fixes_a_swapped_minute_and_keeps_label_names() -> None:
    # Windows got minute 2 the wrong way round.
    words = [w("1", 1, "a"), w("2", 5, "b"), w("2", 50, "c"), w("1", 55, "d")]
    # Whole-session diarization (its own label names) knows better.
    batch = [w("X", 1, "a"), w("Y", 5, "b"), w("X", 50, "c"), w("Y", 55, "d")]
    fixed = relabel_by_reference(words, batch)
    assert [x.speaker for x in fixed] == ["1", "2", "1", "2"]
    assert [x.text for x in fixed] == ["a", "b", "c", "d"]  # text never changes


def test_refinement_keeps_label_when_nothing_close() -> None:
    words = [w("1", 1, "a"), w("2", 30, "b")]
    fixed = relabel_by_reference(words, [w("X", 1, "a")])
    assert [x.speaker for x in fixed] == ["1", "2"]
    assert relabel_by_reference(words, []) == words


def seg(speaker: str, start_s: float, end_s: float, text: str) -> Segment:
    return Segment(speaker, int(start_s * 1000), int(end_s * 1000), text)


def test_set_override_changes_one_line_and_joins_neighbours() -> None:
    segments = [seg("1", 0, 2, "Hallo."), seg("2", 3, 4, "Ja."), seg("1", 5, 6, "Gut.")]
    out = apply_overrides(segments, [{"op": "set", "at_ms": 3500, "speaker": "1"}])
    assert [(s.speaker, s.text) for s in out] == [("1", "Hallo. Ja. Gut.")]


def test_swap_from_here() -> None:
    segments = [seg("1", 0, 2, "a"), seg("2", 3, 4, "b"), seg("1", 5, 6, "c"), seg("2", 7, 8, "d")]
    out = apply_overrides(segments, [{"op": "swap_from", "at_ms": 5000, "a": "1", "b": "2"}])
    assert [(s.speaker, s.text) for s in out] == [("1", "a"), ("2", "b c"), ("1", "d")]


def test_overrides_apply_in_order() -> None:
    segments = [seg("1", 0, 2, "a"), seg("2", 3, 4, "b")]
    ops = [
        {"op": "swap_from", "at_ms": 0, "a": "1", "b": "2"},
        {"op": "set", "at_ms": 0, "speaker": "1"},
    ]
    assert [(s.speaker, s.text) for s in apply_overrides(segments, ops)] == [("1", "a b")]
