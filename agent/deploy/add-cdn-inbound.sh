#!/bin/bash
# add-cdn-inbound.sh — idempotent patch чтобы добавить VLESS+WebSocket
# inbound для CDN-обхода («белые списки»/БС) в существующий
# /usr/local/etc/xray/config.json.
#
# Архитектура CDN-обхода:
#
#   Клиент (sing-box, VLESS+WS)
#      │ TLS, server = домен раздачи CDN : 443
#   CDN edge (белый IP, RU)
#      │ HTTPS на origin = <node-domain> : 8443
#   Caddy (TLS-серт <node-domain>, порт 8443)
#      │ reverse_proxy /api/stream → 127.0.0.1:CDN_WS_PORT
#   Xray inbound (этот скрипт, VLESS+WS, без TLS)
#      ▼ дефолтный outbound ноды (WARP/freedom) → интернет
#
# TLS терминирует Caddy/CDN, поэтому сам inbound — plain WS без security.
# Reality-inbound на 443 НЕ трогается.
#
# clients[] остаётся пустым — их наливает hundler-xray-agent через gRPC,
# если в его env задан CDN_INBOUND_TAG=<этот tag>. Flow у CDN-клиентов
# всегда "" (xtls-rprx-vision работает только по прямому TCP, не через WS).
#
# Usage: ssh root@<vps> 'bash -s' < add-cdn-inbound.sh
#   override defaults через env:
#     CDN_INBOUND_TAG=vless-ws-cdn CDN_WS_PORT=2087 CDN_WS_PATH=/api/stream \
#       bash add-cdn-inbound.sh

set -euo pipefail

CONFIG="/usr/local/etc/xray/config.json"
CDN_INBOUND_TAG="${CDN_INBOUND_TAG:-vless-ws-cdn}"
CDN_WS_PORT="${CDN_WS_PORT:-2087}"
CDN_WS_PATH="${CDN_WS_PATH:-/api/stream}"

if [ ! -f "$CONFIG" ]; then
  echo "ERROR: $CONFIG not found"
  exit 1
fi

if jq -e --arg t "$CDN_INBOUND_TAG" '.inbounds[]? | select(.tag == $t)' "$CONFIG" >/dev/null 2>&1; then
  echo "CDN inbound '$CDN_INBOUND_TAG' уже присутствует — пропускаем."
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y jq
fi

echo "Backing up config.json → config.json.pre-cdn.bak"
cp "$CONFIG" "${CONFIG}.pre-cdn.bak"

TMP="${CONFIG%.json}.new.json"

# Добавляем WS-inbound на localhost. listen=127.0.0.1 — наружу его НЕ
# светим, доступ только через Caddy (reverse_proxy). decryption:none —
# обязательное поле VLESS. clients[] пустой — agent нальёт через gRPC.
jq \
  --arg tag "$CDN_INBOUND_TAG" \
  --argjson port "$CDN_WS_PORT" \
  --arg wspath "$CDN_WS_PATH" '
  .inbounds += [{
    "tag": $tag,
    "listen": "127.0.0.1",
    "port": $port,
    "protocol": "vless",
    "settings": {
      "clients": [],
      "decryption": "none"
    },
    "streamSettings": {
      "network": "ws",
      "security": "none",
      "wsSettings": { "path": $wspath }
    },
    "sniffing": {
      "enabled": true,
      "destOverride": ["http", "tls", "quic"]
    }
  }]
' "$CONFIG" > "$TMP"

if ! /usr/local/bin/xray -test -config "$TMP" >/dev/null 2>&1; then
  echo "ERROR: новый config.json не прошёл xray -test"
  /usr/local/bin/xray -test -config "$TMP" 2>&1 | tail -10
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$CONFIG"
echo "Config patched: добавлен inbound '$CDN_INBOUND_TAG' (VLESS+WS на 127.0.0.1:${CDN_WS_PORT}, path ${CDN_WS_PATH})."
echo "Restarting Xray…"
systemctl restart xray
sleep 2
if systemctl is-active xray >/dev/null; then
  echo "✅ Xray running with CDN WS inbound."
  echo "Дальше:"
  echo "  1) Caddy на этой ноде: TLS <node-domain>:8443, reverse_proxy ${CDN_WS_PATH}* 127.0.0.1:${CDN_WS_PORT}"
  echo "  2) В /etc/hundler-xray-agent/env добавь: CDN_INBOUND_TAG=${CDN_INBOUND_TAG}  затем: systemctl restart hundler-xray-agent"
  echo "  3) Timeweb CDN: источник = <node-domain>:8443, HTTPS-to-origin ON, отключить кэш для ${CDN_WS_PATH}*, включить WebSocket"
else
  echo "ERROR: Xray не поднялся после рестарта. Откат: cp ${CONFIG}.pre-cdn.bak ${CONFIG} && systemctl restart xray"
  exit 1
fi
