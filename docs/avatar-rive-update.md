# Change request: Rive avatar, listening ring, voice detection, mic health

This document describes changes to an app that is already partly built.
**Integrate into the existing code — do not rewrite or restructure what exists.**

## Instructions for Claude Code

1. Read this whole file first, then inspect the current code in `apps/web/src/avatar/`, the session/recording screen, the live-STT worker and `CLAUDE.md`.
2. Write a short plan: what already exists, what changes, what is new, and what (if anything) gets removed. Wait for approval before large changes.
3. Implement in the order of section 9. Keep each step small with tests.
4. Afterwards update `CLAUDE.md` and the skills `avatar-and-ui`, `live-transcript-preview` and `offline-recorder` so they match this document (section 10).

If something here conflicts with existing code or decisions, stop and ask instead of guessing.

---

## 1. Summary of the decision

- The main avatar is **one illustrated, rigged Rive character** (designer-made). It replaces any image-grid or SVG avatar approach.
- The character reacts **only to app state** (login, processing, signed, offline …). It never reacts to what is said or how anyone sounds.
- Voice activity is shown by an **animated CSS ring around the avatar**, not by the face.
- During recording the Rive character is **paused**; only the ring animates (cheap, GPU-composited).
- A **mic-health check** uses the same voice detection to warn about silent audio loss.
- Until the real `.riv` file exists, use a **static placeholder image** behind the same component props.

## 2. Dependencies

- Add `@rive-app/react-canvas`.
- Rive file location: `apps/web/public/avatar/sessio-avatar.riv` (placeholder: `apps/web/public/avatar/placeholder.png`).
- Cache the `.riv` with the existing Workbox setup (cache-first), load lazily after login.

## 3. Rive state machine contract

Artboard `Avatar`, state machine `Avatar`. The designer delivers exactly these inputs — keep names identical in code.

| Input | Type | Values / effect |
|---|---|---|
| `lookX` | Number | −100…100, pointer x (head + eyes follow) |
| `lookY` | Number | −100…100, pointer y |
| `emotion` | Number | 0 attentive · 1 welcome · 2 thinking · 3 encouraging · 4 pleased · 5 concern · 6 still |
| `recording` | Boolean | true → no tracking, calm still pose |
| `noted` | Trigger | 1 s glance/nod for a confirmed capture chip (only if the therapist enabled reactions) |

Phase 2 (avatar builder, not now): Number inputs `hair`, `hairColor`, `skin`, `glasses`, `beard`, `top`.

### App event → emotion

| App event | Emotion |
|---|---|
| login / Today idle | `welcome` → `attentive` after 3 s |
| report processing | `thinking` |
| onboarding step done, first client added | `encouraging` |
| report signed, all synced | `pleased` → `attentive` after 3 s |
| offline, error, consent missing | `concern` |
| recording active | `still` + `recording = true` |
| capture confirmed (opt-in setting) | fire `noted` |

Emotions are set from one app-level store (e.g. `useAvatarStore`) subscribed to app events. Components never set emotions ad hoc.

## 4. Avatar component

```tsx
import { useRive, useStateMachineInput } from '@rive-app/react-canvas';

const EMOTION = { attentive: 0, welcome: 1, thinking: 2, encouraging: 3, pleased: 4, concern: 5, still: 6 } as const;
export type Emotion = keyof typeof EMOTION;

export function RiveAvatar({ emotion, recording, size = 160 }: { emotion: Emotion; recording: boolean; size?: number }) {
  const { rive, RiveComponent } = useRive({ src: '/avatar/sessio-avatar.riv', stateMachines: 'Avatar', autoplay: true });
  const lookX = useStateMachineInput(rive, 'Avatar', 'lookX');
  const lookY = useStateMachineInput(rive, 'Avatar', 'lookY');
  const emo = useStateMachineInput(rive, 'Avatar', 'emotion');
  const rec = useStateMachineInput(rive, 'Avatar', 'recording');

  useEffect(() => { if (emo) emo.value = EMOTION[emotion]; }, [emo, emotion]);

  useEffect(() => {
    if (rec) rec.value = recording;
    // let the character settle into `still`, then stop rendering to free CPU for audio, crypto and WASM STT
    const t = setTimeout(() => (recording ? rive?.pause() : rive?.play()), recording ? 600 : 0);
    return () => clearTimeout(t);
  }, [rec, recording, rive]);

  useEffect(() => {
    if (recording || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (lookX) lookX.value = (e.clientX / innerWidth) * 200 - 100;
        if (lookY) lookY.value = (e.clientY / innerHeight) * 200 - 100;
      });
    };
    addEventListener('pointermove', onMove);
    return () => { removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, [lookX, lookY, recording]);

  return <RiveComponent aria-hidden style={{ width: size, height: size }} />;
}
```

