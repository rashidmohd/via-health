# 0004 — Interim server key for client data

Status: accepted (2026-10-08)

## Context
CLAUDE.md: client identity is PGP-encrypted to the therapist key. Therapist keys (Keys screen)
are not built yet; the user wants the client list first.

## Decision
Until therapist keys exist, encrypt client identity and consent signatures on the server with
AES-256-GCM (`cryptography` library) under `CLIENT_DATA_KEY` (Railway secret, 32 bytes hex).
Ciphertexts carry a version byte (`0x01`) so a later migration can re-encrypt them to the
therapist key and tell old from new.

## Consequences
- The server can read client names while this is in place; the database alone cannot.
- Losing `CLIENT_DATA_KEY` makes client names unreadable; changing it needs a re-encryption job.
- To be replaced when the encryption-and-keys step lands.
