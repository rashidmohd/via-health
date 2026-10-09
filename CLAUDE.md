# CLAUDE.md — Sessio (working name)

Web app that records counselling / psychotherapy sessions, produces a transcript,
and drafts a structured session report that the therapist reviews and signs.
Built for the EU (Germany first): GDPR, §203 StGB professional secrecy, 10-year
record retention (§630f BGB).

This file is the source of truth for how to work in this repo. Detailed
how-to for each area lives in `.claude/skills/` — load the matching skill
before touching that area.

---

## 1. Terminology (use these words in code, DB and UI)

| Term | Meaning | Code name |
|---|---|---|
| **User** | The therapist. Logs in, records, reviews, signs, holds PGP keys | `user` / `users` |
| **Client** | The person in therapy. Does NOT log in (prototype) | `client` / `clients` |
| **Session** | One recorded therapy appointment | `session` / `sessions` |
| **Consent** | A versioned, signed client consent record | `consent` / `consents` |
| **Report** | Draft or signed document generated from a session | `report` / `reports` |
| **Capture** | An event detected in the live transcript (action item, date, term), shown as a chip | `capture` / `captures` |

Never use "patient" or "customer" in code. Never mix up `user` and `client` —
that confusion causes access-control bugs.

Prototype scope: **single therapist (one user)**, no client accounts.
Design so multi-therapist practices and client accounts can be added later
without restructuring.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript (Vite), PWA (Workbox — not set up yet, ADR 0010), TanStack Query, Dexie (IndexedDB), openpgp.js, sherpa-onnx WASM, Rive (`@rive-app/react-canvas`, WASM self-hosted) |
| Backend API | FastAPI (Python 3.12), Pydantic v2, SQLAlchemy 2 + Alembic |
| Workers | Python, Arq (Redis queue), ffmpeg |
| Database | PostgreSQL (Railway plugin) — NOT MongoDB |
| Queue | Redis (Railway plugin) |
| Object storage | Behind `ObjectStore` adapter. GCS `europe-west4` (ADR 0001) |
| STT (final) | Google Speech-to-Text V2, model `chirp_3`, location `eu` (not available in `europe-west4`, verified 2026-10-08), behind `SttProvider` adapter |
| STT (live preview) | sherpa-onnx WASM in the browser, streaming transducers (Kroko German + English) |
| LLM (reports) | Gemini behind `LlmProvider`: Vertex AI `europe-west4` in prod; Gemini API allowed in dev with test data only (ADR 0005) |
| Keys | Google Cloud KMS `europe-west4` + OpenPGP (therapist keys) |
| Hosting | Railway, all services pinned to the EU region |
| Auth | Email one-time code (Resend, EU region, ADR 0003); passkeys later |

We do **not** self-host any ML model and do not run GPUs.

---

## 3. Repo layout

```
apps/web/                 React PWA
  src/recorder/           capture, chunking, IndexedDB buffer, upload queue, voice activity + mic health
  src/live-stt/           sherpa-onnx worker, hotwords, capture detectors
  src/crypto/             WebCrypto session keys, openpgp.js wrappers
  src/avatar/             Rive character (placeholder until delivered), listening ring, app-state moods
  src/features/           today, clients, sessions, reports, keys, settings
  src/design/             tokens (olive palette), components
backend/
  app/api/                FastAPI routers
  app/core/               config, security, auth
  app/db/                 models, RLS helpers, migrations (alembic/)
  app/adapters/           stt/, llm/, storage/, kms/
  app/workers/            arq jobs: transcribe_window, finalize_session, draft_report, shred_session, retention_sweep
  app/domain/             consent rules, report templates, retention
  tests/
infra/railway/            service configs
docs/                     data flow, DPIA notes, ADRs (docs/adr/)
.claude/skills/           how-to per area (see section 9)
```

## 4. Commands

