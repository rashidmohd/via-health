# Plan 0003 — Clients and consent capture

Status: implemented (2026-10-08)

## Scope
- Client list (search, consent status, last session), add client, client page, edit, archive.
- Consent capture on the therapist's device: texts in the client's language, one checkbox per
  kind (never bundled), who signs (client / guardian), on-screen signature.
- Withdraw a single consent.

## Encryption (ADR 0004)
Client identity (name, date of birth, email, phone) and consent signatures are encrypted with
AES-256-GCM under `CLIENT_DATA_KEY` (server key) until therapist keys exist.
Format: `0x01 | 12-byte nonce | ciphertext`. AAD binds each ciphertext to its row and field
(`client:<id>:identity`, `consent:<id>:signature`), so ciphertexts cannot be swapped between rows.
No schema change: `clients.identity_enc` and `consents.signature_enc` already exist.

## API (login required, RLS applies)
| Method | Path | |
|---|---|---|
| GET | `/clients` | list with consent status per kind + `ready_to_record` |
| POST | `/clients` | create |
| GET | `/clients/{id}` | detail + consent history |
| PATCH | `/clients/{id}` | edit identity, language, status (`active` / `archived`) |
| GET | `/consent-texts?language=de` | latest text per kind |
| POST | `/clients/{id}/consents` | grant selected kinds, one row each, with signature |
| POST | `/consents/{id}/withdraw` | withdraw one consent (DB marks unprocessed audio for deletion) |

Consent status per kind: `granted` (active, latest text version) · `outdated` (active, older
version) · `withdrawn` · `missing`. Ready to record = recording + ai_processing granted.
Audit log: `client_created`, `client_updated`, `consent_granted`, `consent_withdrawn` — IDs only.

## Tests
Encryption round trip, wrong key, swapped ciphertext (AAD), tampering. API: other therapist's
client → 404, bundling impossible, re-consent after new text version, duplicate grant rejected,
withdraw, archived client, signature required, no names in error responses. Web: list, add,
consent flow, withdraw, de/en.
