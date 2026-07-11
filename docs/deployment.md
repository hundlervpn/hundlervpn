# Deployment (self-hosted single VPS)

> **2026-07 migration:** the web app + database moved OFF Hostman onto our own
> VPS (`159.195.58.174`). There is **no more Hostman auto-deploy on git push** —
> deploys are now a manual `docker compose` on the server. The database is a
> **Postgres container on the same VPS** (no more Hostman managed PG / Timeweb).
> The old `docker-compose.yml`-only + external-DB path still exists for
> reference but is not what production runs.

## Topology

Everything for the web tier runs as Docker containers on the one VPS:

- `hundler-app` — Next.js (standalone) app, listens on `:3000` (internal).
- `hundler-nginx` — reverse proxy + TLS, publishes `:80` / `:443`, proxies to
  `app:3000`. Config in `nginx/conf.d/` (`server_name hundlervpn.xyz`).
- `hundler-certbot` — Let's Encrypt renewals for `hundlervpn.xyz`.
- `hundler-postgres` — Postgres 18 with a named volume `pgdata` and schema
  auto-init (added by `docker-compose.selfhosted.yml`).

VPN servers and the Telegram bots still run on their own separate VPS instances
(unchanged) — this doc is only about the web/API/DB tier.

## Compose files

Production is the **base + self-hosted overlay**, always both:

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhosted.yml up -d --build
```

- `docker-compose.yml` — app + nginx + certbot; leaves the DB external.
- `docker-compose.selfhosted.yml` — adds the `postgres` container, mounts a
  `pgdata` volume, and repoints the app at `POSTGRESQL_HOST=postgres`. On first
  start (empty volume) Postgres runs `/docker-entrypoint-initdb.d/` in order:
  `01-schema.sql` (`db/schema.sql`) then `02-remnawave-bridge.sql`
  (`db/2026-06-27-remnawave-bridge.sql`, columns NOT in schema.sql).

## First-time setup on the VPS

```bash
git clone https://github.com/hundlervpn/hundlervpn.git
cd hundlervpn
cp .env.example .env      # then fill in REAL values (see below) — .env is gitignored
# TLS certs must exist before nginx starts on :443; obtain them once with certbot,
# or start with nginx/conf.d/default.conf.nossl until the cert is issued.
docker compose -f docker-compose.yml -f docker-compose.selfhosted.yml up -d --build
```

## Redeploy after a code change

The production checkout lives at **`/root/hundlervpn`** on the VPS
(`159.195.58.174`). As of 2026-07 the repo is pullable from the server (read
access opened), so deploy = pull + rebuild:

```bash
cd /root/hundlervpn
git pull origin main
docker compose -f docker-compose.yml -f docker-compose.selfhosted.yml up -d --build app
```

Then verify: `curl -s -o /dev/null -w '%{http_code}' https://hundlervpn.xyz/`
should return `200`.

> **Server-local tweaks (do not clobber):** the server working tree carries a
> couple of intentional local changes that no commit on `main` touches, so
> `git pull` leaves them alone — `docker-compose.selfhosted.yml` (adds
> `env_file: .env`) and a removed `nginx/conf.d/default.conf.nossl`. If a pull
> ever refuses because of a locally-modified/untracked path that `main` now
> owns, reset only that specific path (`git checkout -- <file>` / `rm`) — never
> blow away these two infra tweaks.

The `pgdata` volume persists across rebuilds — the schema init scripts only run
on a **fresh/empty** volume, so app rebuilds never touch existing data. Apply
later schema changes with migrations (see `db/README.md`), not by wiping the
volume.

## Useful ops

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhosted.yml ps
docker compose -f docker-compose.yml -f docker-compose.selfhosted.yml logs -f app
docker exec -it hundler-postgres psql -U "$POSTGRESQL_USER" -d "$POSTGRESQL_DBNAME"
```

## Docker image note (still applies)

The `Dockerfile` uses Next.js `output: 'standalone'` and a 3-stage build
(deps → builder → runner), final image runs `node server.js`.
⚠️ Base image is pinned to `node:20.18-alpine3.20`, NOT the moving
`node:20-alpine` tag — a regression in the latest `node:20-alpine` broke image
export. Do NOT bump the base image without verifying a full build + deploy.

## Environment Variables (names only — NEVER commit values)

Provided via the server's `.env` file (gitignored). Full list in `.env.example`.
Key ones:

- APP_URL / NEXT_PUBLIC_APP_URL (public origin, e.g. https://hundlervpn.xyz)
- POSTGRESQL_HOST (`postgres` in the self-hosted overlay) / POSTGRESQL_PORT (5432)
  / POSTGRESQL_USER / POSTGRESQL_PASSWORD / POSTGRESQL_DBNAME
- POSTGRESQL_SSL_MODE (`disable` — the app talks to Postgres over the internal
  Docker network, no TLS needed)
- XRAY_SYNC_TOKEN (shared secret for `/api/xray/*` sync + sub-token HMAC signing)
- TELEGRAM_BOT_TOKEN (Mini-App bot, `hundlervpnbot`)
- TELEGRAM_BOT_CHAT_TOKEN (chat-only bot; falls back to TELEGRAM_BOT_TOKEN)
- NEXT_PUBLIC_TELEGRAM_BOT_USERNAME (public bot handle)
- OXAPAY_API_KEY (crypto payments) / RESEND_API_KEY (email)
- GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (OAuth)
- PLATEGA_MERCHANT_ID / PLATEGA_SECRET_KEY (SBP RU payments)
- VPN_WEBHOOK_SECRET (shared secret with `xray-webhook.py` on the VPN VPS)

**SECURITY NOTE (2026-04-20):** earlier commits (4be5546, 64d1b80, 85dd8e0)
accidentally committed REAL secret values. Treat all of those as compromised
and rotated. History still needs `git filter-repo` + force-push to purge them.
Never paste real secrets into any committed file — `.env` only.
