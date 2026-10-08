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
     (runs `alembic upgrade head` before each deploy, health check `/healthz`)
   - **Deploy → Regions:** EU West (Amsterdam)
   - **Networking → Generate domain**
3. **Variables** (use the *Add reference* helper or paste):
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   APP_ENV=prod
   GCP_REGION=europe-west4
   WEB_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
   ```

## 3. `worker` service
1. **+ Create** → **GitHub Repo** → `via-health` again. Rename to `worker`.
2. **Settings:** Root directory `/backend`, config file `/infra/railway/worker.toml`,
   region EU West. No public domain.
3. **Variables:**
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   APP_ENV=prod
   GCP_REGION=europe-west4
   ```

## 4. `web` service
1. **+ Create** → **GitHub Repo** → `via-health`. Rename to `web`.
2. **Settings:** Root directory `/apps/web`, config file `/infra/railway/web.toml`,
   region EU West, **Networking → Generate domain**.
3. **Variables:**
   ```
   API_ORIGIN=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
   ```

## 5. Check it works
- `https://<api domain>/healthz` → `{"status":"ok"}`
- `https://<web domain>` → app with the sidebar
- `api` → **Deployments** → latest → pre-deploy logs show
  `Running upgrade -> 835036395acb`
- `worker` logs show arq starting; it writes `worker:heartbeat` to Redis every minute.

## Later (not needed yet)
Google Cloud variables (`GCP_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `GCS_BUCKET`,
`KMS_KEY_NAME`, `LLM_MODEL`) and WebAuthn settings are added when those features are built.
See `.claude/skills/railway-deploy/SKILL.md`. A separate `sessio-prod` project comes later.
