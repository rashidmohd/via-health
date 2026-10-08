FROM node:24-slim AS build
# bzip2: unpack the speech engine release for the live preview
RUN apt-get update && apt-get install -y --no-install-recommends bzip2 \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
# Live preview assets (~85 MB, checksum-pinned). Own layer: re-downloaded only when the script changes.
COPY scripts/build-live-stt.mjs scripts/
RUN node scripts/build-live-stt.mjs --cache /tmp/live-stt && rm -rf /tmp/live-stt
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Railway passes service variables as build args when declared here.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
