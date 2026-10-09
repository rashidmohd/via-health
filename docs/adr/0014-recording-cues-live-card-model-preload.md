# 0014 — Recording sounds, live transcript in the recording card, model preloaded on app open

Status: accepted for the prototype (2026-10-09). Changes plan 0007 part 1/2 ("collapsed by
default", "model loaded when the panel opens").

## Context
Therapists asked for audible confirmation when a recording starts and stops, for the live
transcript to be visible in the recording card without opening anything, and for the live
model to be ready when a session begins (the first load is ~155 MB and took the first minute
of a session).

## Decision
- **Sounds:** a short rising two-tone cue on start and a falling one on stop, synthesized with
  Web Audio (no audio files). The start cue plays once the recorder is running (it confirms the
  microphone is live, so it is in the first second of the audio); the stop cue plays after the
  recorder stopped, so it is not in the recording. Per-device setting, on by default.
- **Live transcript in the card:** the panel is part of the red recording card and starts with
  the recording (no longer collapsed). It follows the newest words unless the therapist scrolled
  up. The off switch stays in the card and in Settings.
- **Preload:** after login the app downloads the engine (`.wasm`) and the German and English
  models (`.data`) into **Cache Storage** (`sessio-live-stt-<version>`; old versions deleted),
  the UI language first, with a progress banner at the top that can be hidden. The worker hands
  the cached files to the engine (`wasmBinary`, `getPreloadedPackage`) and falls back to the
  network. Cache Storage instead of the HTTP cache because Firefox does not keep single responses
  above 50 MB there. Skipped when offline, when the live preview is off, or when less than
  500 MB of storage would remain for recordings. Per-device setting, on by default.

## Consequences
- ~155 MB per device, once per model version. Shares the origin quota with recordings — hence
  the headroom check; recording never depends on the model.
- The live text is more visible during the session. Still a working view: it never leaves the
  device and is never the record (live-transcript-preview skill). No new data leaves the browser.
- Checked in Chrome: the worker reaches `ready` in ~1.9 s with the model only in Cache Storage.
