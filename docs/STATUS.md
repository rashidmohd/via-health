# Project status

Last updated: 2026-10-09 · Latest commit: `8f82a99` · Staging: https://via.bandi.ae (API: viaapi.bandi.ae)

**Prototype. Test data only.** Consent texts are placeholders (ADR 0002); the in-browser speech
models and the Gemini API are cleared for the prototype only (see "Before real clients").

## Built

| Area | What works | Plan / ADR |
|---|---|---|
| Login | Sign up / sign in with a 6-digit email code (Resend EU); de/en UI | plan 0002, ADR 0003 |
| Data protection | Postgres row-level security per therapist; consent enforced in the DB; audit log (IDs only) | plan 0001 |
| Clients & consent | Client list, add/edit/archive; per-kind consent with on-screen signature, withdrawal, version history; details encrypted | plan 0003, ADR 0004 |
| Recorder | Choose client → record; audio encrypted in the browser, saved on the device first, uploaded with retry; offline, crash recovery, mic-loss alert, bookmarks | plan 0004 |
| Storage & keys | Encrypted audio in GCS `europe-west4`; session keys wrapped with Cloud KMS | plan 0005, ADR 0001 |
| Transcription | Chirp 3 (location `eu`) in ~1-minute windows **during** the session → transcript seconds after Stop; batch fallback | plans 0005, 0006 |
| Speaker accuracy | Whole-session speaker check after Stop; therapist can switch a line, swap from a line on, undo | plan 0008 |
| Live transcript | In-browser preview (sherpa-onnx + Kroko, German and English), replaced by server text with speakers | plan 0007 |
| Capture chips | Task / appointment chips (fixed de/en rules) and bookmarks; keep/remove after the session | plan 0007 |
| Avatar | Rive character with placeholder image until the designer's file arrives; moods from app events only (no emotion recognition); paused while recording; ring shows voice activity (binary) and processing; Settings: illustrated or initials, opt-in glance on new chips | plans 0007, 0011, ADR 0010 |
| Mic health | Voice activity in its own worklet during every recording; level meter + voice indicator; warning after 2 min without speech; 5 s mic test before the first recording; mic choice for the next recording | plan 0011, ADR 0010 |
| Session note | German Verlaufsdokumentation; Gemini drafts only "what was said and done" with sources, a second pass checks each sentence; therapist writes the clinical fields, resolves flags, approves; addenda after approval; names hidden from the AI; note topics on the session card (not on Today) | plan 0009, ADRs 0006–0008 |
| Notifications | Tab with unread badge: transcript ready / failed, note draft ready / failed / no AI consent; ids only in the DB | plan 0010 (part 1) |
| UI design system | Inter + Lucide icons, tokens and shared components, sidebar + top bar shell (drawer on small screens); all built screens redesigned (Today tiles, client and session tables with filters, record screen, note editor with "Next to check", print view) | ADR 0009 |

Tests: backend 205, web 156 (lint, typecheck, build green).

## Not built yet (in order)

1. **Real model check for session notes** — needs a paid-tier Gemini API key (ADR 0005);
   then a German golden set of role-play sessions (plan 0009, tests).
2. **Therapist keys & signing** — OpenPGP keys in the browser, recovery key, signed report and transcript
   encrypted so the server cannot read it (CLAUDE.md rule 7).
3. **Deletion jobs** — crypto-shred audio on signing, `retention_sweep` for unsigned sessions,
   clean-up of leftover transcript windows. Until then the bucket's 30-day rule is the safety net.
4. **Settings page, rest** — practice term list (term chips), live-preview switch; profile photo (plan 0012, needs approval). Avatar and microphone settings are built.
5. **Rive character** — designer delivers `sessio-avatar.riv` (contract in the `avatar-and-ui` skill); no code change needed.
6. **Later:** passkeys, other report templates, client documents and data export.

## Before real clients (blocking)

- Lawyer-reviewed consent texts (replace version 0), DPIA, DPAs (Google, Railway, Resend), §203 contracts.
- Kroko speech models: commercial license or written OK (community models are CC-BY-SA).
- Production on **Vertex AI EU** instead of the Gemini API; Vertex abuse-monitoring exception.
- Replace the interim server key (ADR 0004) with therapist keys (item 2 above).
- Separate `prod` Google project and Railway environment.

## Known issues / to watch

- Session notes run on the fake model until `LLM_PROVIDER`/`LLM_API_KEY` are set on staging.
- Speaker labels on real two-person recordings: the whole-session check is new — verify on staging.
- Live preview downloads ~71 MB per language on first use per device.
- Speech-to-Text cost is ~2× audio minutes per session (windows + speaker check).
