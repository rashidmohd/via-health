import shutil
import subprocess

import pytest

from app.core.audio import AudioCutError, cut_to_wav, join_segments, wav_duration_ms

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def opus_webm(seconds: int) -> bytes:
    """Like the browser's MediaRecorder output: Opus in WebM."""
    return subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi",
         "-i", f"sine=frequency=440:duration={seconds}",
         "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-f", "webm", "pipe:1"],
        capture_output=True, check=True,
    ).stdout  # fmt: skip


def test_cuts_a_range_from_concatenated_chunks() -> None:
    audio = opus_webm(70)
    # Browser chunks are byte slices of one stream; joined they are the original file.
    chunks = [audio[i : i + 4000] for i in range(0, len(audio), 4000)]
    wav = cut_to_wav(b"".join(chunks), 38_000, 96_000)
    assert wav is not None and wav[:4] == b"RIFF"
    assert wav_duration_ms(wav) == pytest.approx(32_000, abs=200)  # audio ends at 70 s


def test_range_after_the_end_is_empty() -> None:
    assert cut_to_wav(opus_webm(5), 10_000, 20_000) is None


def test_garbage_raises() -> None:
    with pytest.raises(AudioCutError):
        cut_to_wav(b"not audio", 0, 1000)


def rms(wav: bytes) -> float:
    import array
    import io
    import wave

    with wave.open(io.BytesIO(wav)) as w:
        samples = array.array("h", w.readframes(w.getnframes()))
    return (sum(s * s for s in samples) / max(1, len(samples))) ** 0.5


def test_join_segments_keeps_the_recording_clock() -> None:
    # Microphone lost after 5 s, reconnected at 8 s (ADR 0022): two files, a 3 s gap.
    joined = join_segments([(0, opus_webm(5)), (8_000, opus_webm(5))])
    whole = cut_to_wav(joined, 0, 60_000)
    assert whole is not None
    assert wav_duration_ms(whole) == pytest.approx(13_000, abs=200)
    gap = cut_to_wav(joined, 5_500, 7_500)
    assert gap is not None and rms(gap) < 50  # silence
    second = cut_to_wav(joined, 8_500, 12_500)
    assert second is not None and rms(second) > 1000  # the tone is back


def test_join_segments_rejects_garbage() -> None:
    with pytest.raises(AudioCutError):
        join_segments([(0, opus_webm(2)), (3_000, b"not audio")])
