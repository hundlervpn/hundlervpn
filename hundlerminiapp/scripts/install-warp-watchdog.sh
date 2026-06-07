#!/bin/bash
# =============================================================================
# install-warp-watchdog.sh
#
# One-shot installer that adds /opt/warp-watchdog.sh + a 1-minute cron job
# to an EXISTING HundlerVPN exit VPS (DE / NL / future).
#
# Why this exists:
#   Cloudflare WARP-svc occasionally enters a "Connected, healthy" zombie
#   state where its SOCKS5 listener on 127.0.0.1:40000 returns
#   `Can't complete SOCKS5 connection (4) Host unreachable` for every
#   request — even though `warp-cli status` says everything is fine.
#   Reproduced once on DE (2026-05-06) after ~2 days of uptime with the
#   MASQUE tunnel protocol. Symptom: Xray accepts VLESS connections but
#   no traffic flows → users see "Ping N/A" on the affected server.
#
#   The only known recovery is `systemctl restart warp-svc`. This script
#   automates that recovery so user impact is bounded to ≤ 60 seconds
#   instead of "until an admin notices".
#
# How it works:
#   /opt/warp-watchdog.sh — runs every minute via cron. Probes the SOCKS5
#   proxy with `curl --socks5 127.0.0.1:40000 cdn-cgi/trace`. If the probe
#   fails twice in a row (3-second gap) it restarts warp-svc and waits
#   for recovery. Has a 10-minute cooldown between restart attempts so a
#   fundamentally-broken WARP doesn't get hammered.
#
# Usage on the VPS:
#   curl -fsSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/install-warp-watchdog.sh | bash
# Or paste manually:
#   cat > /tmp/install-warp-watchdog.sh   # paste this file
#   bash /tmp/install-warp-watchdog.sh
#
# Idempotent: running it twice replaces the watchdog and re-installs the
# cron entry without duplicating it.
# =============================================================================

set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }

log() { echo -e "\033[1;34m[install-warp-watchdog]\033[0m $*"; }

# 1. Watchdog script ----------------------------------------------------------
log "Installing /opt/warp-watchdog.sh…"
cat > /opt/warp-watchdog.sh <<'WATCHDOG'
#!/bin/bash
# warp-watchdog.sh — health-checks WARP SOCKS5 proxy and restarts warp-svc
# when it gets wedged. Designed for cron use every 1 minute.
#
# Algorithm:
#   1. Try to GET cdn-cgi/trace through SOCKS5:40000 with 5 sec timeout.
#   2. If it succeeds AND response contains warp=on → all good, exit 0.
#   3. Else wait 3 seconds and retry once. If still fails → action.
#   4. Action: `systemctl restart warp-svc` + `warp-cli connect`,
#      then re-probe to log the outcome.
#   5. Cooldown: refuse to take action again within 600 seconds, so a
#      fundamentally-broken WARP (e.g. revoked registration) doesn't
#      cause a hot loop of restarts that would also disrupt healthy
#      Xray traffic during each restart's brief outage window.
#
# Lock: uses flock on /var/run/warp-watchdog.lock so two cron ticks
# running long can never overlap.
#
# Log file: /var/log/warp-watchdog.log (rotation handled by logrotate
# defaults — file stays small in the healthy steady state because we
# only write a line when we actually do something).

set -euo pipefail

LOG=/var/log/warp-watchdog.log
LOCK=/var/run/warp-watchdog.lock
COOLDOWN_FILE=/var/run/warp-watchdog.cooldown
COOLDOWN_SEC=600
PROBE_URL=https://www.cloudflare.com/cdn-cgi/trace
PROBE_TIMEOUT=5

# Concurrency guard.
exec 9>"$LOCK"
flock -n 9 || exit 0

now_ts=$(date +%s)

# Cooldown check.
if [ -f "$COOLDOWN_FILE" ]; then
  last_action=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  if [ -n "$last_action" ] && [ "$((now_ts - last_action))" -lt "$COOLDOWN_SEC" ]; then
    exit 0
  fi
fi

probe() {
  curl --fail --silent --show-error --max-time "$PROBE_TIMEOUT" \
       --socks5 127.0.0.1:40000 "$PROBE_URL" 2>/dev/null \
    | grep -q '^warp=on$'
}

# Two attempts before action.
if probe; then
  exit 0
fi
sleep 3
if probe; then
  exit 0
fi

# Two consecutive failures — restart WARP.
{
  echo
  echo "[$(date -Iseconds)] WARP SOCKS5 unhealthy after 2 probes — restarting warp-svc"
  systemctl restart warp-svc 2>&1 || true
  sleep 5
  warp-cli connect 2>&1 || true
  sleep 5
  if probe; then
    echo "[$(date -Iseconds)] WARP recovered after restart"
  else
    echo "[$(date -Iseconds)] WARP STILL DOWN after restart — manual intervention required"
    echo "[$(date -Iseconds)]   try: warp-cli registration delete && warp-cli registration new && warp-cli mode proxy && warp-cli proxy port 40000 && warp-cli connect"
  fi
} >> "$LOG" 2>&1

echo "$now_ts" > "$COOLDOWN_FILE"
WATCHDOG
chmod +x /opt/warp-watchdog.sh

# 2. Log file -----------------------------------------------------------------
touch /var/log/warp-watchdog.log
chmod 0644 /var/log/warp-watchdog.log

# 3. Cron entry ---------------------------------------------------------------
log "Installing cron entry (every 1 minute)…"
{
  crontab -l 2>/dev/null | grep -v 'warp-watchdog.sh' || true
  echo "* * * * * /opt/warp-watchdog.sh"
} | crontab -

# 4. Smoke test ---------------------------------------------------------------
log "Smoke-testing watchdog (running it once now)…"
/opt/warp-watchdog.sh
log "Done. Last 5 log lines:"
tail -n 5 /var/log/warp-watchdog.log 2>/dev/null || echo "  (log empty — WARP is healthy, watchdog only writes on action)"

cat <<DONE

============================================================
  warp-watchdog installed successfully
============================================================

  Script   : /opt/warp-watchdog.sh
  Log      : /var/log/warp-watchdog.log
  Cron     : * * * * * /opt/warp-watchdog.sh
  Cooldown : 600 sec between restart attempts

  Healthy steady state writes NOTHING to the log — log file
  grows only when WARP actually got restarted.

  Manual probe (should print warp=on):
    curl --max-time 5 --socks5 127.0.0.1:40000 \\
      https://www.cloudflare.com/cdn-cgi/trace

  Force one watchdog tick now:
    /opt/warp-watchdog.sh

============================================================
DONE
