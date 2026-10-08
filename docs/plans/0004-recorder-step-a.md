# Plan 0004 — Session recorder, step A (record offline-first, encrypted, upload)

Status: implemented (2026-10-08)

## Goal
Record a session for a client with valid consent. Audio is encrypted in the browser, saved on
the device first, and uploaded when possible. Network loss, tab crash or sleep never lose audio.
No transcription yet (step B / transcription-pipeline).

## User flow
1. **Start session** (Today page, Sessions page, or a client's page).
2. **Choose client:** active clients with search. Clients ready to record can be chosen; others are
   shown with "Consent missing" and a link to record consent. Consent is given once and stays valid
   until withdrawn or until a new consent text version needs re-consent.
3. **Session screen:** client name → **Record** → timer + "Aufnahme läuft" → **Stop** (confirm) →
   "Saved, uploading…" with sync status.

## Browser
- **Start:** only for clients that are ready to record (consent cached on the device so the check
  also works offline). Session id = UUIDv7 made in the browser, so a session can start offline.
- **Capture:** `getUserMedia` mono → `MediaRecorder`, Opus 32 kbps, 10 s slices
  (`audio/webm;codecs=opus`; `audio/mp4` fallback for older Safari — mime type stored per session).
- **Encrypt:** per-session AES-256-GCM key (WebCrypto, no library). Each chunk: fresh 12-byte IV,
  AAD = `session_id|seq`. Written to IndexedDB **before** anything else.
- **Local store:** Dexie (IndexedDB wrapper — new dependency, does no crypto).
  Tables `sessions`, `chunks`, `clientConsent` (cached readiness).
- **Upload queue:** sends chunks in `seq` order; deletes a local chunk only after the server
  confirms it. Backoff 1 s → 60 s with jitter; resumes on `online` and when the tab becomes visible.
- **Stop:** confirmation, final chunk, then "finish" with chunk count and duration.
- **Safety:** screen wake lock while recording; loud alert if the microphone disconnects;
  warning before closing the tab with unsent audio; storage check before start (block if
  < 500 MB free), `navigator.storage.persist()`; stop cleanly and alert on a full disk.
- **Crash recovery:** on load, sessions left in `recording` are offered as "Recover session":
  stored chunks are uploaded and the session is finished.
- **UI (de/en):** session screen with large record button, timer, "Aufnahme läuft / Recording"
  with red dot (never colour alone), sync badge (synced · uploading · offline – saving locally ·
  error). Sessions list on the client page and on the Sessions page.

## Session key handling (interim, like ADR 0004)
Therapist keys and Google KMS are not set up yet.
- The browser sends the raw session key once over TLS: `POST /sessions/{id}/key`.
- The API wraps it with a **processing key** behind the existing `KmsProvider` interface and
  stores only `wrapped_keys(kind='processing')`. Interim provider `LocalKmsProvider`:
  AES-256-GCM with a key derived from `CLIENT_DATA_KEY` via HKDF (no new secret needed).
  Step B swaps in Google Cloud KMS without changing callers.
- Until the server has the key, the browser keeps it in IndexedDB so a crashed tab can still
  finish the session; after the server confirms, the stored copy becomes non-extractable.
- Limitation (documented, as in the skill): data on a compromised device is not protected.

## Storage of encrypted chunks (interim)
Google Cloud Storage is not set up yet. Chunks are uploaded **to the API**
(`PUT /sessions/{id}/chunks/{seq}`, ciphertext only, max 1 MB) and stored through the
`ObjectStore` interface by an interim `PostgresObjectStore` (table `object_blobs`, key
`sessions/{id}/{seq}`). Step B adds `GcsObjectStore` and direct upload.
Only ciphertext is ever stored; the server never decrypts in this step.

## API (login required, RLS applies)
| Method | Path | |
|---|---|---|
| POST | `/sessions` | `{id, client_id, started_at, mime_type}`; DB checks consent; repeat with same id = no-op |
| POST | `/sessions/{id}/key` | wrap + store processing key; once per session |
| PUT | `/sessions/{id}/chunks/{seq}` | ciphertext body, `X-Content-SHA256`; DB checks consent + duplicates |
| POST | `/sessions/{id}/finish` | `{total_chunks, duration_ms, ended_at}`; status → `uploaded` once all chunks are in |
| GET | `/sessions?client_id=` | list with status and chunk progress |

Errors as codes (`consent_missing`, `chunk_conflict`, `audio_not_accepted`, `chunk_too_large`, …), translated de/en.

## Database (additive migration)
- `sessions.mime_type` (text, nullable).
- `object_blobs(key text pk, session_id fk, data bytea, created_at)` — interim; RLS via the
  session; deleted with the session's audio.

Uploaded chunk format: `0x01 | 12-byte IV | AES-GCM ciphertext+tag`.

## Tests
Backend: start with/without/withdrawn consent; repeat start idempotent; other therapist's client;
key stored only wrapped and unwraps to the same key; chunk duplicate = no-op, different content =
conflict, too large, after withdrawal → refused; finish before/after all chunks; RLS on blobs.
Web: encrypt/decrypt round trip, wrong AAD fails; chunk written locally before upload; queue
retries with backoff and deletes only after ack; offline → badge; crash recovery; record button
disabled without consent; de/en.

## Not in this step
Live transcript preview, transcription, reports, Google Cloud (step B), audio deletion jobs
(`shred_session`, `retention_sweep` — with the worker step).
