#!/bin/bash
# install-hy2-traffic-collector.sh — Per-user traffic accounting for Hy2.
#
# Hysteria2 — это отдельный демон рядом с Xray. У него СВОЙ trafficStats API
# на 127.0.0.1:7653 (включается блоком `trafficStats:` в /etc/hysteria/config.yaml).
# Этот скрипт:
#   1. Проверяет что блок trafficStats в Hy2 config есть. Если нет — добавляет
#      его + генерит /etc/hysteria/.traffic-secret + рестартует hysteria-server.
#   2. Ставит /opt/hy2-traffic.sh — collector. Раз в 5 мин:
#      - GET http://127.0.0.1:7653/traffic?clear=1 с Authorization: <secret>
#      - Парсит JSON map { "tg-<telegramId>": { "tx": N, "rx": N } }
#      - POSTит на /api/xray/traffic в формате {server_host, stats: [...]}
#      - Backend регэкспом /^tg-(\d+)(?:-|$)/ извлекает telegram_id и
#        UPSERT'ит в user_server_traffic вместе с VLESS-данными xray-traffic.sh
#   3. Ставит /etc/cron.d/hy2-traffic.
#   4. Запускает collector вручную для smoke-test.
#
# Идемпотентно. Безопасно прогонять повторно.
#
# Run on DE VPS (213.182.213.183):
#   curl -fsSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/install-hy2-traffic-collector.sh | bash
# или scp + bash.

set -euo pipefail

# ── Configurable ───────────────────────────────────────────────────────────
HY2_DIR="${HY2_DIR:-/etc/hysteria}"
HY2_CONFIG="${HY2_CONFIG:-${HY2_DIR}/config.yaml}"
HY2_TRAFFIC_PORT="${HY2_TRAFFIC_PORT:-7653}"
HY2_TRAFFIC_SECRET_FILE="${HY2_TRAFFIC_SECRET_FILE:-${HY2_DIR}/.traffic-secret}"
API_URL="${API_URL:-https://hundlervpn.xyz/api/xray/traffic?token=hVpN2026sEcReT_xR4y}"
SERVER_HOST="${SERVER_HOST:-}"

# ── Sanity ─────────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
command -v jq >/dev/null   || { apt update && apt install -y jq; }
command -v curl >/dev/null || { echo "Install curl first"; exit 1; }

if [ ! -f "$HY2_CONFIG" ]; then
  echo "ERROR: $HY2_CONFIG not found. Run setup-germany-hysteria2.sh first."
  exit 1
fi

if [ -z "$SERVER_HOST" ]; then
  SERVER_HOST=$(hostname -I | awk '{print $1}')
  echo "[hy2-traffic] Auto-detected SERVER_HOST=$SERVER_HOST"
fi

# ── 1. Ensure trafficStats block + secret ──────────────────────────────────
if [ ! -f "$HY2_TRAFFIC_SECRET_FILE" ]; then
  echo "[hy2-traffic] Generating new Hy2 trafficStats secret…"
  openssl rand -hex 16 > "$HY2_TRAFFIC_SECRET_FILE"
  chmod 600 "$HY2_TRAFFIC_SECRET_FILE"
fi
HY2_TRAFFIC_SECRET="$(cat "$HY2_TRAFFIC_SECRET_FILE")"

CONFIG_NEEDS_RESTART=0
if ! grep -q '^trafficStats:' "$HY2_CONFIG"; then
  echo "[hy2-traffic] Adding trafficStats block to $HY2_CONFIG…"
  cat >> "$HY2_CONFIG" <<EOF

# Added by install-hy2-traffic-collector.sh ($(date -u +%Y-%m-%d)).
# trafficStats API — слушает на 127.0.0.1, отдаёт per-user uplink/downlink.
# /opt/hy2-traffic.sh поллит этот endpoint каждые 5 мин и шлёт байты в
# /api/xray/traffic. Защищён shared secret в /etc/hysteria/.traffic-secret.
trafficStats:
  listen: 127.0.0.1:${HY2_TRAFFIC_PORT}
  secret: ${HY2_TRAFFIC_SECRET}
EOF
  CONFIG_NEEDS_RESTART=1
else
  echo "[hy2-traffic] trafficStats block already present in $HY2_CONFIG"
  # Sanity — secret в config совпадает с файлом?
  CONFIG_SECRET=$(grep -A 3 '^trafficStats:' "$HY2_CONFIG" | grep -E '^\s*secret:' | awk '{print $2}' | tr -d '"')
  if [ -n "$CONFIG_SECRET" ] && [ "$CONFIG_SECRET" != "$HY2_TRAFFIC_SECRET" ]; then
    echo "[hy2-traffic] WARN: secret in config differs from $HY2_TRAFFIC_SECRET_FILE"
    echo "[hy2-traffic]       Using config value for collector."
    HY2_TRAFFIC_SECRET="$CONFIG_SECRET"
    echo "$HY2_TRAFFIC_SECRET" > "$HY2_TRAFFIC_SECRET_FILE"
    chmod 600 "$HY2_TRAFFIC_SECRET_FILE"
  fi
fi

