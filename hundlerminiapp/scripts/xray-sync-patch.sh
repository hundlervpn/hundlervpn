#!/bin/bash
# Idempotent Xray client sync (patch-only).
#
# Fetches active client UUIDs from HundlerVPN API and updates ONLY the
# clients[] array inside the VLESS inbound. All other Xray config
# (outbounds, routing, WARP SOCKS5, DNS, etc.) is preserved as-is.
#
# Performs a diff-check: if the clients list is unchanged, Xray is NOT
# restarted, so active VPN connections are not dropped.
#
# Usage:
#   bash /opt/xray-sync.sh
#
# Cron (every 1 minute — safe because of diff-check):
#   */1 * * * * /opt/xray-sync.sh >> /var/log/xray-sync.log 2>&1

set -euo pipefail

API_URL="https://hundlervpn.xyz/api/xray/clients?token=hVpN2026sEcReT_xR4y"
XRAY_CONFIG="/usr/local/etc/xray/config.json"
# 2026-05-09 (XUDP migration, v60): placeholder client now has NO flow.
# Vision is incompatible with XUDP — clients connect with `flow=""` (empty)
# so the inbound's clients[] array must list users without flow set. Setting
# flow=xtls-rprx-vision on even one client locks the whole inbound to TCP.
PLACEHOLDER='{"id":"00000000-0000-0000-0000-000000000000","email":"placeholder"}'

# ── Fetch clients from API ────────────────────────────────────
RESPONSE=$(curl -sf --max-time 15 "$API_URL" 2>/dev/null) || {
  echo "[$(date)] ERROR: API fetch failed"
  exit 1
}

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" != "true" ]; then
  echo "[$(date)] ERROR: API returned ok=false"
  exit 1
fi

# Extract {id, flow, email} for each client, or use placeholder if empty.
NEW_CLIENTS=$(echo "$RESPONSE" | jq -c "
  [.clients[] | {id: .id, flow: .flow, email: .email}]
  | if length > 0 then . else [${PLACEHOLDER}] end
")

CLIENT_COUNT=$(echo "$NEW_CLIENTS" | jq 'length')

# ── Diff check: skip restart if unchanged ──────────────────────
# Sort both arrays by id for stable comparison.
NEW_SORTED=$(echo "$NEW_CLIENTS" | jq -c 'sort_by(.id)')
CURRENT_SORTED=$(jq -c '.inbounds[0].settings.clients | sort_by(.id)' "$XRAY_CONFIG" 2>/dev/null || echo "[]")

if [ "$NEW_SORTED" = "$CURRENT_SORTED" ]; then
  echo "[$(date)] No changes ($CLIENT_COUNT clients)"
  exit 0
fi

# ── Patch config (only clients[]) ──────────────────────────────
TMP_CONFIG="${XRAY_CONFIG}.tmp.json"

jq --argjson clients "$NEW_CLIENTS" '
  .inbounds[0].settings.clients = $clients
' "$XRAY_CONFIG" > "$TMP_CONFIG"

# Validate JSON
if ! jq empty "$TMP_CONFIG" 2>/dev/null; then
  echo "[$(date)] ERROR: Generated invalid JSON"
  rm -f "$TMP_CONFIG"
  exit 1
fi

# Validate with Xray (refuses duplicate emails, bad flow, etc.)
if ! VALIDATION=$(/usr/local/bin/xray -test -config "$TMP_CONFIG" 2>&1); then
  echo "[$(date)] ERROR: Xray config validation failed:"
  echo "$VALIDATION"
  cp "$TMP_CONFIG" "${XRAY_CONFIG}.failed.json"
  rm -f "$TMP_CONFIG"
  exit 1
fi

# Apply
mv "$TMP_CONFIG" "$XRAY_CONFIG"
systemctl restart xray 2>/dev/null || true

echo "[$(date)] Applied: $CLIENT_COUNT clients"
