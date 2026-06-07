#!/bin/bash
# DEPRECATED: adu/rmu silently fails in Xray 26.3.27 ("Added 0 user(s)").
# Use the diff+restart script from scripts/xray-sync.sh instead.
#
# Xray hot-reload sync via HandlerService gRPC API.
#
# Unlike the legacy /opt/xray-sync.sh (which restarted Xray and dropped
# every active VPN connection), this script performs an in-memory diff
# of the client list and uses `xray api adu / rmu` to add/remove only
# what changed. Active connections are never interrupted.
#
# State is tracked in /var/cache/xray-sync/state.json. On first run,
# state is bootstrapped from the current Xray config.json so no user
# gets added twice or removed by mistake.
#
# After each successful sync the list is also persisted back into
# /usr/local/etc/xray/config.json so a Xray restart (e.g. after OS
# reboot) picks up the correct clients without needing a sync to run.
#
# Usage:
#   /opt/xray-sync.sh
#
# Cron (safe at any interval thanks to diff + hot-reload):
#   */1 * * * * /opt/xray-sync.sh >> /var/log/xray-sync.log 2>&1

set -euo pipefail

API_URL="https://hundlervpn.xyz/api/xray/clients?token=hVpN2026sEcReT_xR4y"
STATE_FILE="/var/cache/xray-sync/state.json"
XRAY_CONFIG="/usr/local/etc/xray/config.json"
XRAY_BIN="/usr/local/bin/xray"
XRAY_API="127.0.0.1:10085"
INBOUND_TAG="vless-in"

mkdir -p "$(dirname "$STATE_FILE")"

# ── Fetch desired state from API ──────────────────────────────
RESPONSE=$(curl -sf --max-time 15 "$API_URL") || {
  echo "[$(date)] ERROR: API fetch failed"
  exit 1
}

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
if [ "$OK" != "true" ]; then
  echo "[$(date)] ERROR: API returned ok=false"
  exit 1
fi

NEW=$(echo "$RESPONSE" | jq -c '[.clients[] | {id, flow, email}]')
NEW_COUNT=$(echo "$NEW" | jq 'length')

# ── Bootstrap state on first run ──────────────────────────────
if [ ! -f "$STATE_FILE" ]; then
  jq -c '[.inbounds[] | select(.tag=="'"$INBOUND_TAG"'") | .settings.clients[] | {id, flow, email}]' \
    "$XRAY_CONFIG" > "$STATE_FILE" 2>/dev/null || echo '[]' > "$STATE_FILE"
  echo "[$(date)] Bootstrapped state from config.json ($(jq 'length' "$STATE_FILE") clients)"
fi

OLD=$(cat "$STATE_FILE")

# ── Compute diff ──────────────────────────────────────────────
TO_ADD=$(jq -c --argjson old "$OLD" '. - $old' <<< "$NEW")
TO_REMOVE=$(jq -c --argjson new "$NEW" '. - $new' <<< "$OLD")

ADD_COUNT=$(echo "$TO_ADD" | jq 'length')
RM_COUNT=$(echo "$TO_REMOVE" | jq 'length')

if [ "$ADD_COUNT" -eq 0 ] && [ "$RM_COUNT" -eq 0 ]; then
  echo "[$(date)] No changes (${NEW_COUNT} clients)"
  exit 0
fi

# ── Remove stale clients ──────────────────────────────────────
if [ "$RM_COUNT" -gt 0 ]; then
  while IFS= read -r email; do
    [ -z "$email" ] && continue
    out=$("$XRAY_BIN" api rmu --server="$XRAY_API" -tag="$INBOUND_TAG" "$email" 2>&1) || true
    if echo "$out" | grep -qiE "not found|unknown"; then
      : # user already absent — benign
    elif [ -n "$out" ]; then
      echo "[$(date)] rmu $email: $out"
    fi
  done < <(echo "$TO_REMOVE" | jq -r '.[].email')
fi

# ── Add new clients ───────────────────────────────────────────
if [ "$ADD_COUNT" -gt 0 ]; then
  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT

  i=0
  while IFS= read -r c; do
    f="$TMP_DIR/client_$i.json"
    jq -n --argjson cli "$c" --arg tag "$INBOUND_TAG" '
      {
        tag: $tag,
        user: {
          email: $cli.email,
          level: 0,
          account: {
            "@type": "type.googleapis.com/xray.proxy.vless.Account",
            id: $cli.id,
            flow: $cli.flow,
            encryption: "none"
          }
        }
      }
    ' > "$f"
    i=$((i+1))
  done < <(echo "$TO_ADD" | jq -c '.[]')

  files=("$TMP_DIR"/client_*.json)
  out=$("$XRAY_BIN" api adu --server="$XRAY_API" "${files[@]}" 2>&1) || true
  if echo "$out" | grep -qiE "already exists"; then
    : # user was already there — benign
  elif [ -n "$out" ]; then
    echo "[$(date)] adu: $out"
  fi
fi

# ── Persist state for next diff ──────────────────────────────
echo "$NEW" > "$STATE_FILE"

# ── Also persist to config.json so Xray restart keeps the list ──
TMP_CONFIG="${XRAY_CONFIG}.tmp.json"
jq --argjson clients "$NEW" "
  (.inbounds[] | select(.tag==\"${INBOUND_TAG}\") | .settings.clients) = \$clients
" "$XRAY_CONFIG" > "$TMP_CONFIG" && mv "$TMP_CONFIG" "$XRAY_CONFIG"

echo "[$(date)] Hot-reload: +${ADD_COUNT} -${RM_COUNT} (total ${NEW_COUNT})"