if [ "$CONFIG_NEEDS_RESTART" -eq 1 ]; then
  echo "[hy2-traffic] Restarting hysteria-server to load trafficStats…"
  systemctl restart hysteria-server
  sleep 2
  if ! systemctl is-active --quiet hysteria-server; then
    echo "[hy2-traffic] ERROR: hysteria-server did not come up. Check journalctl."
    exit 1
  fi
  echo "[hy2-traffic] hysteria-server restarted OK."
fi

# ── 2. Verify trafficStats API reachable ───────────────────────────────────
echo "[hy2-traffic] Probing trafficStats API on 127.0.0.1:${HY2_TRAFFIC_PORT}…"
PROBE_HTTP=$(curl -s -o /tmp/hy2probe.json -w '%{http_code}' \
  -H "Authorization: ${HY2_TRAFFIC_SECRET}" \
  "http://127.0.0.1:${HY2_TRAFFIC_PORT}/traffic" || echo '000')
if [ "$PROBE_HTTP" != '200' ]; then
  echo "[hy2-traffic] ERROR: API returned HTTP $PROBE_HTTP"
  echo "[hy2-traffic] Response: $(cat /tmp/hy2probe.json 2>/dev/null | head -c 500)"
  echo "[hy2-traffic] Check 'journalctl -u hysteria-server -n 30' to see what went wrong."
  exit 1
fi
echo "[hy2-traffic] API OK. Sample: $(cat /tmp/hy2probe.json | head -c 200)"
rm -f /tmp/hy2probe.json

# ── 3. Install /opt/hy2-traffic.sh ─────────────────────────────────────────
cat >/opt/hy2-traffic.sh <<HY2SCRIPT
#!/bin/bash
# /opt/hy2-traffic.sh — managed by install-hy2-traffic-collector.sh.
# Polls Hy2 trafficStats API, ships per-user bytes to backend.
set -euo pipefail

SECRET=\$(cat ${HY2_TRAFFIC_SECRET_FILE})
SERVER_HOST='${SERVER_HOST}'
API_URL='${API_URL}'
HY2_PORT='${HY2_TRAFFIC_PORT}'

# clear=1 → API возвращает дельту с прошлого чтения и обнуляет счётчик.
# Без clear=1 мы бы постоянно получали накопленную сумму и удваивали
# bytes_used при каждом push.
RAW=\$(curl -fsS --max-time 10 \\
  -H "Authorization: \${SECRET}" \\
  "http://127.0.0.1:\${HY2_PORT}/traffic?clear=1" || echo '{}')

# Pretty-print для логов: сколько юзеров было активны.
USER_COUNT=\$(echo "\$RAW" | jq 'length // 0')

if [ "\$USER_COUNT" -eq 0 ]; then
  echo "\$(date -u +%FT%TZ) Hy2: no active users this period"
  exit 0
fi

# Hy2 формат: { "tg-2029065770": { "tx": 12345, "rx": 67890 } }
# tx = bytes server SENT to user (user's downlink)
# rx = bytes server GOT from user (user's uplink)
# Convert to xray-format: { email, uplink, downlink }.
STATS=\$(echo "\$RAW" | jq -c '[to_entries[] | {email: .key, uplink: (.value.rx // 0), downlink: (.value.tx // 0)}]')

PAYLOAD=\$(jq -nc \\
  --arg host "\$SERVER_HOST" \\
  --argjson stats "\$STATS" \\
  '{server_host: \$host, stats: \$stats}')

RESP=\$(curl -fsS --max-time 15 \\
  -X POST "\$API_URL" \\
  -H 'Content-Type: application/json' \\
  -d "\$PAYLOAD" || echo '{"error":"curl failed"}')

echo "\$(date -u +%FT%TZ) Hy2: pushed \$USER_COUNT users → \$RESP"
HY2SCRIPT
chmod +x /opt/hy2-traffic.sh
echo "[hy2-traffic] Installed /opt/hy2-traffic.sh"

# ── 4. Install cron ────────────────────────────────────────────────────────
cat >/etc/cron.d/hy2-traffic <<'EOF'
# Every 5 min, mirror schedule of /etc/cron.d/xray-traffic.
*/5 * * * * root /opt/hy2-traffic.sh >> /var/log/hy2-traffic.log 2>&1
EOF
chmod 644 /etc/cron.d/hy2-traffic
echo "[hy2-traffic] Installed /etc/cron.d/hy2-traffic"

# ── 5. Smoke-test ──────────────────────────────────────────────────────────
echo ''
echo "[hy2-traffic] Running collector manually for smoke-test…"
echo "─────────────────────────────────────────────────────────"
/opt/hy2-traffic.sh
echo "─────────────────────────────────────────────────────────"

echo ''
echo "[hy2-traffic] ✅ Done."
echo "  Logs:    tail -f /var/log/hy2-traffic.log"
echo "  Config:  ${HY2_CONFIG}"
echo "  Secret:  ${HY2_TRAFFIC_SECRET_FILE}"
echo "  Cron:    /etc/cron.d/hy2-traffic (every 5 min)"
echo ''
echo "  В админке HundlerVPN карточка 'Германия Hysteria' начнёт"
echo "  заполняться после следующего cron tick (≤ 5 мин)."
