---
name: encryption-and-keys
description: Use when touching session keys, AES-GCM chunk encryption, OpenPGP therapist and recovery keys (openpgp.js), KMS wrapping, report signing, crypto-shredding, key unlock/rotation, or anything in apps/web/src/crypto or backend/app/adapters/kms.
---

# Encryption and keys

Always plan before changing anything here. Never invent crypto primitives; use WebCrypto, openpgp.js and Cloud KMS.

## Keys

| Key | Type | Where generated | Where stored | Purpose |
|---|---|---|---|---|
| Therapist key | OpenPGP (Curve25519, v6 if supported) | Browser at onboarding | Private key: passphrase-encrypted, in IndexedDB + server copy (still passphrase-encrypted). Public key: server | Decrypt/sign records, unwrap session keys |
| Recovery key | OpenPGP | Browser at onboarding | Private key shown ONCE as file/QR for offline storage; only public key in system | Emergency access to all records |
| Session key | AES-256-GCM, random | Browser at session start | Only in wrapped form | Encrypts audio chunks + drafts |
| Processing key | KMS symmetric key, `europe-west4` | Cloud KMS | Never leaves KMS | Wraps session keys so workers can process |

The server never sees the passphrase or an unencrypted private key.

## Session key lifecycle

1. Browser: `crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt'])`.
2. Export raw key once, then:
   - wrap with therapist PGP public key (openpgp `encrypt`) → `wrapped_keys(kind='therapist')`
   - send raw key to `POST /sessions/{id}/session-key` over TLS; API calls KMS `encrypt` → `wrapped_keys(kind='processing')`; API never stores the raw key.
   - If offline at session start: keep the raw key in memory + a PGP-wrapped copy in IndexedDB; upload for KMS wrapping on reconnect before chunks are processed.
3. Chunks: AES-GCM, new 12-byte random IV per chunk, AAD = `session_id|seq`.
4. Workers: KMS `decrypt` the processing-wrapped key, decrypt chunks **in memory only**, zero buffers after use.

## Sign-off and crypto-shredding

On "Approve and sign" (browser, key unlocked; built, ADR 0021):
1. `POST /sessions/{id}/report/sign/prepare` → the record to sign: `note` (content + metadata + session), `transcript` (as shown, corrections applied), `index` (session no., type, topics), legacy `addenda`, `approved_at`, `report_updated_at`, fingerprints.
2. Browser (`crypto/records.ts`): each part as JSON → `signAndEncrypt` to [therapist, recovery], then decrypt + verify with its own key before upload.
3. `POST .../report/sign`. In one DB transaction: messages on `report_versions` (version 1: `pgp_message`, `transcript_pgp`; `signer_fingerprint`, `encrypted_to`), `reports.index_pgp`, `status='signed'`; `content_enc`, `draft_enc`, `transcripts.segments_enc` set NULL; transcript windows and the `processing` wrapped key deleted; session `status='signed'`, `audio_state='shred_pending'`. DB triggers keep it that way.
4. Addenda to a signed note: signed messages (`{text, created_at}`), version ≥ 2.
5. Signing also deletes the session's capture chips; confirmed ones are in the signed note.
6. `shred_audio` job (`app/workers/shred.py`, idempotent, plan 0015): first delete all `wrapped_keys` (committed), then objects under `sessions/{id}/` and `stt-tmp/{id}*`, then `audio_state='shredded'`. Also runs for withdrawn consent and for unsigned sessions past `retention_deadline`.
Destroying the processing-wrapped key makes any leftover copies (backups, replicas) unreadable.

Optional later feature (separate consent): keep audio for supervision — only the therapist-wrapped key remains.

## Unlock UX

- Unlock once per app session with passphrase; keep the decrypted private key in memory only; lock after 15 min idle and on tab close.
- Later: WebAuthn PRF to derive the unlock key (passkeys) — design interfaces so this drops in.

## Client identity fields

Name, date of birth, contact: OpenPGP-encrypted to therapist + recovery keys, decrypted only in the browser. Search happens client-side after decryption.

## Rules

- Every record stores `encrypted_to: [key fingerprints]` so keys can be added/rotated by a background re-encryption job.
- Onboarding cannot finish until the user confirms the recovery key was saved (download + re-type a short checksum). The checksum may be emailed with the user's consent (ADR 0017) — only the code, never the key.
- Never log keys, IVs together with ciphertext refs, passphrases, or decrypted content.
- Local IndexedDB encryption does not protect against a compromised device — this limitation is documented in the DPIA, not hidden.

## Tests (required)

Wrong passphrase, wrong key, tampered ciphertext (GCM auth failure), tampered signature, missing recovery recipient, shred job re-run (idempotent), processing after shred fails cleanly.
