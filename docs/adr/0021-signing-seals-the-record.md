# 0021 — Signing seals the record

Status: accepted (2026-10-09)

## Decision
- "Approve" is now **"Approve and sign"**; the plain approve endpoint is gone. A note can only
  become final by being signed (rule 7). Two calls: `sign/prepare` runs the approval checks and
  returns the record to sign (note + metadata, transcript as the therapist sees it, an index of
  session no., type and topics); `sign` stores the three OpenPGP messages.
- `sign` drops in one transaction: note text and AI draft, transcript segments, leftover
  transcript windows, and the KMS processing key. The session becomes `status = signed`,
  `audio_state = shred_pending` (the shred job is STATUS item "deletion jobs").
- The server cannot verify OpenPGP (no library on the server, plan 0014). It checks armor
  headers, that the signer fingerprint is the therapist key, that the recipients are exactly the
  therapist and recovery keys, and that the note did not change since `prepare`
  (`report_updated_at`, and `approved_at` at most one hour old). The browser decrypts and
  verifies each message with its own key before sending.
- DB triggers: a signed note never changes; a sealed transcript (segments NULL) never gets a
  readable copy back, not even from the worker. The one allowed change to approved rows is
  sealing them (approved → signed, `content_enc` → `pgp_message`).
- Notes approved before signing existed (test data) show "Approved, not signed" with "Sign now";
  they are signed with their addenda, approval date unchanged. No new addenda until signed.
- Addenda to a signed note are signed messages too (`{text, created_at}`).
- Recording needs the keys set up: the session key is wrapped to the therapist public key at
  start (step C), before the microphone opens. Offline this uses the device copy of the keys.
- Reports page and session page decrypt in the browser after unlock; locked rows show "—".

## Why
Rule 7 and plan 0014. A separate approve step would leave a window where the server can read
a final record. Sealing old approved notes keeps them instead of discarding test data.

## Consequences
- Session cards show no topics for signed notes (the server cannot read them).
- Capture chip texts (server key, ADR 0004) are not cleared at signing; they are not part of the
  signed record. Decide with the deletion jobs.
- Signing needs the passphrase; a lost passphrase means only the recovery key opens records.
- A recovery tool needs only the recovery key: records are self-contained JSON (client name,
  session date, content).
