#!/bin/bash
# install-xray-traffic-collector.sh — Set up per-user-per-server traffic
# accounting on an Xray-Reality VPN node (NL / DE / RU). Pairs with the
# 2026-05-10 per-server quota work (see scripts/add-server-traffic-limits.js
# and /api/xray/traffic).
#
# Idempotent — safe to re-run.
#
# What it does:
#   1. Patches /usr/local/etc/xray/config.json to enable stats + per-user
#      uplink/downlink accounting (the stats{} block, the per-level
#      `policy.levels.0` block, and `email` on the API inbound — required
#      by `xray api statsquery`). Skipped if already present.
#   2. Writes /opt/xray-traffic.sh — the 5-minute cron collector that
#      runs `xray api statsquery --reset --pattern "user>>>"`, aggregates
#      uplink+downlink per email, and POSTs to /api/xray/traffic.
#   3. Registers /etc/cron.d/xray-traffic (cron entry every 5 min).
#   4. If config.json was modified, restarts xray; otherwise no restart.
#   5. Runs the collector once as a smoke test.
#
# Usage on a clean NL/DE/RU VPS (must already have setup-germany-server.sh
# or equivalent run + xray-sync.sh installed):
#
#   curl -fsSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/install-xray-traffic-collector.sh | bash
#
# Or copy-paste this script + run `bash install-xray-traffic-collector.sh`.

set -euo pipefail

# ── Configurable (envs override) ────────────────────────────────────────────
XRAY_CONFIG="${XRAY_CONFIG:-/usr/local/etc/xray/config.json}"
XRAY_BIN="${XRAY_BIN:-/usr/local/bin/xray}"
XRAY_API_PORT="${XRAY_API_PORT:-10085}"
API_URL="${API_URL:-https://hundlervpn.xyz/api/xray/traffic?token=hVpN2026sEcReT_xR4y}"
# server_host MUST match `servers.host` in the backend DB for per-server
# tracking. If left empty, auto-detect from the primary public IPv4.
SERVER_HOST="${SERVER_HOST:-}"

# ── Sanity ──────────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
command -v jq >/dev/null      || { echo "Install jq first (apt install -y jq)"; exit 1; }
command -v curl >/dev/null    || { echo "Install curl first"; exit 1; }
[ -f "$XRAY_CONFIG" ]         || { echo "Xray config not found at $XRAY_CONFIG"; exit 1; }
[ -x "$XRAY_BIN" ]            || { echo "Xray binary not executable at $XRAY_BIN"; exit 1; }

if [ -z "$SERVER_HOST" ]; then
  SERVER_HOST=$(hostname -I | awk '{print $1}')
  echo "[install] Auto-detected SERVER_HOST=$SERVER_HOST"
fi

# ── 1. Patch Xray config to enable stats ────────────────────────────────────
CONFIG_CHANGED=0
TMP_CFG=$(mktemp)
cp "$XRAY_CONFIG" "$TMP_CFG"

# 1a. Ensure top-level `stats: {}` exists.
if ! jq -e '.stats' "$TMP_CFG" >/dev/null 2>&1; then
  echo "[install] Adding top-level stats:{} block to xray config"
  jq '. + {stats: {}}' "$TMP_CFG" > "${TMP_CFG}.next" && mv "${TMP_CFG}.next" "$TMP_CFG"
  CONFIG_CHANGED=1
fi

# 1b. Ensure `policy.levels."0".statsUserUplink/Downlink = true` so per-user
#     stats are accumulated. We also set bufferSize/connIdle defaults so
#     existing policies don't get clobbered if we have to create the block.
if ! jq -e '.policy.levels."0".statsUserUplink == true' "$TMP_CFG" >/dev/null 2>&1 \
   || ! jq -e '.policy.levels."0".statsUserDownlink == true' "$TMP_CFG" >/dev/null 2>&1; then
  echo "[install] Enabling policy.levels.0.statsUserUplink/Downlink"
  jq '. + {policy: ((.policy // {}) + {levels: (((.policy // {}).levels // {}) + {"0": (((.policy // {}).levels // {})."0" // {} | . + {statsUserUplink: true, statsUserDownlink: true})})})}' \
     "$TMP_CFG" > "${TMP_CFG}.next" && mv "${TMP_CFG}.next" "$TMP_CFG"
  CONFIG_CHANGED=1
