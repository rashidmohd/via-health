# Plan 0015 — Shred job, retention sweep, capture chips at signing

Status: built 2026-10-09. STATUS "deletion jobs"; CLAUDE.md rules 6, 10, 17.

## Goal
Audio is temporary (rule 6). Sessions marked `audio_state = shred_pending` (signed, plan 0014;
consent withdrawn, rule 10) and unsigned sessions past `retention_deadline` (30 days) lose their
audio for good. Capture chip texts do not outlive the signed record on the server.

## Shred job (`app/workers/shred.py`, arq `shred_session`)
- Found every 15 s with the other work: `audio_state = 'shred_pending'`, or `'present'` with
  `retention_deadline < now()` (retention sweep: marked `shred_pending` first, audit reason
  `retention`).
- Transaction 1 (crypto-shred): delete all `wrapped_keys` of the session (processing and
  therapist copy) and leftover `transcript_windows`. Committed first: from here on any copy of
  the audio anywhere (bucket, backups) is unreadable.
- Then delete objects `sessions/<id>/` and temporary STT copies `stt-tmp/<id>*` through the
  `ObjectStore` adapter.
- Transaction 2: `audio_state = 'shredded'`, audit `audio_shredded` (ids, object count, reason).
- Idempotent: a crash anywhere leaves `shred_pending`; the next run repeats the (no-op) deletes.
- Kept: `audio_chunks` rows (sequence, size, checksum — no audio), transcripts and notes.
- DB guard: `audio_state` only moves forward (`present → shred_pending → shredded`).
- Worker grants: `UPDATE (audio_state)` on sessions, `DELETE` on `wrapped_keys`, `object_blobs`.

## Capture chips at signing
- `sign/prepare` adds the confirmed chips (`kind`, `at_ms`, `text`) to the signed note, so the
  record keeps what the therapist confirmed (statements refer to them by id).
- `sign` deletes all capture rows of the session in the same transaction.

## Tests
Shred: keys, objects, temp copies and windows gone; state `shredded`; run twice is a no-op;
withdrawn consent is shredded; retention reached is shredded, not before; signed session
shredded; transcript and note kept; worker cannot move `audio_state` back; processing after
shred fails cleanly. Captures: confirmed chips in the prepared note, all rows gone after sign.
