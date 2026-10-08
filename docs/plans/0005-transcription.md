# Plan 0005 — Transcription (recorder step B)

Status: implemented (2026-10-08). Verified against the real project with a synthetic
German test conversation: KMS, GCS and Chirp 3 (`eu`, diarization) work; batch took ~5 min.

## Goal
After a session is fully uploaded, a background worker produces a transcript with speakers
separated. The therapist sees it on the session page. No report yet (next step).

## Flow
1. Browser finishes upload → session `uploaded` (exists).
2. The worker checks every 15 s for `uploaded` sessions and queues `transcribe_session(session_id)`
   (Arq/Redis, job id per session so it never runs twice at once). No API → Redis dependency.
3. Worker (status `processing`):
   - unwraps the session key with **Cloud KMS** (AAD = session),
   - reads the encrypted chunks from **GCS**, decrypts them **in memory** (AES-GCM, AAD
     `session_id|seq`), concatenates strictly by `seq` (chunk 0 holds the WebM/MP4 header),
   - writes the joined audio to a temporary object `stt-tmp/<session_id>` (needed: Chirp 3 batch
     only reads from GCS), calls **BatchRecognize** with `chirp_3`, location **`eu`**, language from
     the client's preferred language (`de-DE` / `en-US`), speaker diarization (2 speakers),
   - deletes the temporary object immediately (also on failure),
   - stores the transcript **encrypted** (interim server key, ADR 0004) → status `transcribed`.
4. Failure: 3 attempts with backoff, then status `failed` with a reason code; "Retry" button.

## Cloud adapters (behind existing interfaces, vendor SDKs only in `app/adapters/`)
| Interface | New implementation | Setting |
|---|---|---|
| `ObjectStore` | `GcsObjectStore` (bucket `GCS_BUCKET`) | `OBJECT_STORE=gcs` (Postgres store stays for local dev/tests) |
| `KmsProvider` | `GoogleKmsProvider` (`KMS_KEY_NAME`) | `KMS_PROVIDER=gcp` (local key stays for dev/tests) |
| `SttProvider` | `GoogleChirp3Provider` (`STT_LOCATION=eu`) + `FakeSttProvider` for tests | `STT_PROVIDER=google` |

Credentials: `GOOGLE_APPLICATION_CREDENTIALS_JSON` read in memory (Railway) or the key file path
(local). `staging`/`prod` must use `gcs` + `gcp` + `google`; the app refuses to start otherwise.

Chunk upload stays through the API (it now writes to GCS). Direct browser → GCS upload later.

## Database (additive migration)
- `transcripts`: `session_id` (pk), `segments_enc`, `speaker_roles` (which speaker is the
  therapist, set by the therapist), `language`, `stt_model`, `created_at`.
- `sessions.status` may also be `transcribed`; `sessions.failure_reason`.
- Worker DB role `sessio_worker`: sees only sessions, chunks, keys, transcripts it needs
  (RLS policies for this role), never client identity.

## API and UI (de/en)
- `GET /sessions/{id}` (detail + status), `GET /sessions/{id}/transcript`,
  `PATCH /sessions/{id}/transcript` (who is the therapist), `POST /sessions/{id}/retry`.
- Session page `/sessions/:id`: status ("Transcribing…, usually a few minutes"), transcript with
  "Therapist / Client" labels (one click to swap if the speakers are the wrong way round),
  timestamps. Sessions lists link to it.

## Deletion
- Temporary plaintext object deleted right after the call; bucket lifecycle rule on `stt-tmp/`
  (1 day) as a safety net — **one extra rule to add in the console**.
- Encrypted audio stays until the report is signed (next step) or 30 days (existing rule).

## New dependencies (ask: vendor SDKs, KMS client)
`google-cloud-storage`, `google-cloud-kms`, `google-cloud-speech` — official Google clients,
imported only in `app/adapters/`.

## Tests
Real Postgres; fake GCS/KMS/STT. Decrypt chain with chunks encrypted exactly like the browser;
wrong key / tampered chunk / missing chunk → `failed` without partial transcript; temp object
always deleted (also on STT error); idempotent re-run; worker role cannot read client identity;
RLS on transcripts; withdrawn consent before processing → not transcribed. UI: status,
transcript, speaker swap, de/en. One manual end-to-end run against the real Google project with a
test recording (no client data).

## Not in this step
Live transcript during the session, report drafting, signing, `shred_session` / `retention_sweep`
jobs (with the report step).
