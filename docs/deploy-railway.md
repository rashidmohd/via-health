# Deploying on Railway (dashboard)

Five services in one Railway project: `Postgres`, `Redis`, `api`, `worker`, `web`.
Code is deployed from GitHub (`rashidmohd/via-health`, branch `main`).

> Prototype only. Consent texts are placeholders (ADR 0002) — no real clients.

## 1. Project and databases
1. railway.com → **New Project** → **Empty project**. Name it `sessio-dev`.
2. **+ Create** → **Database** → **PostgreSQL**. Then again → **Redis**.
3. For **each** of them: open the service → **Settings** → **Deploy** → **Regions** →
   choose **EU West (Amsterdam)**, then deploy. Do this before any data exists.

## 2. `api` service
1. **+ Create** → **GitHub Repo** → `via-health`. Rename the service to `api`.
2. **Settings**
   - **Source → Root directory:** `/backend`
   - **Config-as-code → Railway config file:** `/infra/railway/api.toml`
     (health check `/healthz`). **Custom start command: leave empty** — the image runs
     `scripts/start-api.sh`, which applies migrations and then starts the API.
   - **Deploy → Regions:** EU West (Amsterdam)
   - **Networking → Generate domain**
3. **Variables** (use the *Add reference* helper or paste):
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   APP_ENV=staging   # hosted, test data only; prod later (needs Vertex, ADR 0005)
   GCP_REGION=europe-west4
   WEB_ORIGIN=https://via.bandi.ae          # exact web address, no trailing slash
   AUTH_SECRET=<64 random characters>        # e.g. `openssl rand -hex 32`; never change casually
   EMAIL_SENDER=resend
   RESEND_API_KEY=<from Resend>
   EMAIL_FROM=Sessio <hello@via.bandi.ae>
   CLIENT_DATA_KEY=<another `openssl rand -hex 32`>   # encrypts client names (ADR 0004)
   TEST_LOGIN_EMAIL=test@sessio.io            # optional test account, fixed code, no email (ADR 0019)
   TEST_LOGIN_CODE=<6 digits, keep secret>   # refused when APP_ENV=prod
   ```
   Changing `AUTH_SECRET` logs everyone out and invalidates pending codes.
   **Never change or lose `CLIENT_DATA_KEY`:** client details become unreadable. Keep a copy in a
   password manager.

## 3. `worker` service
1. **+ Create** → **GitHub Repo** → `via-health` again. Rename to `worker`.
2. **Settings:** Root directory `/backend`, config file `/infra/railway/worker.toml`,
   region EU West. No public domain. **Deploy → Custom start command:**
   `arq app.workers.settings.WorkerSettings` (otherwise it would start the API).
3. **Variables:**
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   APP_ENV=staging   # hosted, test data only; prod later (needs Vertex, ADR 0005)
   GCP_REGION=europe-west4
   ```

## 4. `web` service
The image build downloads the live preview engine and the German and English models (~310 MB
download, ~155 MB served, checksum-verified). The first build takes a few minutes longer; later builds reuse the layer.

1. **+ Create** → **GitHub Repo** → `via-health`. Rename to `web`.
2. **Settings:** Root directory `/apps/web`, config file `/infra/railway/web.toml`,
   region EU West, **Networking → Generate domain**.
3. **Variables:**
   ```
   API_ORIGIN=https://viaapi.bandi.ae    # used in the security header (runtime)
   VITE_API_URL=https://viaapi.bandi.ae  # baked into the app at build time → redeploy after changing
   ```

## 4b. Google Cloud variables (`api` and `worker`, plan 0005)
Set up the project first: `docs/google-cloud-setup.md`. Best as **Shared Variables**:
```
OBJECT_STORE=gcs
KMS_PROVIDER=gcp
STT_PROVIDER=google
GCP_PROJECT_ID=<project id>
GCS_BUCKET=<bucket>
KMS_KEY_NAME=projects/<project id>/locations/europe-west4/keyRings/<ring>/cryptoKeys/<key>
GOOGLE_APPLICATION_CREDENTIALS_JSON=<base64 of the key file, see below>
```
Recommended: paste the key file **base64-encoded** (one line, nothing an editor can break):
```bash
base64 -i ~/.config/via/gcp-dev.json | tr -d '\n' | pbcopy
```
Plain JSON also works (line breaks inside the private key are tolerated).
The `worker` needs the **same** variables as `api` (it validates the same settings).

## 4c. AI session note (`api` and `worker`, plan 0009)
Staging (test data only, ADR 0005) — Gemini API key on the **paid tier**
(aistudio.google.com → API keys; billing enabled on its project):
```
LLM_PROVIDER=gemini_api
LLM_API_KEY=<key>
LLM_MODEL=gemini-3.8-flash   # or the current Flash model
```
Without these the worker uses `LLM_PROVIDER=fake` (fixed demo drafts, no AI).
Prod: `LLM_PROVIDER=vertex` (EU, `GCP_REGION=europe-west4`), see `docs/google-cloud-setup.md`.

## 5. Resend (login emails, ADR 0003)
1. resend.com → **Domains → Add domain** → `bandi.ae`, **Region: Ireland (eu-west-1)**.
   The region cannot be changed later.
2. Add the DNS records Resend shows (MX, TXT/SPF, DKIM) in Cloudflare as **DNS only (grey cloud)**.
   Wait for "Verified".
3. **API Keys → Create** with permission *Sending access*, domain `bandi.ae` → put it in
   `RESEND_API_KEY` on `api`.

## 6. Check it works
- `https://<api domain>/healthz` → `{"status":"ok"}`
- `https://via.bandi.ae` → sign-in page; sign up, receive the code by email, land in the app
- `api` → **Deployments** → latest → pre-deploy logs show
  `Running upgrade -> 835036395acb`
- `worker` logs show arq starting; it writes `worker:heartbeat` to Redis every minute.

## Later (not needed yet)
Google Cloud variables (`GCP_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `GCS_BUCKET`,
`KMS_KEY_NAME`) and WebAuthn settings are added when those features are built.
See `.claude/skills/railway-deploy/SKILL.md`. A separate `sessio-prod` project comes later.
