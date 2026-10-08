# Plan 0001 — Data model, row-level security and consent enforcement

Status: implemented (2026-10-08)

## Scope of this step
Tables needed to record a session with valid consent. Reports, transcripts and templates come later
with their own pipelines.

| Table | Notes |
|---|---|
| `users` | therapist; PGP key columns nullable until the keys step |
| `clients` | `identity_enc`, `hotwords_enc` are ciphertext (bytea); `status` active/restricted/archived |
| `consent_texts` | immutable (update/delete blocked by trigger); unique (kind, version, language) |
| `consents` | one row per kind — never bundled; `withdrawn_at`; method; `signed_by` client/guardian |
| `sessions` | UUID from the browser (v7); status + audio_state; `retention_deadline = started_at + 30 days` |
| `audio_chunks` | PK (session_id, seq); duplicate upload of the same chunk is idempotent (same sha256) |
| `wrapped_keys` | therapist / processing wrapped session keys |
| `audit_log` | append-only (update/delete blocked); IDs only, no PHI |

Placeholder consent texts (ADR 0002) are seeded in the migration.

## Row-level security
- App connects as role `sessio_app` (not owner, no BYPASSRLS). Each request runs
  `SET LOCAL app.user_id = :uid` inside its transaction.
- Policy on every PHI table: visible only if it belongs to the current user (directly or via client/session).
- No `app.user_id` set → zero rows (fails closed).
- Worker role `sessio_worker` comes with the transcription step, not now.

## Consent enforcement (DB layer now; API layer with the session endpoints; browser later)
- Trigger on `sessions` INSERT and `audio_chunks` INSERT: raise `consent_missing` unless the client has
  a non-withdrawn `recording` AND `ai_processing` consent on the **latest** text version for that kind.
- Trigger on `clients`: restricted/archived clients cannot get new sessions.
- Withdrawal: setting `withdrawn_at` blocks new chunks immediately. Deleting unprocessed audio is a worker job
  (comes with the pipeline) — this step only marks the session `audio_state = 'shred_pending'`.

## Tests (real Postgres, throwaway database per test run)
- RLS: user A sees zero rows of user B without any WHERE clause; no `app.user_id` → zero rows.
- Consent: session insert fails with no consent / only one kind / withdrawn / outdated text version; succeeds with both.
- Chunk insert fails after withdrawal mid-session; duplicate chunk with same hash is a no-op, different hash fails.
- `consent_texts` and `audit_log` cannot be updated or deleted.
- Migration upgrade → downgrade → upgrade runs clean.

## Not in this step
Auth/passkeys, API endpoints, reports, transcripts, captures, client documents, retention job.

## Implementation notes
- App connections `SET ROLE sessio_app` on connect (`app/db/session.py`), so RLS applies even when
  `DATABASE_URL` points at the owner/superuser. Migrations run as the owner.
- Retention hard max is a CHECK constraint: `retention_deadline <= started_at + 30 days`.
- Trigger errors are stable codes (`app/db/errors.py`), translated in `apps/web/src/i18n/{de,en}.json`.
  Tests fail if a code lacks a German or English message.
- Tests start a throwaway Postgres via `initdb` unless `TEST_DATABASE_URL` is set.
