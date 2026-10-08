---
name: railway-deploy
description: Use when setting up or changing Railway services, environment variables, Dockerfiles, the Google Cloud project (Speech-to-Text, Vertex, KMS, GCS) or anything about hosting, regions and secrets.
---

# Railway + Google setup

## Railway services (all pinned to the EU region at creation)

| Service | Source | Notes |
|---|---|---|
| `web` | `apps/web` | static PWA build served by a small static server; strict CSP |
| `api` | `backend` | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| `worker` | `backend` | `arq app.workers.settings.WorkerSettings`; needs ffmpeg in the image |
| `postgres` | Railway plugin | backups on |
| `redis` | Railway plugin | queue only, no PHI stored in job payloads (IDs only) |

Separate Railway environments for `dev` and `prod`, each with its own Google project.

## Environment variables

```
DATABASE_URL, REDIS_URL
APP_ENV=dev|prod
WEB_ORIGIN=https://...
GCP_PROJECT_ID, GCP_REGION=europe-west4
GOOGLE_APPLICATION_CREDENTIALS_JSON   # service account JSON as secret, written to memory at startup
OBJECT_STORE=gcs|r2
GCS_BUCKET=...                        # EU bucket
R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   # only if OBJECT_STORE=r2, jurisdiction "eu" endpoint
KMS_KEY_NAME=projects/.../locations/europe-west4/keyRings/.../cryptoKeys/processing
STT_MODEL=chirp_3
LLM_MODEL=<gemini model id>
WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME
AUDIO_MAX_RETENTION_DAYS=30
```
Never commit secrets. `.env.example` lists names only.

## Google Cloud project checklist (per environment)

- Region `europe-west4` for GCS, KMS, Speech-to-Text (verify Chirp 3 availability via locations API), Vertex.
- Speech-to-Text **data logging OFF**; block via org policy if possible.
- Vertex: disable data caching; request the abuse-monitoring exception (needed for zero retention); no grounding.
- GCS bucket: uniform access, no public access, lifecycle rule deleting `sessions/` and `stt-tmp/` objects after `AUDIO_MAX_RETENTION_DAYS`.
- KMS: symmetric key `processing`, rotation 90 days; old versions kept until no wrapped key uses them.
- Service account roles (minimal): Speech client, Vertex AI user, KMS encrypter/decrypter on the one key, Storage object admin on the one bucket.

## R2 (only if chosen)

Create the bucket with jurisdiction `eu` (cannot be changed later), use the `<account>.eu.r2.cloudflarestorage.com` endpoint, S3 API only (no Workers bindings), lifecycle rule as above. Note: BatchRecognize needs a GCS copy → handled in `transcription-pipeline`.

## Security headers (web)

CSP with `script-src 'self' 'wasm-unsafe-eval'`, `connect-src` limited to the API and the storage upload host, `Permissions-Policy: microphone=(self)`, HSTS. COOP/COEP if sherpa-onnx threads need SharedArrayBuffer.

## Deploy rules

- Run migrations as a release step before `api` starts.
- Health checks: `api /healthz` (no DB details in body), worker heartbeat key in Redis.
- No PHI in Railway logs; log IDs only.
