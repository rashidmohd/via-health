# Plan 0011 — Rive avatar, listening ring, voice detection, mic health

Status: implemented (2026-10-09), steps 1–7. Waiting on the designer's `.riv`. Source:
`docs/avatar-rive-update.md`. Decisions: ADR 0010. Profile photo: plan 0012.

## What exists
- `src/avatar/`: SVG placeholder face (`Avatar.tsx`), mood rules (`mood.ts`, tested), payload-free
  app events (`events.ts`), `useAvatarMood`. Shown on Today (120 px) and the session page (56 px).
  The image-grid avatar from the old skill was never built (no assets).
- Record screen: client initials, red "recording" pill, `timer-ring`, no avatar.
- Live preview worker starts only when the collapsed live panel is opened and the preview is on;
  it stops itself on `too_slow` / `error`. Worklet frames arrive at the AudioContext rate (e.g. 48 kHz).
- No Settings page, no Workbox, `capture.noted` never emitted.

## Changes from the change request (approved)
1. **VAD runs in its own small AudioWorklet started with every recording** (`src/recorder/`),
   not in the live-STT worker — otherwise mic health would rarely run. RMS + hysteresis + 600 ms
   hold. Silero via sherpa-onnx later (needs resampling to 16 kHz).
2. **Mic picker sets the device for the next recording**; the 2-minute warning tells the user to
   stop and restart. Hot-switching the device mid-recording is a separate recorder change.
3. **Profile photo upload** (schema, endpoint, object store) gets its own plan (0012). This plan
   ships Rive (default) and Initials in Settings.
4. **No Workbox exists**: the `.riv` and Rive WASM are served from our origin with long cache
   headers; adding a service worker is a separate decision.
5. **Keep `mood.ts` + `events.ts` as the single app-level avatar store** (no new `useAvatarStore`).
6. **Rive WASM self-hosted** (`RuntimeLoader.setWasmUrl`) — the default loads from unpkg (rule 4).

## Steps
1. `AvatarRing` + CSS around existing avatars (`idle`), badges.
2. VAD worklet → `voiceActive` store → ring `silent` / `listening` on the record screen.
3. Mic health: level meter + voice dot, 2-minute warning with device picker, 5 s first-time mic test.
4. `RiveAvatar` with placeholder PNG fallback; mood timings per change request; `report.signed`
   event; consent missing → `concern`; `capture.noted` from confirmed chips (opt-in).
5. Ring `processing` on report drafting and session transcribing; check / cloud-off badges.
6. Settings page: avatar choice (Rive, Initials), nod-on-capture setting.
7. Remove the SVG avatar and its CSS; update CLAUDE.md and skills.

## Tests
VAD (no flicker under hold, off after silence, stable on constant noise), ring state mapping,
Rive fallback when the file is missing, avatar paused while recording, mic warning after 2 min
of silence, mic test detects voice, avatar code takes no audio/transcript input.
