#!/bin/bash
# xray-sync.sh — Pulls active client UUIDs from HundlerVPN API
# and patches ONLY the clients array in the existing Xray config.
# Restarts Xray only when the client list actually changes.
#
# SAFE: never overwrites API inbound, WARP routing, or other config sections.
#
# Usage:
#   bash /opt/xray-sync.sh
#
# Cron (every 5 minutes):
#   */5 * * * * /opt/xray-sync.sh >> /var/log/xray-sync.log 2>&1
#
# Also triggered on-demand via xray-webhook (port 9999) for instant sync.

set -euo pipefail

# SYNC_TOKEN подаётся через env или /opt/.sync-token (НЕ хранится в git).
SYNC_TOKEN="${SYNC_TOKEN:-$(cat /opt/.sync-token 2>/dev/null || true)}"

API_URL="https://hundlervpn.xyz/api/xray/clients?token=${SYNC_TOKEN}"
XRAY_CONFIG="/usr/local/etc/xray/config.json"
INBOUND_TAG="vless-in"

RESPONSE=$(curl -sf --max-time 15 "$API_URL") || { echo "[$(date)] ERROR: API fetch failed"; exit 1; }
OK=$(echo "$RESPONSE" | jq -r '.ok // false')
[ "$OK" = "true" ] || { echo "[$(date)] ERROR: API returned ok=false"; exit 1; }

NEW_CLIENTS=$(echo "$RESPONSE" | jq -c '[.clients[] | {id, flow, email}]')
NEW_COUNT=$(echo "$NEW_CLIENTS" | jq 'length')

# Get current clients from config
OLD_CLIENTS=$(jq -c '[.inbounds[] | select(.tag=="'"$INBOUND_TAG"'") | .settings.clients[] | {id, flow, email}]' "$XRAY_CONFIG" 2>/dev/null || echo '[]')
OLD_COUNT=$(echo "$OLD_CLIENTS" | jq 'length')

# ── SANITY GUARD ────────────────────────────────────────────────────────────
# Refuse to apply a snapshot that would wipe most of the existing client
# list. The UUID pool is intentionally over-provisioned (~1000 entries
# steady-state), so any response with 0 clients or a sudden >50 % drop is
# almost always a transient backend hiccup, NOT a legitimate bulk
# expiration. Without this guard, a single bad response from /api/xray/clients
# applied across all three VPN nodes during their next 5-min cron tick has
# been observed (incident 2026-05-07 ~21:15 MSK) to simultaneously flush
# Xray's accepted-clients list on NL+DE+RU, leaving every active user with
# "no ping, no traffic" until the next cron tick recovered. Recovery
# self-healed in ~5 min, but the user-visible outage was disruptive enough
# to be reported. Prevention is far cheaper than the recovery window.
#
# Threshold rationale:
#   * Hard floor of 1: never apply a literally empty list. Even a brand
#     new VPS provisioned with a fresh pool has >0 entries.
#   * 50 % drop guard: only kicks in once the box has seen at least 100
#     clients (so first-deploy / fresh-VPS bootstrap with very small
#     OLD_COUNT still works). After that, any response that drops more
#     than half the clients vs the running config is rejected — a real
#     bulk expiration would never come close to 50 % since the pool
#     keeps placeholder UUIDs around even for inactive users.
#
# This is a downstream defence; the upstream API endpoint should ALSO
# be hardened (e.g. abort with HTTP 503 if pool is unexpectedly small)
# but having both is correct: defence in depth.
if [ "$NEW_COUNT" -lt 1 ]; then
  echo "[$(date)] SANITY: API returned 0 clients (was $OLD_COUNT). Refusing to wipe Xray. NOT applying."
  exit 1
fi
if [ "$OLD_COUNT" -gt 100 ] && [ "$NEW_COUNT" -lt $((OLD_COUNT / 2)) ]; then
  echo "[$(date)] SANITY: API returned $NEW_COUNT clients, was $OLD_COUNT (>50 % drop). Refusing to apply suspicious snapshot."
  exit 1
fi
# ────────────────────────────────────────────────────────────────────────────

# Restart-relevant diff: ONLY uuid + flow.
#
# Email is re-labelled on every signup (`pool-N` -> `tg-{tid}-s{sid}`)
# for traffic accounting. Including email in the diff caused a full
# Xray restart after every signup / expiration, defeating the v35
# pool-based instant-connect architecture and dropping ALL TCP
# sessions (incl. ones tunneled through the YC bridge) every few
# minutes — visible to users as "Ping N/A" / unstable connection.
#
# We now restart ONLY when the actual UUID list changes (pool
# refill, orphan purge, key revocation). Label-only diffs are
# written to the config file silently and take effect at the next
# genuine restart.
OLD_KEYSET=$(echo "$OLD_CLIENTS" | jq -cS '.|sort_by(.id)|map({id, flow})')
NEW_KEYSET=$(echo "$NEW_CLIENTS" | jq -cS '.|sort_by(.id)|map({id, flow})')
OLD_FULL=$(echo "$OLD_CLIENTS" | jq -cS '.|sort_by(.id)')
NEW_FULL=$(echo "$NEW_CLIENTS" | jq -cS '.|sort_by(.id)')

if [ "$OLD_KEYSET" = "$NEW_KEYSET" ]; then
  if [ "$OLD_FULL" = "$NEW_FULL" ]; then
    echo "[$(date)] No changes ($NEW_COUNT clients)"
    exit 0
  fi

  # Labels changed only — update config silently, NO restart.
  # 2026-05-24: switched from `--argjson clients "$NEW_CLIENTS"` to
  # `--slurpfile` because once the UUID pool grows past ~1500 entries the
  # JSON payload (~250 KB) exceeds Linux ARG_MAX and jq aborts with
  # `Argument list too long`. --slurpfile pipes via FD instead of argv,
  # so size limit becomes "available disk" instead of ARG_MAX. The
  # outer `[0]` strips the array wrapper that --slurpfile adds.
  TMP="${XRAY_CONFIG}.tmp"
  jq --slurpfile clients <(printf '%s' "$NEW_CLIENTS") \
    '(.inbounds[] | select(.tag=="'"$INBOUND_TAG"'") | .settings.clients) = $clients[0]' \
    "$XRAY_CONFIG" > "$TMP"

  if ! /usr/local/bin/xray -test -config "$TMP" >/dev/null 2>&1; then
    echo "[$(date)] ERROR: relabelled config invalid, aborting (no restart)"
    rm -f "$TMP"
    exit 1
  fi

  mv "$TMP" "$XRAY_CONFIG"
  echo "[$(date)] Labels updated, no restart ($NEW_COUNT clients)"
  exit 0
fi

# Update ONLY the clients array in the matching inbound.
# See comment above (label-only branch) re: --slurpfile vs --argjson.
TMP="${XRAY_CONFIG}.tmp"
jq --slurpfile clients <(printf '%s' "$NEW_CLIENTS") \
  '(.inbounds[] | select(.tag=="'"$INBOUND_TAG"'") | .settings.clients) = $clients[0]' \
  "$XRAY_CONFIG" > "$TMP"

# Validate before applying
if ! /usr/local/bin/xray -test -config "$TMP" >/dev/null 2>&1; then
  echo "[$(date)] ERROR: new config invalid, aborting"
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$XRAY_CONFIG"
systemctl restart xray
echo "[$(date)] Restarted: clients changed ($NEW_COUNT clients, was $(echo "$OLD_CLIENTS" | jq 'length'))"