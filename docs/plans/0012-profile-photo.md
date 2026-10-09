# Plan 0012 — Profile photo (Settings)

Status: proposed, waiting for approval (touches the DB schema and object storage).
Source: `docs/avatar-rive-update.md` section 8. Follows plan 0011.

## Goal
The therapist can use their own photo instead of the illustrated avatar. Static photo in the
ring, optional ±4° perspective tilt toward the pointer (off while recording and with reduced
motion), no face animation. Clients never get photo uploads; client avatars stay initials.

## Browser
- Crop in the browser (circle, zoom/drag), re-encode to 512×512 WebP via canvas. Re-encoding
  drops all metadata, including EXIF/GPS (test: a JPEG with GPS EXIF comes out without it).
- Shown through `UserAvatar` (kind `photo`) inside `AvatarRing`.
- Avatar settings move from localStorage to the user's account (`kind`, `nodOnCapture`).

## Backend
- `users`: additive columns `avatar_kind` (`illustrated` | `initials` | `photo`, default
  `illustrated`), `avatar_reactions` (bool, default false), `avatar_object` (nullable key).
- `PUT /me/avatar` (presigned upload, WebP only, ≤ 200 KB), `DELETE /me/avatar`,
  `GET /me/avatar` (short-lived signed URL). Behind `ObjectStore`, bucket `europe-west4`, path
  per user. User personal data, not health data; access only by the user (RLS).
- Deleted on "remove photo" and with the account.

## Tests
EXIF stripped; wrong type / too large rejected; another user cannot read the photo; delete
removes the object; tilt off while recording.

## Later (not in this plan)
"Build my avatar" (Rive part variants, config only, picked manually) and "avatar from my photo"
(needs EU availability and zero retention check first).