```
# web
cd apps/web && pnpm install && pnpm dev
pnpm live-stt            # once: downloads the live preview models (de + en, ~155 MB) into public/live-stt
pnpm test                 # vitest
pnpm lint && pnpm typecheck

# backend
cd backend && uv sync
uv run uvicorn app.main:app --reload
uv run arq app.workers.settings.WorkerSettings
uv run pytest
uv run alembic upgrade head
uv run ruff check . && uv run mypy app
```

Run lint, typecheck and tests before declaring any task done.

---

## 5. Non-negotiable rules

These hold for every change. If a request conflicts with one, stop and ask.

### Data protection
1. **No plaintext audio leaves the browser.** Every chunk is AES-256-GCM encrypted with the session key before it is written to IndexedDB or uploaded.
2. **Workers decrypt in memory only.** Never write plaintext audio or transcripts to disk, temp files, or logs. (If ffmpeg needs input, pipe via stdin/stdout.)
3. **No PHI in logs, errors, analytics or error tracking.** Log IDs only (`session_id`, `client_id`). Never names, transcript text, report text, or hotwords.
4. **EU only.** Every cloud resource (Railway, GCS/R2, Speech-to-Text, Vertex, KMS) in an EU region. Never add a non-EU endpoint.
5. **Google settings:** Speech-to-Text data logging OFF; Vertex caching disabled; no web grounding. Never enable the data-logging discount.
6. **Audio is temporary.** Deleted and crypto-shredded when the report is signed; hard max retention (default 30 days) enforced by bucket lifecycle rule + `retention_sweep` job.
7. **Signed records are OpenPGP-encrypted** to the therapist key AND the recovery key, and signed by the therapist key. The server cannot read signed records.

### Consent
8. **No recording without valid consent.** Enforced in the DB (constraint/trigger), in the API, and in the browser (cached status, works offline).
9. Consents are granular (`recording`, `ai_processing`, optional `product_improvement`), versioned, and never bundled.
10. Withdrawn consent blocks recording immediately and deletes unprocessed audio.

### Product boundaries (regulatory — do not cross)
11. **Documentation tool only.** No diagnoses, no risk scores, no treatment recommendations, no clinical suggestions during a session. (Keeps us outside MDR / AI Act high-risk.)
12. **No emotion recognition.** Never infer emotions from voice or text of the client or therapist. The avatar reacts only to app state and a fixed whitelist of text events (see `live-transcript-preview` skill). **Voice activity is shown only by the ring around the avatar, binary** (speaking / not) — never scaled by loudness, never per speaker, never on the face.
13. **No risk/self-harm detection** features without explicit sign-off — this is a regulated feature.
14. **The therapist always reviews.** Nothing AI-generated is final or sent to a client without the therapist's approval.

### Engineering
15. Every external service sits behind an adapter interface (`SttProvider`, `LlmProvider`, `ObjectStore`, `KmsProvider`). No vendor SDK imports outside `app/adapters/`.
16. Access control is enforced by Postgres row-level security, not just app code.
17. Multi-step security operations (sign + shred + delete) run in one DB transaction plus an idempotent cleanup job.
18. Migrations are additive and reversible. Never drop columns holding records.

---

## 6. Architecture in one paragraph

The browser captures mic audio once and splits it: (a) Opus chunks every 10 s,
encrypted with a per-session AES key, stored in IndexedDB, uploaded via
presigned URLs with retry; (b) 16 kHz PCM to sherpa-onnx in a Web Worker for a
local live preview transcript and capture chips. The session key is wrapped with
the therapist's PGP public key and with a KMS processing key. Workers transcribe
~1-minute overlapping windows during the session (Chirp 3 `Recognize` with
diarization; speakers matched across windows via the overlap), so the transcript
is ready seconds after Stop; `BatchRecognize` is only the fallback (plan 0006).
Gemini drafts the report from the chosen template. The therapist
edits and signs in the browser; the signed report is PGP-encrypted, the audio
deleted, and the KMS-wrapped session key destroyed (crypto-shred).

Failure model: the network may drop at any time, the tab may crash, the laptop
may sleep. Recording must never depend on connectivity.

---

## 7. Design system

Light olive primary, calm and spacious (reference: clean white dashboard,
sidebar left, one focal element centred — the avatar replaces the reference's
speaker object on the Today screen).

