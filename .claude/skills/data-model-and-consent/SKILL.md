---
name: data-model-and-consent
description: Use when creating or changing the Postgres schema, Alembic migrations, row-level security, consent capture and enforcement, the client profile, retention rules, data export, or the audit log.
---

# Data model and consent

PostgreSQL with SQLAlchemy 2 + Alembic. Access control is enforced by row-level security (RLS).

## Core tables

```
users              id, email, display_name, pgp_public_key, pgp_private_key_enc, recovery_public_key,
                   key_fingerprints jsonb, avatar_kind, avatar_reactions, avatar_tilt,
                   avatar_photo_enc (server data key, ≤ 300 KB, ADR 0011), created_at
clients            id, user_id → users, identity_enc (PGP: name, dob, contact), preferred_language,
                   hotwords_enc, status ('active'|'restricted'|'archived'), created_at
consent_texts      id, version, language, kind, body, published_at          -- immutable
consents           id, client_id, kind ('recording'|'ai_processing'|'product_improvement'),
                   consent_text_id, granted_at, withdrawn_at, method ('tablet_signature'|'remote_link'),
                   signature_enc, signed_by ('client'|'guardian')
sessions           id (uuid v7, client-generated), client_id, user_id, started_at, ended_at,
                   status ('recording'|'uploaded'|'processing'|'draft_ready'|'signed'|'failed'),
                   audio_state ('present'|'shred_pending'|'shredded'), total_chunks, duration_ms,
                   template_id, retention_deadline
audio_chunks       session_id, seq, object_key, sha256, bytes, uploaded_at   PK(session_id, seq)
wrapped_keys       id, session_id, kind ('therapist'|'processing'), ciphertext, kms_key_version, created_at
transcript_windows session_id, idx, start_ms, end_ms, text_enc                -- interim, deleted on sign
transcripts        session_id, segments_enc (speaker/start/end/text), stt_model, created_at
captures           id, session_id, kind, payload_enc, confirmed bool
reports            id, session_id, kind ('session_note'|'intake'|'progress'|'discharge'|'client_summary'),
                   template_id, status ('draft'|'signed'|'rejected'),
                   draft_enc (session-key encrypted), pgp_ciphertext, signer_fingerprint,
                   encrypted_to jsonb, signed_at
report_templates   id, name, kind, structure jsonb, version
client_documents   id, client_id, kind ('consent_copy'|'session_summary'|'data_export'), report_id,
                   delivery_token_hash, expires_at, delivered_at
audit_log          id bigserial, at, actor_user_id, action, entity, entity_id, meta jsonb   -- append-only
```

`*_enc` columns hold ciphertext only. No plaintext PHI columns.

## Row-level security

- Set `app.user_id` per request (`SET LOCAL app.user_id = :uid` inside the transaction).
- Policy on every PHI table: rows visible only where the owning `user_id = current_setting('app.user_id')::uuid` (via join to clients/sessions).
- Workers use a separate DB role with access only to the columns they need, by `session_id`.
- Test: a query as user A must return zero rows of user B, even without a WHERE clause.

## Consent enforcement (three layers)

1. **DB**: trigger on `sessions` insert and on `audio_chunks` insert → raise unless the client has non-withdrawn `recording` AND `ai_processing` consents.
2. **API**: same check on session creation and every chunk upload-URL request; 409 `consent_missing`.
3. **Browser**: cached consent status disables the record button offline.

Withdrawal: set `withdrawn_at`; block new recording immediately; enqueue deletion of unprocessed audio for that client. Signed records remain (retention duty) — mark client `restricted` if erasure is requested.

Consent texts are versioned; a new version requires re-consent before the next recording. Bundling consents is not allowed. Minors: `signed_by='guardian'`.

## Client profile (minimal)

Only what is needed: identity (encrypted), language, treating user, consents, sessions, hotwords. Everything else references `client_id` (pseudonymised).

## Retention

- Audio: deleted on sign; hard deadline `retention_deadline = started_at + 30 days` enforced by `retention_sweep`.
- Interim transcript windows and drafts: deleted on sign or rejection.
- Signed reports/transcripts: 10 years (§630f BGB) or practice policy; then deletion job.
- Audit log: same as the records it covers.

## Client rights

- Data export (GDPR Art. 15/20, §630g BGB): generated from signed records, with a therapist redaction step before release.
- Erasure requests normally yield to the retention duty → `restricted` status, not deletion.

## Migrations

Additive and reversible. Never drop or rewrite columns holding signed records. Every migration that touches RLS ships with an RLS test.
