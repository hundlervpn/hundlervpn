## Tech Stack
- Frontend + API: Next.js (App Router), React, TypeScript, TailwindCSS
- DB: PostgreSQL **as a container on our own VPS** (`159.195.58.174`), started
  by `docker-compose.selfhosted.yml` as the `hundler-postgres` service with a
  persistent `pgdata` volume and auto-applied schema. The app connects over the
  internal Docker network (`POSTGRESQL_HOST=postgres`, `sslmode=disable`).
  **History:** originally Timeweb (`5.42.118.215`, dead), then Hostman managed
  PG (also dead as of the 2026-07 self-host migration). Do not connect to either
  old host. Real credentials live in the server's `.env` (gitignored); never
  paste them into committed files. See `docs/database.md`.
- Web hosting: **self-hosted single VPS** (`159.195.58.174`), all containers via
  Docker Compose (`docker-compose.yml` + `docker-compose.selfhosted.yml`):
  `hundler-app` (Next.js), `hundler-nginx` (TLS + reverse proxy for
  `hundlervpn.xyz`), `hundler-certbot`, `hundler-postgres`. There is **no
  Hostman auto-deploy on git push anymore** — deploys are a manual
  `docker compose ... up -d --build` on the server (see `docs/deployment.md`).
  Deploy is Dockerfile-based — `Dockerfile` at the repo root uses
  Next.js `output: 'standalone'`, builds in 3 stages (deps → builder →
  runner), final image ~180 MB, runs `node server.js`.
  ⚠️ **CRITICAL**: base image is pinned to `node:20.18-alpine3.20`,
  NOT the moving `node:20-alpine` tag. The latest `node:20-alpine`
  (digest `fb4cd12c85...`) has a BuildKit regression that silently fails
  on `> exporting to image:` with no error message — `pushing layers`
  succeeds but `exporting manifest` never completes (first hit on Hostman
  2026-04-28, but it's a base-image bug, not host-specific). Pin to
  `node:20.18-alpine3.20` fixes it. Do NOT change the base image without
  verifying a full build + deploy works.
- Telegram Bot: separate VPS
- VPN servers: separate VPS instances

