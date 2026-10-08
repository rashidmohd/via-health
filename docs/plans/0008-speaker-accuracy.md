# Plan 0008 — Speaker accuracy

Status: implemented (2026-10-08). Real check (3-min synthetic German conversation): windows 13 s,
whole-session batch 36 s, relabel kept text identical (0 changes needed on clean audio).

## Problem
Speakers are separated per ~1-minute window (plan 0006). Two failure kinds:
1. At a window boundary the label matching has too little overlap → a whole minute swapped.
2. Inside a window, short turns or similar voices get the wrong label.

## A — Refine speakers after Stop (background)
- The transcript still appears seconds after Stop (windows). Its **words** are now stored too.
- Worker job `refine_speakers`: one BatchRecognize with diarization over the whole session
  (Chirp 3, `eu`; temporary GCS object deleted as before), then **relabel** the stored words by
  time: each word takes the batch speaker of the batch word nearest in time; batch labels are
  renamed to the existing labels by majority so the therapist's "that's me" choice stays valid.
- Text is never changed by refinement, only speaker labels.
- `transcripts.refine_status`: `pending` → `running` → `done` | `failed` | `skipped`
  (skipped: transcript already came from batch). Failure keeps the window labels.
- UI: "Checking who said what…" while pending/running; transcript refreshes when done.
- Cost: ~2× Speech-to-Text minutes per session.

## B — Manual correction
- Per line: click the speaker → it switches Therapist ↔ Client.
- Per line: "Swap from here" → Therapist and Client swapped for all following lines.
- Undo (last correction).
- Stored as an ordered list of operations in `transcripts.speaker_overrides` (times + labels
  only, no text) and applied on read, **after** refinement — manual corrections always win and
  survive a later refinement.

## C — Better matching between windows
- Overlap 10 s → **15 s** (window step 48 s → 43 s; still ≤ 58 s per synchronous request).
- Match tolerance 500 ms → 800 ms.

## Database (additive)
`transcripts.refine_status text`, `transcripts.speaker_overrides jsonb` (no PHI).

## Tests
Relabel: swapped minute fixed, label names preserved, unmatched words keep labels; refinement
idempotent, skipped for batch transcripts, failure keeps labels, consent withdrawn → not run;
overrides: set, swap-from, undo, survive refinement; API RLS; UI de/en.
