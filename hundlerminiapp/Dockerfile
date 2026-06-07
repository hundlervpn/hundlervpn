# Multi-stage Dockerfile for HundlerVPN.
# Final runner image is ~180 MB (vs 1 GB for the single-stage variant) —
# we suspect Hostman's silent "Build failed" on `exporting to image` is
# triggered by overly large images, since the single-stage variant
# (commit 9e1caa4) took 93.9 s to export layers and still failed at
# the manifest commit step with no error message.
#
# Build-cache bust: 2026-05-08T20:45 — NEW Hostman regression.
# v59 build (676bf37, tiny route.ts diff vs v58 which deployed fine)
# fails on FINAL `exporting to image` step AFTER all sub-steps succeed:
#   #17 exporting layers 3.4s done
#   #17 exporting manifest sha256:e1771b2e... done
#   #17 exporting config sha256:7396db31... done
#   #17 pushing layers 30.0s done
#   ------
#    > exporting to image:
#   ------
#   Build failed
# So manifest is committed, config is committed, layers are pushed —
# yet Hostman reports build failed. No error message in the log. This
# is a DIFFERENT failure mode from the documented `node:20-alpine`
# regression (that was "manifest never completes" — here manifest IS
# committed). Possible causes: (a) Hostman registry storage quota hit,
# (b) BuildKit worker crashed after push, (c) post-push verification
# step in Hostman's deploy pipeline timed out.
#
# Mitigation strategy: bump cache-bust ARG to invalidate the deps-5/5
# layer hash, force the BuildKit worker to redo the build from scratch.
# This has worked for the previous 4 occurrences of related stale-layer
# bugs and may also unstick whatever post-push state is bad.
#
# Older context: 2026-05-08T18:50 hang was during `npm ci` itself
# (FOURTH occurrence: 2026-05-06, 2026-05-07, 2026-05-08-am,
# 2026-05-08-pm). package.json / package-lock.json have NOT changed
# between any of those incidents → recurring BuildKit / Hostman issue.
#
# Mitigations applied this time:
# - Bump cache-bust ARG → invalidates the cached deps-5/5 layer (same
#   trick that has worked the previous 3 times).
# - Add explicit npm fetch-retries (--fetch-retries=5,
#   --fetch-retry-mintimeout=10000, --fetch-retry-maxtimeout=60000) so
#   if the hang IS network-flakiness related, npm will retry instead
#   of hanging the BuildKit step indefinitely.
# - Drop --prefer-offline. On Hostman's worker the cache directory
#   may be persisted between builds and corrupting npm's offline
#   resolution pathway; force network-first behaviour for predictability.
#
# If this happens a FIFTH time, escalate:
#   (a) pin a prebuilt node_modules tarball and skip `npm ci` in-Docker,
#   (b) switch Hostman instance to a larger worker (current may be
#       memory-constrained — npm ci is RAM-heavy on large lockfiles),
#   (c) move to a pnpm-based install (content-addressable store, much
#       lower BuildKit pressure than npm's full-extract semantics).

# Pinned to a specific Alpine 3.20 + Node 20.18 release to isolate the
# variable "Docker Hub updated node:20-alpine to a broken digest". The
# previously failing builds were pulling the moving `node:20-alpine` tag
# (digest fb4cd12c85...). If that digest has a regression that breaks
# Hostman's image export, this pin avoids it.

# ---- 1. Install deps ----
FROM node:20.18-alpine3.20 AS deps
# Cache-bust token: bumping this ARG value changes the BuildKit layer hash
# for every RUN below, forcing a fresh `npm ci` even if Hostman's worker
# has a stuck / corrupted cached layer. Bump the date on every recurrence
# of the "npm ci hangs on glob@10.5.0 deprecation" symptom.
ARG DEPS_CACHE_BUST=2026-05-08T20:45
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
# --no-audit --no-fund: skip the post-install calls npm makes to npmjs.org
# for vulnerability reports and funding messages. These are optional but
# have been observed to hang indefinitely on Hostman workers when their
# egress DNS is flaky (2026-05-06 + 2026-05-07 incidents both froze right
# around this RUN step's output). Skipping them makes `npm ci` depend
# purely on the package tarball downloads, which have retry/timeout logic
# and have never been observed to hang on their own.
# --loglevel=error: suppress the flood of `npm warn deprecated ...` lines
# that repeatedly triggered Hostman's log-size limit in prior hangs; the
# warnings themselves aren't actionable (they're for 3rd-party transitive
# deps) and they appear to correlate with the hang point in Hostman logs.
# --fetch-retries=5 + --fetch-retry-{min,max}timeout: if a tarball
# download stalls (the 2026-05-08-pm hang fingerprint — npm goes silent
# right after the cache-bust echo, never emits any download progress),
# npm will retry up to 5 times with backoff between 10 s and 60 s. Without
# these flags, npm waits forever on a stalled socket → BuildKit step never
# exits → Hostman times out the whole build. With retries, even a partial
# network blip on Hostman's worker recovers gracefully.
#
# --prefer-offline INTENTIONALLY OMITTED: removed in 2026-05-08-pm because
# the persistent cache on Hostman's worker may be corrupting npm's offline
# resolution path (each successive build triggers identical hang ↔ symptom
# of stale-cache poisoning). Forcing network-first is slightly slower but
# deterministic.
RUN echo "[deps] cache-bust=${DEPS_CACHE_BUST}" && \
    npm ci --legacy-peer-deps --no-audit --no-fund --loglevel=error \
        --fetch-retries=5 \
        --fetch-retry-mintimeout=10000 \
        --fetch-retry-maxtimeout=60000

# ---- 2. Build (next build + standalone assembly) ----
FROM node:20.18-alpine3.20 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN echo '=== START next build ===' && npm run build && echo '=== END next build ==='

# Standalone server.js needs .next/static and public/ inside its own dir.
RUN cp -r .next/static .next/standalone/.next/ && \
    cp -r public .next/standalone/public

# Sanity-check the standalone layout BEFORE we package it. If anything is
# missing, fail the build with a clear error visible in Hostman build logs.
RUN echo '=== Standalone layout ===' && \
    ls -la .next/standalone/ && \
    test -f .next/standalone/server.js && \
    test -d .next/standalone/.next/static && \
    test -d .next/standalone/public && \
    echo '=== Standalone OK ==='

# ---- 3. Runner (the only stage Hostman actually pushes) ----
FROM node:20.18-alpine3.20 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone bundle includes server.js, minimal node_modules, .next/static,
# and public/ — nothing else needed.
COPY --from=builder /app/.next/standalone ./

EXPOSE 3000

# Verbose startup so Hostman application logs show *something* — if the
# container dies silently, at least we'll see how far it got.
CMD ["sh", "-c", "echo '[boot] container starting' && echo \"[boot] node=$(node --version)\" && echo \"[boot] PORT=$PORT NODE_ENV=$NODE_ENV HOSTNAME=$HOSTNAME\" && echo '[boot] launching standalone server' && exec node server.js"]
