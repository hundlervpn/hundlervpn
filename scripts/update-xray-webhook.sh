#!/bin/bash
# update-xray-webhook.sh — pull latest xray-webhook.py from the repo and
# restart xray-webhook.service. Idempotent. Safe to re-run.
#
# Why a separate script: install-xray-sync.sh embeds an old version of the
# webhook (sync-only). When we add new endpoints to scripts/xray-webhook.py
# (e.g. /traffic for live admin refresh), each VPS needs the new code dropped
# in /opt/xray-webhook.py + a systemctl restart. This script handles both.
#
# Usage on each VPN VPS (run as root):
#   curl -fsSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/update-xray-webhook.sh | bash
#
# Or copy script over via scp and `bash update-xray-webhook.sh`.

set -euo pipefail

WEBHOOK_PATH="${WEBHOOK_PATH:-/opt/xray-webhook.py}"
WEBHOOK_URL="${WEBHOOK_URL:-https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/xray-webhook.py}"
SERVICE_NAME="${SERVICE_NAME:-xray-webhook}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
command -v curl >/dev/null || { echo "Install curl first"; exit 1; }
command -v python3 >/dev/null || { echo "Install python3 first"; exit 1; }

if [ ! -f "$WEBHOOK_PATH" ]; then
  echo "ERROR: $WEBHOOK_PATH not found. Run install-xray-sync.sh first to bootstrap webhook + systemd unit."
  exit 1
fi

echo "[update] Backing up current webhook to ${WEBHOOK_PATH}.bak"
cp "$WEBHOOK_PATH" "${WEBHOOK_PATH}.bak"

echo "[update] Downloading latest xray-webhook.py from ${WEBHOOK_URL}…"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
curl -fsSL "$WEBHOOK_URL" -o "$TMP"

# Sanity — must be a Python script with the expected shebang + handler.
if ! head -n 1 "$TMP" | grep -q '^#!/usr/bin/env python3'; then
  echo "ERROR: downloaded file doesn't look like xray-webhook.py:"
  head -n 5 "$TMP"
  exit 1
fi
if ! grep -q 'class Handler' "$TMP"; then
  echo "ERROR: downloaded file missing Handler class — wrong file?"
  exit 1
fi

# Validate syntax before swapping in.
if ! python3 -m py_compile "$TMP"; then
  echo "ERROR: downloaded webhook has Python syntax errors. Aborting (no changes)."
  exit 1
fi

# Detect changes — if identical, skip restart.
if cmp -s "$TMP" "$WEBHOOK_PATH"; then
  echo "[update] Webhook already up to date. No changes."
  exit 0
fi

cp "$TMP" "$WEBHOOK_PATH"
chmod +x "$WEBHOOK_PATH" 2>/dev/null || true

echo "[update] Restarting ${SERVICE_NAME}.service…"
if systemctl restart "$SERVICE_NAME"; then
  sleep 1
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "[update] ✅ ${SERVICE_NAME} restarted, active."
  else
    echo "[update] ❌ ${SERVICE_NAME} failed to come up. Reverting to backup…"
    cp "${WEBHOOK_PATH}.bak" "$WEBHOOK_PATH"
    systemctl restart "$SERVICE_NAME" || true
    journalctl -u "$SERVICE_NAME" -n 30 --no-pager
    exit 1
  fi
else
  echo "[update] ❌ systemctl restart failed. Reverting to backup…"
  cp "${WEBHOOK_PATH}.bak" "$WEBHOOK_PATH"
  exit 1
fi

echo
echo "[update] Probing /health…"
PORT=$(grep -oE 'LISTEN_PORT=[0-9]+' "/etc/default/${SERVICE_NAME}" 2>/dev/null | head -1 | cut -d= -f2)
PORT="${PORT:-9999}"
HEALTH=$(curl -sf --max-time 5 "http://127.0.0.1:${PORT}/health" 2>/dev/null || echo '{"ok":false}')
echo "[update]   $HEALTH"
echo
echo "[update] Done. Webhook now supports POST /traffic for on-demand stats refresh."
