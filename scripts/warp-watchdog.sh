#!/bin/bash
# warp-watchdog.sh — Health-check the Cloudflare WARP socks proxy and
# auto-restart warp-svc when it silently dies.
#
# WHY THIS EXISTS
# ---------------
# 2026-05-14: Germany VPS (213.182.213.183) silently broke for ~10 h
# because the WARP daemon's local SOCKS5 listener on 127.0.0.1:40000
# stayed alive while the upstream WireGuard tunnel to Cloudflare was
# down. Every Xray client successfully completed Reality handshake,
# then their traffic was routed through this half-dead SOCKS proxy and
# disappeared into a black hole. Users saw "no ping / N/A". Hy2
# kept working because its routing rule sends UDP to `direct`, not warp.
#
# This watchdog runs every minute via cron:
#   * Polls the SOCKS proxy with cdn-cgi/trace (1-line response, fast)
#   * Tolerates a single hiccup
#   * After 3 consecutive failures: systemctl restart warp-svc
#   * Logs to /var/log/warp-watchdog.log with timestamps
#
# INSTALL (on the VPS):
#   curl -fsSL https://raw.githubusercontent.com/.../warp-watchdog.sh > /opt/warp-watchdog.sh
#   chmod +x /opt/warp-watchdog.sh
#   ( crontab -l 2>/dev/null; echo '*/1 * * * * /opt/warp-watchdog.sh >> /var/log/warp-watchdog.log 2>&1' ) | crontab -

set -euo pipefail

SOCKS_HOST="127.0.0.1"
SOCKS_PORT="40000"
PROBE_URL="https://www.cloudflare.com/cdn-cgi/trace"
FAIL_STATE="/var/run/warp-watchdog.failcount"
THRESHOLD=3
TIMEOUT=8
SERVICE="warp-svc"

ts() { date '+%Y-%m-%dT%H:%M:%S%:z'; }

read_fails() {
  if [[ -f "$FAIL_STATE" ]]; then
    cat "$FAIL_STATE"
  else
    echo 0
  fi
}

write_fails() {
  echo "$1" > "$FAIL_STATE"
}

# Probe: response must contain "warp=on" or "warp=plus" — anything else
# (including a successful HTTPS response WITHOUT warp=on) means the
# tunnel is up but Cloudflare is not actually proxying us through WARP.
probe() {
  local body
  body=$(curl -sS --max-time "$TIMEOUT" --socks5 "${SOCKS_HOST}:${SOCKS_PORT}" "$PROBE_URL" 2>/dev/null || echo "FAIL")
  if [[ "$body" == "FAIL" ]]; then
    echo "ERR_TIMEOUT"
    return 1
  fi
  if echo "$body" | grep -qE '^warp=(on|plus)$'; then
    echo "OK"
    return 0
  fi
  echo "WARP_OFF"
  return 1
}

main() {
  local result fails
  result=$(probe || true)
  fails=$(read_fails)

  if [[ "$result" == "OK" ]]; then
    if [[ "$fails" != "0" ]]; then
      echo "[$(ts)] WARP recovered (was at $fails consecutive fails)"
      write_fails 0
    fi
    exit 0
  fi

  fails=$((fails + 1))
  write_fails "$fails"
  echo "[$(ts)] WARP probe failed: $result (consecutive=$fails/$THRESHOLD)"

  if (( fails >= THRESHOLD )); then
    echo "[$(ts)] Threshold reached — restarting $SERVICE"
    systemctl restart "$SERVICE"
    write_fails 0
    sleep 5
    # Verify it came back
    if recovered=$(probe); then
      echo "[$(ts)] Restart succeeded: $recovered"
    else
      echo "[$(ts)] Restart did NOT recover WARP (still $recovered). Manual intervention required."
    fi
  fi
}

main
