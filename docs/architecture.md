## Tech Stack
- Frontend + API: Next.js (App Router), React, TypeScript, TailwindCSS
- DB: PostgreSQL **on Hostman managed PG** (host: `132.243.242.196`, user: `gen_user`, db: `default_db`, sslmode=require). **v68 (2026-05-17) migration**: moved off Timeweb (`5.42.118.215`) due to GeoIP filtering and ongoing reliability issues. The old IP is dead — do not connect to it. All scripts and bot fallbacks already point to the new IP. Real credentials live in Hostman env vars; never paste them into committed files.
- Web hosting: **Hostman** (env vars managed in Hostman Dashboard).
  Deploy is Dockerfile-based — `Dockerfile` at the repo root uses
  Next.js `output: 'standalone'`, builds in 3 stages (deps → builder →
  runner), final image ~180 MB, runs `node server.js`. Build/Start
  command fields in Hostman dashboard must be left **empty** (Hostman
  picks up the Dockerfile automatically; filling them in overrides
  CMD and breaks the deploy).
  ⚠️ **CRITICAL**: base image is pinned to `node:20.18-alpine3.20`,
  NOT the moving `node:20-alpine` tag. The latest `node:20-alpine`
  (digest `fb4cd12c85...`) has a regression that causes Hostman's
  BuildKit/registry to silently fail on `> exporting to image:` with
  no error message — `pushing layers` succeeds but `exporting manifest`
  never completes. Symptom is `Build failed` with no log line between
  `> exporting to image:` and the failure. Pin to `node:20.18-alpine3.20`
  fixes it (verified 2026-04-28). Do NOT change the base image without
  verifying the deploy works.
- Telegram Bot: separate VPS
- VPN servers: separate VPS instances

