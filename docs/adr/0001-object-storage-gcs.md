# 0001 — Object storage: GCS europe-west4

Status: accepted (2026-10-08)

## Context
Encrypted audio chunks need an EU bucket. Options were GCS `europe-west4` or Cloudflare R2 (EU jurisdiction).
Speech-to-Text `BatchRecognize` reads input only from GCS.

## Decision
Use GCS `europe-west4` behind the `ObjectStore` adapter.

## Why
- Audio is small and short-lived: a 50-min Opus session is ~10 MB and is deleted on sign (max 30 days).
  At prototype volume storage costs cents per month with either option.
- R2's advantage (free egress) does not apply: audio is read by Google services in the same region, which is free on GCS.
- With R2 every session would need a copy into GCS for `BatchRecognize` anyway — double storage, an extra
  deletion path for crypto-shredding, and a second vendor to cover in the DPA.

## Consequences
One vendor (Google) for storage, STT, LLM and KMS. The `ObjectStore` adapter keeps R2 possible later.
