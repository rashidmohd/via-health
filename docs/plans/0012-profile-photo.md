# Plan 0012 — Profile photo (Settings)

Status: implemented (2026-10-09). Storage changed from the proposal: encrypted column on `users`
instead of the object store (ADR 0011).
Source: `docs/avatar-rive-update.md` section 8. Follows plan 0011.

## Goal
The therapist can use their own photo instead of the illustrated avatar. Static photo in the
ring, optional ±4° perspective tilt toward the pointer (off while recording and with reduced
motion), no face animation. Clients never get photo uploads; client avatars stay initials.

## Browser
- Crop in the browser (circle, zoom/drag), re-encode to 512×512 WebP via canvas. Re-encoding
  drops all metadata, including EXIF/GPS (test: a JPEG with GPS EXIF comes out without it).
- Shown through `UserAvatar` (kind `photo`) inside `AvatarRing`.
- Avatar settings moved from localStorage to the user's account (`kind`, reactions, tilt).
- WebP where the browser can encode it, JPEG otherwise (Safari); preview drawn on a canvas and
  the photo shown as a `data:` URL, because the CSP allows no `blob:` images.

## Backend
- `users`: additive columns `avatar_kind` (`illustrated` | `initials` | `photo`, default
  `illustrated`), `avatar_reactions`, `avatar_tilt` (bool, default false), `avatar_photo_enc`
  (AES-GCM under the server data key, AAD `user:<id>:avatar-photo`).
- `PUT /auth/me/avatar` (raw WebP/JPEG, ≤ 300 KB, rejected if it carries EXIF/XMP/IPTC),
  `GET /auth/me/avatar` (`private, no-store`), `DELETE /auth/me/avatar` (falls back to the
  illustrated avatar). `PATCH /auth/me` sets kind / reactions / tilt; `photo` needs a photo.
- User personal data, not health data; RLS on `users`. Removed on "remove photo" and with the
  account row. Audit log: `avatar_photo_set`, `avatar_photo_removed` (ids only).

## Tests
Upload is the canvas output, never the original file; server rejects EXIF/XMP/IPTC, other types
and > 300 KB; another user cannot read the photo (RLS); delete removes it; photo kind needs a
photo; tilt off while recording and with reduced motion.

## Later (not in this plan)
"Build my avatar" (Rive part variants, config only, picked manually) and "avatar from my photo"
(needs EU availability and zero retention check first).
