#!/bin/sh
# Apply pending migrations (no-op when up to date), then start the API.
# Runs in the container on every start, so it does not depend on a Railway pre-deploy setting.
set -e
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips='*'
