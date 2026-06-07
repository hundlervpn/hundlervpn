#!/bin/bash
# =============================================================================
# patch-reality-sni-pool.sh — expand Reality serverNames to a 4-SNI pool
#
# Live-node patch matching the SNI_POOLS in `lib/sub-token.ts` (2026-05-08).
# Run this on EACH active Xray-Reality node BEFORE deploying the matching
# `lib/sub-token.ts` change to production. Order matters:
#
#   1. SSH to each VPN node (NL exit, DE, RU)        ← run THIS script
#   2. Verify Xray restart succeeded + handshake works
#   3. Deploy mini-app + bot (which will start sending the new SNIs)
#
# If you reverse the order, clients who poll the subscription endpoint
# during the deploy window will get a fresh SNI from the pool that the
# server doesn't yet accept — Reality fallback to the donor `dest` site
# would kick in, breaking the connection until the next subscription poll.
#
# Pool selection — auto-detects from current serverNames[0]:
#   - If the current `serverNames` array already contains "yastatic.net"
#     or "vk.com", treat the node as RU and apply the RU pool.
#   - Else if hostname / IP suggests RU (msk-, moscow, 85.239.…) — RU pool.
#   - Else apply the foreign pool (DE, NL, anything else).
#
# Override with `POOL=foreign|ru bash patch-reality-sni-pool.sh`.
#
# USAGE (on a live VPS, as root):
#   curl -fsSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/patch-reality-sni-pool.sh | bash
#
# Or download + run locally:
#   wget https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/patch-reality-sni-pool.sh
#   bash patch-reality-sni-pool.sh
#
# Idempotent — re-running with the same pool is a no-op (config diff
# detection skips the restart). Safe to run during steady-state traffic.
# =============================================================================
set -euo pipefail

CFG="/usr/local/etc/xray/config.json"
INBOUND_TAG="${INBOUND_TAG:-vless-in}"
[ -f "$CFG" ] || { echo "[patch] ERROR: $CFG missing — is Xray installed?"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "[patch] ERROR: jq not installed — apt-get install -y jq"; exit 1; }
[ -x /usr/local/bin/xray ] || { echo "[patch] ERROR: /usr/local/bin/xray missing"; exit 1; }

# ---------------------------------------------------------------------------
# 1. Detect or accept the pool kind.
# ---------------------------------------------------------------------------
POOL_KIND="${POOL:-auto}"

if [ "$POOL_KIND" = "auto" ]; then
  CURRENT=$(jq -r ".inbounds[] | select(.tag==\"$INBOUND_TAG\") | .streamSettings.realitySettings.serverNames | join(\",\")" "$CFG" 2>/dev/null || true)
  if echo "$CURRENT" | grep -qE 'yastatic\.net|vk\.com|storage\.yandex\.net'; then
    POOL_KIND=ru
  elif hostname -f 2>/dev/null | grep -qiE 'msk-|moscow|spb-|ru-'; then
    POOL_KIND=ru
  elif ip -4 addr 2>/dev/null | grep -qE '85\.239\.|87\.226\.|85\.140\.|178\.154\.'; then
    POOL_KIND=ru
  else
    POOL_KIND=foreign
  fi
  echo "[patch] auto-detected pool: $POOL_KIND"
fi

case "$POOL_KIND" in
  foreign)
    POOL_JSON='["www.microsoft.com", "www.cloudflare.com", "www.apple.com", "www.tiktok.com"]'
    ;;
  ru)
    POOL_JSON='["www.microsoft.com", "yastatic.net", "storage.yandex.net", "vk.com"]'
    ;;
  *)
    echo "[patch] ERROR: unknown POOL=$POOL_KIND (expected 'foreign' or 'ru')"
    exit 1
    ;;
esac

echo "[patch] applying pool ($POOL_KIND): $POOL_JSON"

# ---------------------------------------------------------------------------
# 2. Idempotency check — skip if already applied.
# ---------------------------------------------------------------------------
EXISTING=$(jq -cS ".inbounds[] | select(.tag==\"$INBOUND_TAG\") | .streamSettings.realitySettings.serverNames" "$CFG")
TARGET=$(echo "$POOL_JSON" | jq -cS '.')

if [ "$EXISTING" = "$TARGET" ]; then
  echo "[patch] serverNames already matches target — no-op"
  echo "[patch] active serverNames:"
  jq ".inbounds[] | select(.tag==\"$INBOUND_TAG\") | .streamSettings.realitySettings.serverNames" "$CFG"
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Backup, patch, validate, restart.
# ---------------------------------------------------------------------------
TS=$(date +%Y%m%d-%H%M%S)
BACKUP="${CFG}.pre-snipool.${TS}"
cp "$CFG" "$BACKUP"
echo "[patch] backed up current config → $BACKUP"

TMP="${CFG%.json}.new.json"
jq ".inbounds |= map(if .tag==\"$INBOUND_TAG\" then .streamSettings.realitySettings.serverNames = $POOL_JSON else . end)" \
  "$CFG" > "$TMP"

if ! /usr/local/bin/xray -test -config "$TMP" >/dev/null 2>&1; then
  echo "[patch] ERROR: xray -test failed on patched config — keeping original"
  /usr/local/bin/xray -test -config "$TMP" 2>&1 | tail -10 || true
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$CFG"
chmod 644 "$CFG"

echo "[patch] config patched, restarting xray…"
systemctl restart xray
sleep 2

if systemctl is-active xray >/dev/null 2>&1; then
  echo "[patch] xray running ✓"
else
  echo "[patch] ERROR: xray failed to restart after patch — rolling back"
  cp "$BACKUP" "$CFG"
  systemctl restart xray
  exit 1
fi

echo "[patch] active serverNames after patch:"
jq ".inbounds[] | select(.tag==\"$INBOUND_TAG\") | .streamSettings.realitySettings.serverNames" "$CFG"

echo ""
echo "[patch] DONE. Roll back if needed:"
echo "    cp $BACKUP $CFG && systemctl restart xray"