Requirements:
- If the `.riv` is missing or fails to load, render `placeholder.png` (round, same size) — the rest of the app must not care which one is shown.
- `prefers-reduced-motion`: no pointer tracking; emotions still switch.
- `aria-hidden`; every state is also shown as text somewhere on screen.

## 5. Listening ring

Wraps any avatar type (Rive, photo, initials). Pure CSS, only `transform`/`opacity` animate.

| Ring state | When | Look |
|---|---|---|
| `idle` | not recording | 2px olive-300 border |
| `silent` | recording, no voice | 3px olive-500 border |
| `listening` | recording, voice detected | two staggered ripples, 2.4 s |
| `processing` | report being drafted | rotating olive arc, 2.8 s |

Small badges on the ring: check (signed / synced), cloud-off (offline). Status text always next to it. The red recording dot + "Aufnahme läuft" stays separate from the ring.

```tsx
export type RingState = 'idle' | 'silent' | 'listening' | 'processing';
export function AvatarRing({ state, children }: { state: RingState; children: React.ReactNode }) {
  return <div className={`avatar-ring is-${state}`}>{children}</div>;
}
```

```css
.avatar-ring{position:relative;border-radius:50%;box-shadow:0 0 0 2px var(--olive-300);transition:box-shadow .4s}
.avatar-ring.is-silent,.avatar-ring.is-listening{box-shadow:0 0 0 3px var(--olive-500)}
.avatar-ring::before,.avatar-ring::after{content:'';position:absolute;inset:-4px;border-radius:50%;pointer-events:none;opacity:0}
.avatar-ring.is-listening::before,.avatar-ring.is-listening::after{border:2px solid var(--olive-500)}
.avatar-ring.is-processing::before{inset:-6px;border:3px solid transparent;border-top-color:var(--olive-700);border-right-color:var(--olive-500)}
@media (prefers-reduced-motion:no-preference){
  .avatar-ring.is-listening::before{animation:ring-ripple 2.4s ease-out infinite}
  .avatar-ring.is-listening::after{animation:ring-ripple 2.4s ease-out 1.2s infinite}
  .avatar-ring.is-processing::before{opacity:1;animation:ring-spin 2.8s linear infinite}
}
@media (prefers-reduced-motion:reduce){.avatar-ring.is-processing::before{opacity:1}}
@keyframes ring-ripple{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.22);opacity:0}}
@keyframes ring-spin{to{transform:rotate(360deg)}}
```

Usage on the session screen:

```tsx
<AvatarRing state={recording ? (voiceActive ? 'listening' : 'silent') : 'idle'}>
  <RiveAvatar emotion={recording ? 'still' : emotion} recording={recording} />
</AvatarRing>
```

Ring rules:
- Binary voice state only — **never** scale the animation with loudness.
- No difference between therapist and client voices.
- Driven only by the VAD signal (section 6).

## 6. Voice activity detection (VAD)

Detects **that** someone is speaking — never who, what, or how they feel. Runs in the existing live-STT worker on the same 16 kHz PCM frames from the AudioWorklet.

- Preferred: Silero VAD via sherpa-onnx WASM (robust against noise).
- Prototype / fallback: RMS energy with hysteresis, thresholds calibrated in the first seconds of the session.

