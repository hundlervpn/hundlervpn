#!/bin/bash
# xray-connections.sh — Monitors Xray access log and reports connections
# Runs as a daemon, watches /var/log/xray/access.log

set -euo pipefail

ENV_FILE="/opt/xray-sync.env"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

APP_URL="${APP_URL:-}"
SYNC_TOKEN="${SYNC_TOKEN:-}"
LOG_FILE="/var/log/xray/access.log"
STATE_FILE="/var/run/xray-connections.pos"

if [ -z "$APP_URL" ] || [ -z "$SYNC_TOKEN" ]; then
  echo "ERROR: APP_URL and SYNC_TOKEN required in $ENV_FILE"
  exit 1
fi

# Track last position in log file
get_pos() {
  [ -f "$STATE_FILE" ] && cat "$STATE_FILE" || echo 0
}

save_pos() {
  echo "$1" > "$STATE_FILE"
}

report_connection() {
  local email="$1"
  # Extract key_hash from email (format: tg-XXXXX)
  # We need to look up the key_hash from the API or DB
  # For now, just report the email/user identifier
  
  curl -sf --max-time 5 \
    -X POST "${APP_URL}/api/vpn/connect" \
    -H "Authorization: Bearer ${SYNC_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"${email}\"}" \
    >/dev/null 2>&1 || true
}

# Process new log entries
process_log() {
  local pos=$(get_pos)
  local current_size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
  
  # If log was rotated (smaller than our position), reset
  if [ "$current_size" -lt "$pos" ]; then
    pos=0
  fi
  
  if [ "$current_size" -gt "$pos" ]; then
    # Read new entries and extract email from accepted connections
    tail -c +$((pos + 1)) "$LOG_FILE" 2>/dev/null | \
      grep -oP 'email: \K[^,\s]+' | \
      sort -u | \
      while read -r email; do
        [ -n "$email" ] && report_connection "$email"
      done
    
    save_pos "$current_size"
  fi
}

# Main loop - check every 30 seconds
echo "[$(date)] xray-connections monitor started"
while true; do
  [ -f "$LOG_FILE" ] && process_log
  sleep 30
done
