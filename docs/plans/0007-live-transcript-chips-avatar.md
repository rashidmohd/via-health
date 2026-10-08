# Plan 0007 — Live transcript (browser + server), capture chips, avatar

Status: parts 1–4 implemented (2026-10-08). Open: term chips (need the Settings page),
nod-on-capture setting, English in-browser model.

Part 2 notes: engine = official sherpa-onnx v1.13.7 browser build (no eval, no threads → works
with the existing CSP, no COOP/COEP); its data package is rebuilt with the Kroko German model by
`apps/web/scripts/build-live-stt.mjs` (checksum-pinned). Measured: real-time factor 0.08 (WASM, one
thread); real Chrome run with a fake microphone: model ready in ~2.5 s, live words while speaking,
audio during model load is kept (max 60 s).

Product boundaries (CLAUDE.md 11–13) apply to everything here: no clinical suggestions, no
emotion/mood detection from voice or text, no risk detection. "Actions" = documentation chips only.

## Part 1 — Server text during the session (small)
- `GET /sessions/{id}/live` → words from the transcript windows so far (stitched, speaker labels).
- Record screen: panel **"Transcript" (collapsed by default)**, refreshed every 20 s.
  Text arrives ~1–1.5 min behind speech (one window). Needs internet.

## Part 2 — Live preview in the browser
- sherpa-onnx (WASM) streaming model, German: `sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06`
  (~71 MB, downloaded once after login, cached). English clients: an English streaming zipformer
  (license checked the same way) — German first.
- `AudioWorklet` taps the same microphone stream → 16 kHz mono → Web Worker → partial/final text.
  Separate from the recorder: if the worker is slow or crashes, recording continues untouched.
  Single-threaded WASM (no special COOP/COEP headers) unless measurement says otherwise.
- **Nothing from the live preview leaves the device.** It is a working view, never the record.
- **Merged view:** browser text appears immediately; once a server window covers a stretch of
  time, the better server text (with speaker labels) replaces it.
- Off switch per device (Settings) and automatic off if the laptop can't keep up (real-time factor
  > 0.8).
- **License:** Kroko community models are CC-BY-SA; Kroko recommends its commercial models for
  production. → Prototype: OK with attribution (shown in Settings → About). Before real clients:
  commercial license or written OK from Kroko (stays an open decision in CLAUDE.md).

## Part 3 — Capture chips (documentation only)
Fixed, tested keyword/regex detectors in German and English on the live text:
| Detector | Example | Chip |
|---|---|---|
| action item | "bis nächste Woche aufschreiben", "try writing it down" | Homework / task |
| date | "Donnerstag gleiche Zeit", "on the 14th" | Appointment |
| term | matches the practice's term list | Term |
| bookmark | therapist taps the bookmark button | Bookmark (time) |
Chips are suggestions: after the session the therapist confirms or removes each; confirmed chips
are stored (encrypted) and later given to the report as hints. No sentiment, mood or risk detectors.

## Part 4 — Avatar with app-state moods
States from the avatar skill, driven only by app events: `welcome`, `attentive`, `thinking`
(transcript/report processing), `encouraging` (first client added), `pleased` (all uploaded,
report signed), `concern` (offline, error, consent missing), `still` (recording).
Optional ≤ 1 s nod when a chip is noted (off by default during recording).
- Shown on Today (centre), small on the session page. `prefers-reduced-motion` respected.
- **Assets:** the skill plans a realistic face as image frames (rights needed). For the prototype:
  an illustrated SVG avatar with CSS animations for each state; image frames can replace it later
  without changing the state logic.

## New dependency
`sherpa-onnx` WebAssembly build (Apache-2.0 code) + model files served from our own origin
(no third-party CDN at runtime). Not a crypto dependency.

## Order and size
1 (small) → 3 detectors + 4 avatar (medium) → 2 browser model (largest: WASM build, worker,
performance tests on a low-end laptop).

## Tests
Live endpoint RLS and consent; merged view replaces preview text by server text; recording keeps
running when the STT worker is killed; detector fixtures de/en incl. negatives ("ich schreibe nie
etwas auf" ≠ task); avatar never takes input from transcript text (state machine unit tests);
reduced motion; de/en strings.
