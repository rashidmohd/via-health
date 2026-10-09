"""Cut and join decrypted audio with ffmpeg through stdin/stdout pipes only — plaintext audio
is never written to disk (rule 2). Cuts are 16 kHz mono 16-bit WAV, built in memory."""

import io
import shutil
import subprocess
import wave

SAMPLE_RATE = 16_000
FFMPEG_TIMEOUT_S = 120
MIN_AUDIO_MS = 300  # shorter cuts are treated as "no audio"


class AudioCutError(Exception):
    """ffmpeg could not decode or cut the audio. Carries no audio data."""


def _ffmpeg(args: list[str], data: bytes) -> bytes:
    """Run ffmpeg with stdin → stdout pipes. Errors carry no audio data."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise AudioCutError("ffmpeg not installed")
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", *args]
    try:
        result = subprocess.run(  # noqa: S603 (fixed argv, no shell)
            command, input=data, capture_output=True, timeout=FFMPEG_TIMEOUT_S, check=False
        )
    except subprocess.TimeoutExpired:
        raise AudioCutError("ffmpeg timed out") from None
    if result.returncode != 0:
        raise AudioCutError(f"ffmpeg exit {result.returncode}")
    return result.stdout


def _to_pcm(audio: bytes) -> bytes:
    return _ffmpeg(
        ["-i", "pipe:0", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1"], audio
    )


def join_segments(segments: list[tuple[int, bytes]]) -> bytes:
    """Join recorder files (ADR 0022) into one WebM/Opus file. `segments` = (start_ms, file)
    in order; the gap before each segment becomes silence so times match the recording clock.
    Each segment is decoded on its own: a second container header can't be byte-joined."""
    pcm = bytearray()
    try:
        for start_ms, audio in segments:
            target = start_ms * SAMPLE_RATE // 1000 * 2  # bytes of 16-bit mono
            if len(pcm) < target:
                pcm += bytes(target - len(pcm))
            pcm += _to_pcm(audio)
        return _ffmpeg(
            ["-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-i", "pipe:0",
             "-c:a", "libopus", "-b:a", "32k", "-f", "webm", "pipe:1"],
            bytes(pcm),
        )  # fmt: skip
    finally:
        pcm[:] = bytes(len(pcm))  # best effort: overwrite plaintext audio


def cut_to_wav(audio: bytes, start_ms: int, end_ms: int) -> bytes | None:
    """Return [start_ms, end_ms) as WAV, or None if that range has (almost) no audio."""
    pcm = _ffmpeg(
        ["-i", "pipe:0",
         "-ss", f"{start_ms / 1000:.3f}", "-to", f"{end_ms / 1000:.3f}",
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1"],
        audio,
    )  # fmt: skip
    if len(pcm) // 2 < SAMPLE_RATE * MIN_AUDIO_MS // 1000:
        return None
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm)
    return out.getvalue()


def wav_duration_ms(wav_bytes: bytes) -> int:
    with wave.open(io.BytesIO(wav_bytes)) as wav:
        return int(wav.getnframes() * 1000 // wav.getframerate())
