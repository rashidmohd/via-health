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
