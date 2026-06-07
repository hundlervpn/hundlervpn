#!/bin/bash
# add-api-inbound.sh — idempotent patch чтобы добавить gRPC API inbound
# в существующий /usr/local/etc/xray/config.json. Нужен только если нода
# была provisioned до v68 setup-*.sh (без api inbound).
#
# Свежие ноды (provisioned via setup-germany-server.sh / setup-rf-server.sh)
# уже имеют api inbound — можно пропустить.
#
# Usage: ssh root@<vps> 'bash -s' < add-api-inbound.sh

set -euo pipefail

CONFIG="/usr/local/etc/xray/config.json"

if [ ! -f "$CONFIG" ]; then
  echo "ERROR: $CONFIG not found"
  exit 1
fi

if grep -q 'HandlerService' "$CONFIG"; then
  echo "API inbound уже присутствует — пропускаем."
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y jq
fi

echo "Backing up config.json → config.json.pre-grpc.bak"
cp "$CONFIG" "${CONFIG}.pre-grpc.bak"

# Добавляем api inbound + api object + routing rule. Если эти секции уже
# есть частично — мы их recreate, но это ок для начальной инсталляции.

TMP="${CONFIG%.json}.new.json"

jq '
  .api = {
    "tag": "api",
    "services": ["HandlerService", "LoggerService", "StatsService"]
  }
  | .stats = (.stats // {})
  | .policy = (.policy // {})
  | .policy.levels = (.policy.levels // {})
  | .policy.levels."0" = ((.policy.levels."0" // {}) + {
      "statsUserUplink": true,
      "statsUserDownlink": true
    })
  | .policy.system = ((.policy.system // {}) + {
      "statsInboundUplink": true,
      "statsInboundDownlink": true,
      "statsOutboundUplink": true,
      "statsOutboundDownlink": true
    })
  | .inbounds = ([{
      "tag": "api",
      "listen": "127.0.0.1",
      "port": 10085,
      "protocol": "dokodemo-door",
      "settings": { "address": "127.0.0.1" }
    }] + (.inbounds // []))
  | .routing.rules = ([{
      "type": "field",
      "inboundTag": ["api"],
      "outboundTag": "api"
    }] + (.routing.rules // []))
  | .outbounds = (.outbounds // [])
' "$CONFIG" > "$TMP"

if ! /usr/local/bin/xray -test -config "$TMP" >/dev/null 2>&1; then
  echo "ERROR: новый config.json не прошёл xray -test"
  /usr/local/bin/xray -test -config "$TMP" 2>&1 | tail -10
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$CONFIG"
echo "Config patched. Restarting Xray to load API inbound…"
systemctl restart xray
sleep 2
systemctl is-active xray >/dev/null && echo "✅ Xray running with API inbound on 127.0.0.1:10085"