| Token | Hex | Use |
|---|---|---|
| olive-50 | #F6F7F0 | sidebar, subtle backgrounds |
| olive-100 | #E8ECD9 | selected nav, cards |
| olive-300 | #C5CDA2 | borders, rings |
| olive-500 | #8A9A5B | brand, avatar ring, chart lines |
| olive-700 | #5C6B37 | primary buttons, coloured text (AA on white) |
| clay | #C47A5A | sparing accent: badges, attention counts |
| sand | #EFE6D2 | secondary surfaces, empty states |
| charcoal | #2B2A26 | body text |
| bg | #FAFAF6 | page background |
| border | #E6E6DE | hairlines |
| danger / recording | #C2412D | recording indicator, errors |
| warning | #C9963A | offline, saving locally |
| info | #5B7A8C | info |

Never use olive for "success" states. Text on light olive must use olive-700 or darker.
Copy: sentence case, plain language, no exclamation marks in system copy.

Navigation: Today · Notifications · Clients · Sessions · Reports (group "Workspace") · Keys · Settings (group "Account").
Type: Inter (self-hosted); icons: lucide-react. Full token set and components: `avatar-and-ui` skill (ADR 0009).

---

## 8. Open decisions (do not decide silently — ask)

- Kroko German/English model license for commercial use — community model is CC-BY-SA; Kroko recommends its commercial models for production. Prototype OK with attribution; get a commercial license or written OK before real clients.
- Chirp 3 speech adaptation (phrase sets) in location `eu` — verify. (Availability verified: `eu` yes, `europe-west4` no.)
- Vertex abuse-monitoring exception — must be requested for zero retention.
- Final product name ("Sessio" is a placeholder).
- Rive character not yet delivered — placeholder image in use (`public/avatar/placeholder.png`; drop the file in as `public/avatar/sessio-avatar.riv`, contract in the `avatar-and-ui` skill).
- Profile photo (plan 0012) — touches the schema; waiting for approval.
- Legal: DPIA, DPAs, §203 contracts, final consent texts — parked, lawyer review pending.

Decided (see `docs/adr/`): GCS `europe-west4` for storage (0001); placeholder consent texts v0 for the prototype (0002); email-code login via Resend EU, open signup (0003); interim server key for client data (0004); Gemini API in dev only, Vertex in prod (0005); transcript is part of the record, kept 10 years (0006); LLM sees plain text in memory only, names replaced by placeholders (0007); AI documents what was said, never assesses (0008); UI foundation Inter + Lucide + raised-panel shell (0009); Rive avatar, binary listening ring, voice activity in its own worklet, mic health (0010).

## 9. Skills index

Load the matching skill before working on an area:

| Skill | When |
|---|---|
| `offline-recorder` | Mic capture, chunking, IndexedDB, upload queue, offline/crash recovery, storage quota, mic health |
| `live-transcript-preview` | sherpa-onnx WASM, hotwords, capture chips, voice activity, avatar event triggers |
| `encryption-and-keys` | Session keys, PGP, KMS wrapping, signing, crypto-shredding, recovery key |
| `data-model-and-consent` | Postgres schema, RLS, consent enforcement, client profile, retention, audit |
| `transcription-pipeline` | Workers, Chirp 3 adapter, windows, batch diarization, manifest |
| `report-generation` | Templates, Gemini adapter, review/sign flow, client documents |
| `avatar-and-ui` | Olive design system, Rive avatar, listening ring, emotion states, profile picture |
| `railway-deploy` | Railway services, env vars, Google project setup, EU pinning |

## 10. Working agreement

- Plan first for anything touching crypto, consent, the DB schema or deletion. Write the plan, then implement.
- Ask before: adding a dependency that handles crypto, changing the schema of signed records, changing retention, adding any external service.
- Small PR-sized changes, each with tests. Crypto and consent code needs tests for the failure path (wrong key, expired/withdrawn consent, partial upload, duplicate chunk).
- Record significant decisions as short ADRs in `docs/adr/NNNN-title.md`.
