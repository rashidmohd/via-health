# 0011 — Profile photo stored encrypted in the users row

Status: accepted (2026-10-09). Plan 0012.

## Context
Plan 0012 proposed storing the therapist's profile photo behind `ObjectStore` in the GCS bucket.
Three things argue against that: the bucket deletes **every** object after 30 days (lifecycle
rule for audio, CLAUDE.md rule 6), so photos would disappear; `ObjectStore` is defined as
"ciphertext only"; and the interim Postgres store keys objects by session for RLS.

## Decision
- The photo (≤ 300 KB, 512×512 WebP or JPEG) is stored in `users.avatar_photo_enc`, encrypted
  with the server data key (same scheme as client details, ADR 0004; AAD names the user).
- Row-level security on `users` covers it; it goes with the account row; no bucket rule applies.
- The browser crops and re-encodes on a canvas, which drops EXIF/GPS. The server re-checks and
  rejects files carrying EXIF/XMP/IPTC blocks or any other type.
- Served by `GET /auth/me/avatar` with `Cache-Control: private, no-store`; shown as a `data:` URL
  (the CSP allows no `blob:` images).

## Consequences
- No new storage path, bucket rule or adapter; one additive migration.
- Postgres row size grows by up to ~300 KB for users with a photo — fine for a single therapist
  per account; revisit for large practices.