```ts
const ON = 0.02, OFF = 0.012, HOLD_MS = 600;
let active = false, lastVoice = 0;

export function onFrame(pcm: Float32Array, now: number) {
  let sum = 0;
  for (const v of pcm) sum += v * v;
  const rms = Math.sqrt(sum / pcm.length);

  if (rms > ON) {
    lastVoice = now;
    if (!active) { active = true; postMessage({ type: 'voice', active: true }); }
  } else if (active && rms < OFF && now - lastVoice > HOLD_MS) {
    active = false;
    postMessage({ type: 'voice', active: false });
  }
}
```

Requirements:
- Output is a binary `{ type: 'voice', active }` message with a 600 ms hold (no flicker between words).
- VAD keeps running even if the speech recognizer is disabled or crashes: run it first in the frame handler, wrapped in try/catch.
- Never log VAD timings together with any content.

## 7. Mic health

Uses the VAD signal; always active during recording, independent of the avatar setting.

- Small level meter + voice on/off indicator next to the record button.
- Recording but no voice for 2 minutes → warning "No speech picked up for 2 minutes. Check the microphone." with a device picker.
- Before a user's first recording: a 5-second mic test that must detect voice.

## 8. Profile picture options (Settings)

| Option | Now / later | Notes |
|---|---|---|
| Illustrated avatar (Rive) | now (default) | animated, all emotions |
| My photo | now | static photo in the ring; optional ±4° perspective tilt toward the pointer, off while recording; no face animation |
| Initials | now | olive-100 circle, olive-700 text |
| Build my avatar | later | Rive part variants; store only a config like `{ "hair":3,"hairColor":2,"skin":4,"glasses":1 }`; user picks every trait manually, never auto-detected from a photo |
| Avatar from my photo | later | image model redraws photo in house style; check EU availability + zero retention first |

Photo upload: crop in the browser (circle, zoom/drag), re-encode to 512×512 WebP via canvas (this strips EXIF incl. GPS), store as a normal access-controlled object (user personal data, not health data), removable anytime, deleted with the account.

Photo tilt:

```tsx
useEffect(() => {
  if (!tilt || recording || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let raf = 0;
  const onMove = (e: PointerEvent) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const x = (e.clientX / innerWidth - 0.5) * 8;
      const y = (e.clientY / innerHeight - 0.5) * -8;
      ref.current!.style.transform = `perspective(600px) rotateY(${x}deg) rotateX(${y}deg)`;
    });
  };
  addEventListener('pointermove', onMove);
  return () => { removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
}, [tilt, recording]);
```

Clients never get photo uploads; client-list avatars stay generated (initials or simple illustration from `client_id`).

## 9. Implementation order

1. `AvatarRing` component + CSS, wrapped around whatever avatar exists today.
2. VAD in the live-STT worker → `voiceActive` in app state → ring `silent` / `listening`.
3. Mic-health indicator, 2-minute warning, first-time mic test.
4. `useAvatarStore` (app events → emotion) and `RiveAvatar` with placeholder fallback; replace the current avatar.
5. Ring `processing` state on the report wait screen; badges.
6. Profile picture settings: Rive default, photo (crop, WebP, tilt), initials.
7. Remove the old avatar implementation and its assets once nothing references them.

Tests: VAD (no flicker under hold time, off after silence, stable on constant noise), ring state mapping, Rive fallback when the file is missing, avatar paused while recording, photo re-encode strips EXIF, mic warning fires after 2 minutes of silence.

## 10. Docs to update afterwards

- `CLAUDE.md`: add Rive to the stack; `src/avatar/` description; rule "voice activity shown only by the ring, binary"; open decision "Rive character not yet delivered — placeholder in use".
- Skill `avatar-and-ui`: replace image-grid sections with sections 3–5 and 8.
- Skill `live-transcript-preview`: add section 6; allowed avatar events = `noted` trigger + binary voice signal.
- Skill `offline-recorder`: add section 7; "pause the Rive avatar while recording".

## Non-negotiable rules (unchanged, repeated for clarity)

- No emotion recognition from voice or text. The avatar reacts to app state only.
- No avatar reactions during recording unless the therapist enables `noted` for their own screen.
- No PHI in logs.
- Respect `prefers-reduced-motion` everywhere.
