# Google Cloud setup (dev)

For recorder step B (transcription). Everything in **europe-west4 (Netherlands)** — CLAUDE.md rule 4.
Time: about 30–45 minutes. Do it once for `dev`; `prod` later gets its own project.

> Never paste the service-account JSON key into a chat, an issue or git. It goes only into Railway
> and into a file outside the repo on your computer.

## 0. Railway: make migrations run on every deploy
1. Railway → `api` → **Settings** → **Deploy** → **Pre-deploy command**: `alembic upgrade head`
2. **Deploy** → open the deployment → **Pre-deploy** logs show `Running upgrade …`.

## 1. Project and billing
1. https://console.cloud.google.com → project picker (top left) → **New project**.
   Name: `sessio-dev`. Note the **Project ID** (e.g. `sessio-dev-123456`).
2. **Billing** → link a billing account to the project.
3. **Billing → Budgets & alerts → Create budget**: e.g. 20 €/month, alerts at 50 %, 90 %, 100 %.

## 2. Enable the APIs
**APIs & Services → Library**, open each and click **Enable**:
- Cloud Storage API (usually already on)
- Cloud Key Management Service (KMS) API
- Cloud Speech-to-Text API
- *(only for production, ADR 0005)* Vertex AI API

## 3. Storage bucket for encrypted audio
**Cloud Storage → Buckets → Create**:
| Setting | Value |
|---|---|
| Name | `sessio-dev-audio-<something unique>` (globally unique, lowercase) |
| Location type | **Region** → `europe-west4 (Netherlands)` |
| Storage class | Standard |
| Prevent public access | **On** (enforce) |
| Access control | **Uniform** |
| Soft delete | **Off** (deleted audio must really be gone) |
| Object versioning | Off |
| Encryption | Google-managed key (audio is already encrypted by the app) |

After creating: bucket → **Lifecycle** → **Add a rule** → Action **Delete object**,
condition **Age = 30 days** → Create. (Hard maximum for audio, rule 6.)

Add a second rule: **Delete object**, **Age = 1 day**, **Object name matches prefix** `stt-tmp/`
(safety net for the temporary audio copy used by transcription, plan 0005).

## 4. Key for session keys (Cloud KMS)
**Security → Key Management → Create key ring**:
- Key ring name `sessio`, location type **Region** → `europe-west4`.

Then **Create key**:
- Name `processing`, protection level **Software**, purpose **Symmetric encrypt/decrypt**,
  rotation **90 days** → Create.

Copy its **resource name** (key → ⋮ → **Copy resource name**):
`projects/<project-id>/locations/europe-west4/keyRings/sessio/cryptoKeys/processing`

## 5. Service account (what the API and worker log in as)
**IAM & Admin → Service accounts → Create service account**:
- Name `sessio-api` → **Create and continue**.
- Role (project level): **Cloud Speech Client** → Done.
  *(Only for production, with Vertex AI (ADR 0005): add **Vertex AI User**.)*

Give it access to only the one bucket and the one key:
- Bucket → **Permissions → Grant access** → principal `sessio-api@<project-id>.iam.gserviceaccount.com`,
  role **Storage Object Admin** → Save.
- KMS key `processing` → **Permissions → Grant access** → same principal, role
  **Cloud KMS CryptoKey Encrypter/Decrypter** → Save.

## 6. Key file
Service account `sessio-api` → **Keys → Add key → Create new key → JSON** → it downloads a file.
- Move it **outside the repo**, e.g. `~/.config/sessio/gcp-dev.json`.
- If Google says key creation is disabled by an organisation policy, stop and tell Claude.

## 7. Speech-to-Text privacy
Chirp 3 runs in location **`eu`** (EU multi-region); it is not available in `europe-west4`.

**Speech-to-Text → Settings** (if shown): data logging must be **off**. Never opt in to the
data-logging discount (rule 5).

## 8. Variables
Railway → `api` **and** `worker` → Variables:
```
GCP_PROJECT_ID=<project-id>
GCP_REGION=europe-west4
GCS_BUCKET=<bucket name>
KMS_KEY_NAME=projects/<project-id>/locations/europe-west4/keyRings/sessio/cryptoKeys/processing
GOOGLE_APPLICATION_CREDENTIALS_JSON=<paste the whole content of the JSON file>
```
Do **not** set `OBJECT_STORE=gcs` yet — the code for GCS comes in step B and switches it on.

Local (`backend/.env.local`), so Claude can verify the setup:
```
GCP_PROJECT_ID=<project-id>
GCS_BUCKET=<bucket name>
KMS_KEY_NAME=projects/<project-id>/locations/europe-west4/keyRings/sessio/cryptoKeys/processing
GOOGLE_APPLICATION_CREDENTIALS=/Users/<you>/.config/sessio/gcp-dev.json
```

## 9. Tell Claude "Google Cloud is ready"
Claude then checks (read-only where possible): bucket region, public-access prevention,
lifecycle rule, soft delete, KMS key location, Chirp 3 availability in the EU, and that the
service account can encrypt/decrypt with the key.

## Later (before real clients)
- Vertex AI (session notes, plan 0009): enable the Vertex AI API, give the service account
  *Vertex AI User*, **disable the 24 h in-memory cache** for the project (rule 5; it is a
  project setting, not a request option), and request the **abuse-monitoring exception**
  (needed for zero data retention). Then `LLM_PROVIDER=vertex`, `LLM_MODEL=<current Flash model>`.
- A separate `sessio-prod` project; DPA with Google.
