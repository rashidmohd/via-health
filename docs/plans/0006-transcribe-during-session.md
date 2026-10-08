# Plan 0006 — Transcribe during the session

Status: implemented (2026-10-08). Real check with a synthetic 3-min German two-voice
conversation: 4 windows in 12 s (parallel), speakers consistent across all window boundaries,
no duplicated or lost words. Audio is cut to in-memory WAV (16 kHz mono) instead of FLAC:
FLAC written to a pipe has no length in its header.

## Why
Today transcription starts after Stop and uses BatchRecognize. Measured 2026-10-08: a 20 s test
conversation took ~5 min in batch (mostly Google queue overhead). The same audio with
synchronous `Recognize` (chirp_3, location `eu`, **with speaker diarization**) took **~3 s**.

## Idea
Transcribe the session in ~1-minute windows **while recording**. When the therapist presses Stop,
only the last window is left, so the transcript is ready seconds later instead of minutes.

## How
1. Chunks keep uploading every 10 s (exists).
2. Worker sweep (every 15 s) finds sessions in `recording` with ≥ 60 s of new, contiguous
   uploaded audio beyond the last window → job `transcribe_window(session_id)`.
3. Window job (one at a time per session):
   - unwrap the session key (KMS), decrypt chunks 0..n in memory,
   - ffmpeg via stdin/stdout pipes (no files) cuts `[start − 10 s, end]` to FLAC,
   - `Recognize` (chirp_3, `eu`, language of the client, diarization 2 speakers),
   - store the window **encrypted** in `transcript_windows` (words with times and speaker).
4. **Speaker labels across windows:** every window overlaps the previous one by 10 s. Words in the
   overlap appear in both; the new window's labels are mapped to the existing ones by majority
   vote on those words (time-matched). The therapist still chooses once "which speaker is me".
5. **Stop:** last window(s) transcribed, windows stitched (overlap removed by time), stored as the
   final transcript → `transcribed`.
6. **Fallback:** if windows are missing or failed (worker down, offline upload arrived late), the
   current BatchRecognize path runs as today.
7. Session page: during recording, "Transcript so far: N minutes"; after Stop the transcript
   appears within seconds.

## Database (additive)
`transcript_windows(session_id, idx, start_ms, end_ms, words_enc, created_at)`, PK (session_id, idx),
RLS like transcripts, worker role may write. Deleted after the final transcript is stored.

## Trade-offs
- Speaker separation on 1-minute windows is slightly less reliable than on the whole session;
  the overlap mapping keeps labels consistent. "Change who is who" stays available.
- More API calls (one per minute of audio) — cost is the same per minute of audio.
- Consent is checked before every window; withdrawn consent stops windowing immediately.

## Tests
Overlap stitching (no duplicated/lost words), speaker mapping across windows (incl. swapped
labels), missing chunk → wait, window job idempotent, consent withdrawn mid-session, fallback to
batch, ffmpeg pipe never writes files. Manual: real 3-minute test recording on staging.
