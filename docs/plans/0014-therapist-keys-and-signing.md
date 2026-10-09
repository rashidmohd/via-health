# Plan 0014 — Therapist keys and signing

Status: step A built 2026-10-09. Approved by the product owner: `openpgp` 6.x, and the server drops
its readable copies once a record is signed. Steps B and C open.

## Goal
STATUS item 2 / CLAUDE.md rule 7. The therapist creates an OpenPGP key and a recovery key in the
browser (Keys screen). Approving a session note becomes **signing** it: the browser signs the
final note and its transcript with the therapist key and encrypts them to [therapist, recovery].
After that the server cannot read the record. Built in three steps, each its own PR.

## Dependency (approved)
`openpgp` 6.3.2 (pinned) in `apps/web`, loaded on first use (own ~130 KB gzip chunk, not in the
app bundle). v6 keys (Ed25519/X25519), passphrase protection with Argon2 (S2K). No new backend
crypto library: the server stores armored PGP data and never parses it.

## Step A — Keys screen
- `src/crypto/pgp.ts`: `createTherapistKey(passphrase)`, `createRecoveryKey()`, `unlock`,
  `signAndEncrypt(data, recipients)`, `decryptAndVerify`. Thin wrappers over openpgp.js, nothing
  self-made.
- `src/crypto/keyring.ts`: the unlocked private key lives in memory only; locks after 15 min idle
  and on tab close. Interface takes an "unlock secret" so WebAuthn PRF can be added later.
- Onboarding wizard on `/keys`: passphrase twice (min. 12 characters) → keys generated →
  recovery private key downloaded as `sessio-recovery-key.asc` → therapist types the check code
  (last 8 recovery-fingerprint characters, written only in the file's `Comment:` line) → keys
  stored. Nothing is sent to the server before that check (skill rule). With consent the code
  can be emailed instead (`POST /keys/check-code-email`, ADR 0017).
- Set up: fingerprints, locked/unlocked, Unlock / Lock now, download public key. `UnlockForm` is
  exported for step B, where an unlock dialog opens wherever a key is needed.
- Device copy of the encrypted private key in IndexedDB (Dexie); server copy is the same
  passphrase-encrypted blob.
- Backend: uses the existing `users` columns `pgp_public_key`, `pgp_private_key_enc`,
  `recovery_public_key`, `key_fingerprints`. Migration 0013 adds a check (all four or none) and
  a trigger that makes them write-once (`keys_immutable`). `GET /keys` (404 `keys_missing`),
  `PUT /keys` (409 `keys_exist`); `/auth/me` returns `has_keys`. Audit `keys_created` (ids only).
  The server checks armor headers and fingerprint format only; a private key sent as a public
  key is rejected.
- Strings de + en.

## Step B — Sign session notes
- "Approve" becomes **"Approve and sign"** (key unlocked, otherwise the unlock dialog first).
- `POST /sessions/{id}/report/sign/prepare` → server runs today's checks (unresolved flags,
  session no.) and returns the canonical snapshot (note, template, AI metadata, time) and the
  transcript.
- Browser: sign + encrypt the note, the transcript and a small **index** (session no., type,
  topics) to [therapist, recovery], decrypt again with its own key to check, then
  `POST .../report/sign` with the three messages, `signer_fingerprint` and `encrypted_to`.
- Server, in one transaction (rule 17): store the messages on `report_versions` (version 1,
  kind `approval`), status `signed`, **clear its readable copies** (`content_enc`, `draft_enc`,
  transcript text and segments), delete the `processing` wrapped key, set the session's
  `audio_state = 'shred_pending'`. The shred job itself is STATUS item 3.
- Read-only view, print and addenda decrypt in the browser; an addendum is signed + encrypted
  the same way (version ≥ 2).
- Reports page: server sends ids, dates and the encrypted index only; the browser decrypts topics
  after unlock (locked: rows without topics plus an "Unlock to show topics" hint).
- Notes approved before this step (test data): shown as "approved, not signed", with a Sign button.

## Step C — Session keys wrapped to the therapist
At recording start the browser also wraps the session key to the therapist public key
(`wrapped_keys.kind = 'therapist'`), so audio stays readable to the therapist after the
processing key is destroyed. Recording needs the keys to be set up (public key only, no unlock).
Offline start: wrapped copy kept in IndexedDB and uploaded with the chunks.

## Not in this plan
- Moving client identity off the interim server key (ADR 0004): conflicts with server-side name
  placeholders for the LLM (ADR 0007) and server-side search — needs its own plan.
- Key rotation, re-encryption job, recovery-key restore flow (lost passphrase), passkeys.
- Server-side signature check (would need a Python OpenPGP library); the browser checks before upload.

## Tests
Web: wrong passphrase, wrong key, tampered ciphertext, tampered signature, missing recovery
recipient, lock after idle, onboarding blocked without checksum, de/en strings.
Backend: keys set only once, sign stores messages and clears readable copies in one transaction,
sign twice → 409, wrong state → 409, processing key gone after signing, transcription after
signing fails cleanly, other therapist sees nothing (RLS).
