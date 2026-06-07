#!/bin/bash
# One-liner installer for xray-sync on VPN servers
# Usage: curl -sL YOUR_URL/install-xray-sync.sh | bash -s -- \
#   --url "https://your-app.com" \
#   --token "server-sync-token" \
#   --key "PRIVATE_KEY" \
#   --short-id "abc123" \
#   [--sni "www.microsoft.com"] \
#   [--target "www.microsoft.com:443"] \
#   [--port 443]

set -euo pipefail

APP_URL=""
SYNC_TOKEN=""
PRIVATE_KEY=""
SHORT_ID=""
SNI="www.microsoft.com"
TARGET="www.microsoft.com:443"
LISTEN_PORT="443"

while [[ $# -gt 0 ]]; do
  case $1 in
    --url) APP_URL="$2"; shift 2 ;;
    --token) SYNC_TOKEN="$2"; shift 2 ;;
    --key) PRIVATE_KEY="$2"; shift 2 ;;
    --short-id) SHORT_ID="$2"; shift 2 ;;
    --sni) SNI="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --port) LISTEN_PORT="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$APP_URL" ] || [ -z "$SYNC_TOKEN" ] || [ -z "$PRIVATE_KEY" ] || [ -z "$SHORT_ID" ]; then
  echo "ERROR: Missing required parameters"
  echo "Required: --url, --token, --key, --short-id"
  exit 1
fi

echo "Installing xray-sync..."

# Create env file
cat > /opt/xray-sync.env <<EOF
APP_URL="${APP_URL}"
SYNC_TOKEN="${SYNC_TOKEN}"
PRIVATE_KEY="${PRIVATE_KEY}"
SHORT_ID="${SHORT_ID}"
SNI="${SNI}"
TARGET="${TARGET}"
LISTEN_PORT="${LISTEN_PORT}"
EOF
chmod 600 /opt/xray-sync.env

# Download sync script
SCRIPT_URL="${APP_URL}/xray-sync.sh"
curl -sf "$SCRIPT_URL" -o /opt/xray-sync.sh 2>/dev/null || {
  # Fallback: embed script directly
  cat > /opt/xray-sync.sh <<'SCRIPT'
#!/bin/bash
set -euo pipefail

XRAY_CONFIG="/usr/local/etc/xray/config.json"
ENV_FILE="/opt/xray-sync.env"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

if [ -z "${APP_URL:-}" ] || [ -z "${SYNC_TOKEN:-}" ] || [ -z "${PRIVATE_KEY:-}" ] || [ -z "${SHORT_ID:-}" ]; then
  echo "[$(date)] ERROR: Missing env vars"; exit 1
fi

RESPONSE=$(curl -sf --max-time 15 "${APP_URL}/api/xray/clients?token=${SYNC_TOKEN}" 2>/dev/null) || {
  echo "[$(date)] ERROR: API fetch failed"; exit 1
}

[ "$(echo "$RESPONSE" | jq -r '.ok')" = "true" ] || { echo "[$(date)] ERROR: API error"; exit 1; }

CLIENTS=$(echo "$RESPONSE" | jq -c '[.clients[] | {id: .id, flow: .flow, email: .email}]')
CLIENT_COUNT=$(echo "$CLIENTS" | jq 'length')
[ "$CLIENT_COUNT" -eq 0 ] && exit 0

TARGET="${TARGET:-www.microsoft.com:443}"
SNI="${SNI:-www.microsoft.com}"
LISTEN_PORT="${LISTEN_PORT:-443}"

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
  "inbounds": [{
    "listen": "0.0.0.0",
    "port": ${LISTEN_PORT},
    "protocol": "vless",
    "settings": { "clients": ${CLIENTS}, "decryption": "none" },
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
    "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
  }],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct", "settings": { "domainStrategy": "ForceIPv4" } },
    { "protocol": "blackhole", "tag": "block" }
  ]
}
CONF
)

CURRENT=$(jq -c '[.inbounds[0].settings.clients[] | {id, flow, email}]' "$XRAY_CONFIG" 2>/dev/null || echo "[]")
[ "$CLIENTS" = "$CURRENT" ] && exit 0

TMP="${XRAY_CONFIG}.tmp"
echo "$NEW_CONFIG" | jq . > "$TMP"

if /usr/local/bin/xray -test -config "$TMP" >/dev/null 2>&1; then
  mv "$TMP" "$XRAY_CONFIG"
  systemctl restart xray
  echo "[$(date)] OK: ${CLIENT_COUNT} clients"
else
  rm -f "$TMP"
  echo "[$(date)] ERROR: Config validation failed"; exit 1
fi
SCRIPT
}
chmod +x /opt/xray-sync.sh

# Setup cron (every minute)
CRON_LINE="* * * * * /opt/xray-sync.sh >> /var/log/xray-sync.log 2>&1"
(crontab -l 2>/dev/null | grep -v 'xray-sync.sh'; echo "$CRON_LINE") | crontab -

# Create log file
touch /var/log/xray-sync.log

# Run first sync
echo "Running initial sync..."
/opt/xray-sync.sh && echo "SUCCESS: xray-sync installed and running" || echo "WARNING: First sync failed, check /var/log/xray-sync.log"

echo ""
echo "Done! Sync runs every minute."
echo "Logs: /var/log/xray-sync.log"
echo "Config: /opt/xray-sync.env"
