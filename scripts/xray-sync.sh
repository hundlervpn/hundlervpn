#!/bin/bash
# xray-sync.sh — Pulls active client UUIDs from HundlerVPN API
# and updates the local Xray config, then reloads Xray.
#
# Usage:
#   bash /opt/xray-sync.sh
#
# Cron (every 2 minutes):
#   */2 * * * * /opt/xray-sync.sh >> /var/log/xray-sync.log 2>&1

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────
APP_URL="${APP_URL:-}"
SYNC_TOKEN="${SYNC_TOKEN:-}"
XRAY_CONFIG="/usr/local/etc/xray/config.json"
PRIVATE_KEY="${PRIVATE_KEY:-}"
TARGET="${TARGET:-www.microsoft.com:443}"
SNI="${SNI:-www.microsoft.com}"
SHORT_ID="${SHORT_ID:-}"
LISTEN_PORT="${LISTEN_PORT:-443}"

# Load from env file if present
ENV_FILE="/opt/xray-sync.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

# Validate required vars
if [ -z "$APP_URL" ] || [ -z "$SYNC_TOKEN" ] || [ -z "$PRIVATE_KEY" ] || [ -z "$SHORT_ID" ]; then
  echo "[$(date)] ERROR: Missing required env vars. Check $ENV_FILE"
  exit 1
fi

# ── Fetch active clients ──────────────────────────────────────
RESPONSE=$(curl -sf --max-time 15 \
  "${APP_URL}/api/xray/clients?token=${SYNC_TOKEN}" 2>/dev/null) || {
  echo "[$(date)] ERROR: Failed to fetch clients from API"
  exit 1
}

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" != "true" ]; then
  echo "[$(date)] ERROR: API returned ok=false"
  exit 1
fi

# Build clients JSON array
CLIENTS=$(echo "$RESPONSE" | jq -c '[.clients[] | {id: .id, flow: .flow, email: .email}]')
CLIENT_COUNT=$(echo "$CLIENTS" | jq 'length')

if [ "$CLIENT_COUNT" -eq 0 ]; then
  echo "[$(date)] WARN: No active clients, keeping config unchanged"
  exit 0
fi

# ── Generate new config ───────────────────────────────────────
NEW_CONFIG=$(cat <<CONF
{
  "log": { "loglevel": "warning" },
  "dns": {
    "servers": [
      { "address": "8.8.8.8", "domains": ["geosite:geolocation-!cn"] },
      { "address": "1.1.1.1", "domains": ["geosite:geolocation-!cn"] },
      "localhost"
    ],
    "queryStrategy": "UseIPv4"
  },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": ${LISTEN_PORT},
      "protocol": "vless",
      "settings": {
        "clients": ${CLIENTS},
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "dest": "${TARGET}",
          "serverNames": ["${SNI}"],
          "privateKey": "${PRIVATE_KEY}",
          "shortIds": ["${SHORT_ID}"]
        }
      },
      "sniffing": {
        "enabled": true,
        "destOverride": ["http", "tls", "quic"]
      }
    }
  ],
  "outbounds": [
    {
      "protocol": "freedom",
      "tag": "direct",
      "settings": { "domainStrategy": "ForceIPv4" }
    },
    { "protocol": "blackhole", "tag": "block" }
  ]
}
CONF
)

# Validate JSON
echo "$NEW_CONFIG" | jq . > /dev/null 2>&1 || {
  echo "[$(date)] ERROR: Generated invalid JSON"
  exit 1
}

# Compare with current config (skip update if unchanged)
CURRENT_CLIENTS=$(jq -c '[.inbounds[0].settings.clients[] | {id, flow, email}]' "$XRAY_CONFIG" 2>/dev/null || echo "[]")
if [ "$CLIENTS" = "$CURRENT_CLIENTS" ]; then
  exit 0
fi

# ── Apply ─────────────────────────────────────────────────────
echo "$NEW_CONFIG" | jq . > "${XRAY_CONFIG}.tmp"

# Test config before applying
if VALIDATION_OUTPUT=$(/usr/local/bin/xray -test -config "${XRAY_CONFIG}.tmp" 2>&1); then
  mv "${XRAY_CONFIG}.tmp" "$XRAY_CONFIG"
  systemctl restart xray
  echo "[$(date)] OK: Updated Xray config with ${CLIENT_COUNT} clients"
else
  echo "$VALIDATION_OUTPUT"
  cp "${XRAY_CONFIG}.tmp" "${XRAY_CONFIG}.failed"
  rm -f "${XRAY_CONFIG}.tmp"
  echo "[$(date)] ERROR: New config failed validation, keeping old config"
  exit 1
fi