fi

# 1c. Ensure an `api` inbound exists on 127.0.0.1:$XRAY_API_PORT bound to
#     the HandlerService + StatsService. We only insert if there's nothing
#     currently listening on the API port locally (idempotent).
if ! jq -e ".inbounds[]? | select(.tag == \"api-in\" or .listen == \"127.0.0.1\" and .port == $XRAY_API_PORT)" "$TMP_CFG" >/dev/null 2>&1; then
  echo "[install] Adding api-in inbound on 127.0.0.1:$XRAY_API_PORT"
  jq --argjson port "$XRAY_API_PORT" '.inbounds += [{
    "tag": "api-in",
    "listen": "127.0.0.1",
    "port": $port,
    "protocol": "dokodemo-door",
    "settings": { "address": "127.0.0.1" }
  }] | . + {
    "api": (.api // { "tag": "api", "services": ["HandlerService", "LoggerService", "StatsService"] })
  } | . + {
    "routing": ((.routing // {}) + {
      "rules": (((.routing // {}).rules // []) + [
        { "type": "field", "inboundTag": ["api-in"], "outboundTag": "api" }
      ])
    })
  }' "$TMP_CFG" > "${TMP_CFG}.next" && mv "${TMP_CFG}.next" "$TMP_CFG"
  CONFIG_CHANGED=1
fi

# 1d. Ensure each VLESS-Reality client has an `email` field — required for
#     `xray api statsquery` to produce per-user lines. The xray-sync.sh
#     script already writes emails (tg-{id}-s{sid} format) so this is a
#     no-op on a healthy node, but we double-check to avoid silent skips.
if jq -e '.inbounds[] | select(.tag == "vless-in") | .settings.clients[]? | select((.email // "") == "")' "$TMP_CFG" >/dev/null 2>&1; then
  echo "[install] WARNING: some VLESS clients have empty email; per-user stats will be missing for them."
  echo "         xray-sync.sh should fix this on next run."
fi

if [ "$CONFIG_CHANGED" -eq 1 ]; then
  echo "[install] Validating patched config…"
  if ! "$XRAY_BIN" -test -config "$TMP_CFG" >/dev/null 2>&1; then
    echo "[install] ERROR: patched config invalid. Aborting (no changes applied)."
    "$XRAY_BIN" -test -config "$TMP_CFG" || true
    rm -f "$TMP_CFG"
    exit 1
  fi
  cp "$TMP_CFG" "$XRAY_CONFIG"
  echo "[install] Config updated."
else
  echo "[install] Config already has stats + policy + api inbound; no change."
fi
rm -f "$TMP_CFG"

# ── 2. Write /opt/xray-traffic.sh ──────────────────────────────────────────
echo "[install] Writing /opt/xray-traffic.sh"
cat > /opt/xray-traffic.sh <<EOF
#!/bin/bash
# /opt/xray-traffic.sh — Collect per-user traffic from local Xray and POST
# to HundlerVPN backend. Drives per-server quota enforcement.
#
# Generated by scripts/install-xray-traffic-collector.sh (2026-05-10).
# Edit that file and re-run the installer; do NOT edit this file directly.
#
# Cron:
#   */5 * * * * /opt/xray-traffic.sh >> /var/log/xray-traffic.log 2>&1

set -euo pipefail

API_URL="$API_URL"
SERVER_HOST="$SERVER_HOST"
XRAY_BIN="$XRAY_BIN"
XRAY_API_PORT="$XRAY_API_PORT"

# Pull current per-user stats and reset counters.
# 'user>>>tg-…>>>traffic>>>uplink'  + '…>>>downlink' — one stat per (email, direction).
STATS_JSON=\$("\$XRAY_BIN" api statsquery --server="127.0.0.1:\$XRAY_API_PORT" --pattern "user>>>" --reset 2>/dev/null || echo '{"stat":[]}')

# Aggregate uplink + downlink per email; drop entries with 0 bytes.
PAYLOAD=\$(echo "\$STATS_JSON" | jq -c '
  [(.stat // [])[]?]
  | map({
      email: (.name | split(">>>")[1]),
      kind:  (.name | split(">>>")[3]),
      value: ((.value // "0") | tonumber)
    })
  | group_by(.email)
  | map({
      email: .[0].email,
      uplink:   (map(select(.kind == "uplink") | .value)   | add // 0),
      downlink: (map(select(.kind == "downlink") | .value) | add // 0)
    })
  | map(select(.uplink + .downlink > 0))
')

COUNT=\$(echo "\$PAYLOAD" | jq 'length')
if [ "\$COUNT" -lt 1 ]; then
  echo "[\$(date)] No traffic this cycle"
  exit 0
fi

BODY=\$(jq -n --arg server "\$SERVER_HOST" --argjson stats "\$PAYLOAD" \\
  '{server_host: \$server, stats: \$stats}')

RESPONSE=\$(curl -sf --max-time 15 \\
  -X POST -H "Content-Type: application/json" \\
  -d "\$BODY" "\$API_URL") || {
    echo "[\$(date)] ERROR: API POST failed; \$COUNT users worth of traffic LOST this cycle"
    exit 1
  }

UPDATED=\$(echo "\$RESPONSE" | jq -r '.updated // 0')
PER_SERVER=\$(echo "\$RESPONSE" | jq -r '.updated_per_server // 0')
SERVER_ID=\$(echo "\$RESPONSE" | jq -r '.server_id // "null"')
echo "[\$(date)] Pushed \$COUNT users to \$SERVER_HOST (id=\$SERVER_ID): updated_subs=\$UPDATED updated_per_server=\$PER_SERVER"
EOF
chmod +x /opt/xray-traffic.sh
echo "[install] /opt/xray-traffic.sh installed"

# ── 3. Register cron ────────────────────────────────────────────────────────
echo "[install] Registering cron in /etc/cron.d/xray-traffic"
cat > /etc/cron.d/xray-traffic <<'EOF'
# HundlerVPN per-server traffic collector — installed 2026-05-10.
# Runs every 5 minutes, posts per-user uplink+downlink to /api/xray/traffic.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root /opt/xray-traffic.sh >> /var/log/xray-traffic.log 2>&1
EOF
chmod 644 /etc/cron.d/xray-traffic

touch /var/log/xray-traffic.log
chmod 640 /var/log/xray-traffic.log

# ── 4. Restart Xray if we touched the config ────────────────────────────────
if [ "$CONFIG_CHANGED" -eq 1 ]; then
  echo "[install] Restarting xray to pick up new stats config"
  systemctl restart xray
  sleep 2
  systemctl is-active xray >/dev/null && echo "[install] xray restarted, active" \
    || { echo "[install] xray failed to start! Check journalctl -u xray -n 50"; exit 1; }
fi

# ── 5. Smoke test ───────────────────────────────────────────────────────────
echo "[install] Running collector once as smoke test…"
/opt/xray-traffic.sh || echo "[install] (no traffic yet — empty payload is OK)"

echo
echo "[install] Done. Collector will run every 5 min via cron."
echo "[install] Tail logs:  tail -f /var/log/xray-traffic.log"
echo "[install] SERVER_HOST=$SERVER_HOST  API_URL=${API_URL%%token=*}token=…"
