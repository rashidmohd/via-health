# 0010 — Rive avatar, listening ring, voice activity and mic health

Status: accepted (2026-10-09). Plan 0011; change request `docs/avatar-rive-update.md`.

## Context
The SVG placeholder face showed moods but nothing during a recording. Therapists also need to
know the microphone is actually picking up speech: silent audio loss is the worst recorder
failure. The face must never react to what is said or how anyone sounds (CLAUDE.md rule 12).

## Decision
- **Avatar:** one designer-made, rigged Rive character (`@rive-app/react-canvas`, MIT). Inputs:
  `lookX`, `lookY`, `emotion` (0–6), `recording`, `noted` (artboard and state machine `Avatar`).
  Moods still come from `mood.ts` + `events.ts` (app state and payload-free app events only).
  Until `public/avatar/sessio-avatar.riv` exists, a static placeholder PNG is shown with the same
  props. The avatar code is only loaded when the file exists and starts with the `RIVE` header.
- **Rive runtime served from our origin** (`RuntimeLoader.setWasmUrl` / `setWasmFallbackUrl`
  with Vite-bundled `.wasm`). The default would fetch it from unpkg / jsdelivr (rule 4).
- **Voice activity is shown only by a CSS ring around the avatar**, binary (`silent` /
  `listening`), never scaled by loudness, no difference between speakers. The character is
  paused 600 ms after recording starts.
- **VAD runs in its own AudioWorklet** (`public/mic-level.js`, RMS only, no samples leave the
  worklet) started with every recording by the recorder, not in the live-STT worker as the
  change request proposed: the preview worker only runs when the collapsed live panel is open
  and stops itself on slow devices, so mic health would rarely run. Detection: RMS with
  hysteresis, 600 ms hold, thresholds calibrated on the first 2 s. Silero (sherpa-onnx) can
  replace it later behind the same `VoiceDetector` interface (needs resampling: frames arrive at
  the AudioContext rate, usually 48 kHz). Nothing about voice activity is logged.
- **Mic health:** level meter + voice indicator while recording; warning after 2 minutes without
  speech; a 5-second mic test before the first recording on a device. The microphone picker sets
  the device for the **next** recording; switching mid-recording would need a second
  MediaRecorder and is not built.
- **`noted`** fires when a new capture chip appears from a finished line of the live transcript
  (chips are read-only during the session, so "confirmed" = not from a partial line). Only with
  the therapist's opt-in setting (off by default).
- **Settings** (per device for now): illustrated avatar (default) or initials; reactions on/off.
  Profile photo: plan 0012.
- **Caching:** there is no service worker (Workbox is listed in CLAUDE.md but not set up). The
  `.wasm` files are content-hashed (immutable); `/avatar/*` is revalidated (`no-cache`) because
  the designer's file keeps a fixed name.

## Consequences
- One dependency (no crypto, no network of its own once the WASM URL is set); ~230 kB JS and
  ~2 MB WASM, loaded only when the character file exists.
- The ring, not the face, carries all live feedback; the face stays app-state only.
- Open: deliver the Rive character; decide on a service worker for offline caching.
