# Деплой исправленного xray-sync.sh

Этот фикс убирает рестарт-шторм Xray (он ломает соединения каждый раз
когда кто-то регистрирует устройство).

## Способ A — bash heredoc (рекомендую)

Открой SSH-сессию на VPN VPS и **скопируй блок целиком** (вместе с
последней строкой `tail …`).

### NL

```bash
ssh root@185.238.169.235
```

затем вставляй:

```bash
cat > /opt/xray-sync.sh.new <<'XRAYSYNC_EOF'
#!/bin/bash
set -euo pipefail
API_URL="https://hundlervpn.xyz/api/xray/clients?token=hVpN2026sEcReT_xR4y"
XRAY_CONFIG="/usr/local/etc/xray/config.json"
INBOUND_TAG="vless-in"
RESPONSE=$(curl -sf --max-time 15 "$API_URL") || { echo "[$(date)] ERROR: API fetch failed"; exit 1; }
OK=$(echo "$RESPONSE" | jq -r '.ok // false')
[ "$OK" = "true" ] || { echo "[$(date)] ERROR: API returned ok=false"; exit 1; }
NEW_CLIENTS=$(echo "$RESPONSE" | jq -c '[.clients[] | {id, flow, email}]')
NEW_COUNT=$(echo "$NEW_CLIENTS" | jq 'length')
OLD_CLIENTS=$(jq -c '[.inbounds[] | select(.tag=="'"$INBOUND_TAG"'") | .settings.clients[] | {id, flow, email}]' "$XRAY_CONFIG" 2>/dev/null || echo '[]')
OLD_KEYSET=$(echo "$OLD_CLIENTS" | jq -cS '.|sort_by(.id)|map({id, flow})')
NEW_KEYSET=$(echo "$NEW_CLIENTS" | jq -cS '.|sort_by(.id)|map({id, flow})')
OLD_FULL=$(echo "$OLD_CLIENTS" | jq -cS '.|sort_by(.id)')
NEW_FULL=$(echo "$NEW_CLIENTS" | jq -cS '.|sort_by(.id)')
if [ "$OLD_KEYSET" = "$NEW_KEYSET" ]; then
  if [ "$OLD_FULL" = "$NEW_FULL" ]; then
    echo "[$(date)] No changes ($NEW_COUNT clients)"
    exit 0
  fi
  TMP="${XRAY_CONFIG}.tmp"
  jq --argjson clients "$NEW_CLIENTS" '(.inbounds[] | select(.tag=="'"$INBOUND_TAG"'") | .settings.clients) = $clients' "$XRAY_CONFIG" > "$TMP"
  if ! /usr/local/bin/xray -test -config "$TMP" >/dev/null 2>&1; then
    echo "[$(date)] ERROR: relabelled config invalid, aborting (no restart)"; rm -f "$TMP"; exit 1
  fi
  mv "$TMP" "$XRAY_CONFIG"
  echo "[$(date)] Labels updated, no restart ($NEW_COUNT clients)"
  exit 0
fi
TMP="${XRAY_CONFIG}.tmp"
jq --argjson clients "$NEW_CLIENTS" '(.inbounds[] | select(.tag=="'"$INBOUND_TAG"'") | .settings.clients) = $clients' "$XRAY_CONFIG" > "$TMP"
if ! /usr/local/bin/xray -test -config "$TMP" >/dev/null 2>&1; then
  echo "[$(date)] ERROR: new config invalid, aborting"; rm -f "$TMP"; exit 1
fi
mv "$TMP" "$XRAY_CONFIG"
systemctl restart xray
echo "[$(date)] Restarted: clients changed ($NEW_COUNT clients, was $(echo "$OLD_CLIENTS" | jq 'length'))"
XRAYSYNC_EOF
chmod +x /opt/xray-sync.sh.new && bash /opt/xray-sync.sh.new && mv -f /opt/xray-sync.sh.new /opt/xray-sync.sh && echo OK && tail -n 5 /var/log/xray-sync.log
```

### DE

```bash
ssh root@213.182.213.183
```

— и тот же блок выше.

## Способ B — scp (если у тебя ключи доступны через scp)

Из корня репозитория `hundler-vpn`:

```bash
scp scripts/xray-sync.sh root@185.238.169.235:/opt/xray-sync.sh
ssh root@185.238.169.235 'bash /opt/xray-sync.sh && tail -n 5 /var/log/xray-sync.log'

scp scripts/xray-sync.sh root@213.182.213.183:/opt/xray-sync.sh
ssh root@213.182.213.183 'bash /opt/xray-sync.sh && tail -n 5 /var/log/xray-sync.log'
```

## Что должно произойти

После первого запуска нового скрипта:
- Xray ОДИН РАЗ перезапустится (потому что новый скрипт записывает
  актуальные emails в config — это считается genuine diff против старого
  состояния файла). Это последний рестарт на ближайшие часы.
- Дальше cron `*/5 * * * *` будет писать `Labels updated, no restart`
  или `No changes`. Никаких рестартов на signup'ы — соединения не
  будут рваться.

Проверка через 10 минут после деплоя:

```bash
ssh root@185.238.169.235 'tail -n 30 /var/log/xray-sync.log'
ssh root@213.182.213.183 'tail -n 30 /var/log/xray-sync.log'
```

Если видишь `Restarted: clients changed` каждые 5 минут — что-то ещё
неладно, дай знать (проверю что приходит из `/api/xray/clients`).

## Замечания
- YC bridge (158.160.254.104) **не трогать** — там нет xray-sync, оно
  pure dokodemo passthrough.
- Этот скрипт уже закоммичен в `scripts/xray-sync.sh`
  (commit `5dff5d3`) и в `scripts/setup-germany-server.sh`, так что
  будущие новые VPN VPS получат фикс автоматически.
