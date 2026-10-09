# 0022 — Reconnect the microphone mid-recording (segments)

Status: accepted (2026-10-09)

## Decision
- A lost microphone no longer ends the useful part of a recording. The recording keeps
  running; the alert offers **Reconnect microphone**, and the app also reconnects by itself
  when a microphone appears again (`devicechange`). Permission is already granted, so no prompt.
- Each (re)connect starts a new MediaRecorder = a new **segment** (0, 1, 2 …). `seq` stays
  continuous across segments. Every chunk carries `segment` and `segment_start_ms` (recording
  time when the segment started); sent as `X-Segment` / `X-Segment-Start-Ms` on upload.
- `audio_chunks` gets two additive columns, `segment` and `segment_start_ms` (default 0, so
  existing rows are one segment).
- Workers: one segment → unchanged byte concatenation. Several segments → each is decoded to
  16 kHz PCM separately (ffmpeg pipes), the gap before each segment is filled with silence so
  times match the recording clock (bookmarks, duration), and the result is encoded once to
  WebM/Opus in memory. Everything after that (windows, batch, refine) sees one normal file.
- Opening the microphone checks that samples actually flow (`openMicrophone`): Safari on macOS
  delivers a dead stream when a Bluetooth headset switches to call mode right after opening;
  the second open works. Used for the mic test, the start and every reconnect.

## Why
Silent audio loss is the worst failure (offline-recorder skill). Stop + new session would split
one appointment into two sessions and two drafts. Restarting only the MediaRecorder writes a
new container header, which byte concatenation cannot handle, hence segments.

## Consequences
- Multi-segment sessions cost one decode + encode on the worker per pass (seconds of CPU for a
  50-minute session); single-segment sessions are unaffected.
- The gap is silence in the transcript timeline; nothing is invented for it.
- Mixed formats across segments are fine (each segment is decoded on its own).
