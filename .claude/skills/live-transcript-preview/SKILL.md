---
name: live-transcript-preview
description: Use when working on the in-browser live transcript (sherpa-onnx WASM, Kroko German streaming model), hotwords/contextual biasing, capture chips (action items, dates, terms), voice activity detection, or which events may trigger an avatar reaction.
---

# Live transcript preview (browser)

The live transcript is a **working view, never the record**. Only the server Chirp 3 transcript feeds reports.
It runs entirely in the browser and works offline. No live text leaves the device.

## Model

- sherpa-onnx WASM, streaming transducer: `sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06` (German).
- Only transducer models support hotwords in sherpa-onnx — do not swap in Whisper/Paraformer/SenseVoice if hotwords are needed.
- Model files are preloaded after login into Cache Storage (`src/live-stt/modelCache.ts`, ADR 0014; per-device opt-out in Settings); the worker reads them from there and falls back to the network. Versioned paths, cached immutably (no service worker yet, ADR 0010). Verify the Kroko license before production (open decision in CLAUDE.md).
- Never use the Web Speech API — Chrome typically sends audio to Google servers.

## Architecture

```
AudioWorklet (16 kHz mono Float32) ──postMessage──▶ live-stt.worker.ts
   └─ sherpa OnlineRecognizer (modified_beam_search when hotwords set)
   └─ emits { partial, final, tStart, tEnd }
        ──▶ captureDetectors(final) ──▶ captures store (chips)
        ──▶ avatar event bus (whitelisted events only)
```

Keep the worker independent of the recorder: if the STT worker crashes or is too slow, recording continues untouched.

Latency: the current Kroko export decodes 1.28 s chunks (`decode_chunk_len` 128) — that is most of the delay. The record page warms the engine before Start (`prewarmLivePreview`); keep worklet blocks small (~21 ms). See ADR 0014.

## Hotwords

- Per session list = practice clinical vocabulary + client-specific terms + names.
- Hotwords require `decoding_method = modified_beam_search` (heavier CPU). Measure latency on a low-end laptop; if RTF > 0.8, reduce `max_active_paths` or drop hotwords for that device.
- Hotwords live only in the browser and on the server encrypted; never log them.
- The same list is passed to the server as speech-adaptation phrases for Chirp 3.

## Capture detectors (event detection, NOT emotion detection)

A fixed, named, unit-tested whitelist. Each detector is pure: `(text, context) => Capture[]`.

| Detector | Example | Capture kind |
|---|---|---|
| `actionItem` | "bis nächste Woche aufschreiben", "try writing it down" | `action_item` |
| `dateOrAppointment` | "Donnerstag gleiche Zeit", "on the 14th" | `date` |
| `clinicalTerm` | matches hotword/term list | `term` |
| `bookmark` | therapist taps bookmark button (UI event, not text) | `bookmark` |

Rules:
- Start with keyword/regex rules (German + English). A small text classifier may come later, still behind the same whitelist interface.
- **Forbidden**: sentiment, emotion labels, mood, risk/self-harm detection, any free-form "interesting moment" model.
- Captures are suggestions: the therapist confirms or removes each chip after the session; confirmed captures are sent to the server as hints for the report.

## Voice activity detection (VAD)

Detects **that** someone is speaking — never who, what, or how they feel (plan 0011, ADR 0010).

- Runs in its **own AudioWorklet** (`public/mic-level.js`), started by the recorder with every
  recording — not in this worker, because the preview only runs when the live panel is open and
  stops itself on slow devices. So VAD keeps running when the recognizer is off, slow or crashed.
- The worklet posts one RMS number per ~50 ms (never samples). `VoiceDetector`
  (`src/recorder/vad.ts`): on > 0.02, off < 0.012, 600 ms hold (no flicker between words),
  thresholds calibrated on the first 2 s (stays off meanwhile), capped so speech stays detectable.
- Output: binary `voiceActive` (`useVoiceState`) → listening ring + mic health. Nothing else.
- Later: Silero VAD via sherpa-onnx behind the same `VoiceDetector` interface (resample first:
  frames arrive at the AudioContext rate, usually 48 kHz, not 16 kHz).
- Never log VAD timings, and never together with any content.

## Avatar reactions

Allowed avatar events: `capture.noted` (brief glance/nod, ≤1 s; `LivePanel` emits it, payload-free,
when a chip from a finished line appears) and the binary voice signal (ring only, never the face).
Nothing else. The avatar must never mirror the client's apparent emotion. Avatar reactions during
recording are **off by default** and only enabled by the therapist for their own screen
(Settings → "Avatar during recordings"); default during recording = chips only, avatar paused.

## Tests

- Detector fixtures in German and English, including negatives ("ich schreibe nie etwas auf" ≠ action item).
- Worker survives malformed audio frames.
- Recording continues when the worker is terminated mid-session.
