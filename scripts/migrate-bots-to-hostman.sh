#!/usr/bin/env bash
#
# v68 (2026-05-17) — Bot VPS migration from Timeweb DB to Hostman managed PG.
#
# Run on the Amsterdam bot VPS as root. Performs an idempotent in-place
# rewrite of:
#   - /etc/systemd/system/hundlervpn-bot.service     (main bot)
#   - /root/hundlervpn/bot-chat/.env                 (chat bot)
# from the old `db-tunnel`-fronted target (`127.0.0.1:5433`, host actually
# `5.42.118.215` upstream) to the new Hostman managed Postgres at
# `132.243.242.196:5432` with the new password `HundlerVPN2026Strong`.
#
# Also disables the now-redundant `db-tunnel.service` after both bots prove
# they can talk to the new DB on their own.
#
# Re-runnable — every step checks state before mutating.

set -euo pipefail

NEW_HOST="132.243.242.196"
NEW_PORT="5432"
NEW_USER="gen_user"
NEW_PASS="HundlerVPN2026Strong"
NEW_DB="default_db"
NEW_SSL="require"

BOT_UNIT="/etc/systemd/system/hundlervpn-bot.service"
CHAT_UNIT="/etc/systemd/system/hundlervpn-bot-chat.service"
CHAT_ENV="/root/hundlervpn/bot-chat/.env"
TUNNEL_UNIT="db-tunnel.service"

ts="$(date +%Y%m%d_%H%M%S)"
backup_dir="/root/hundlervpn-migration-backup-${ts}"
mkdir -p "${backup_dir}"

echo "=== Phase 1: pre-flight check — direct connectivity to new Hostman DB ==="
echo "--- TCP reachability ---"
if ! timeout 5 bash -c "</dev/tcp/${NEW_HOST}/${NEW_PORT}" 2>/dev/null; then
  echo "ERROR: cannot open TCP to ${NEW_HOST}:${NEW_PORT} from this VPS."
  echo "Likely cause: Hostman managed PG IP whitelist does not yet include"
  echo "this VPS' egress IP. Add it in Hostman UI → Postgres → IP Access,"
  echo "wait ~30s, then re-run this script."
  exit 1
fi
echo "OK: TCP reachable."

echo "--- Postgres auth handshake ---"
if command -v psql >/dev/null 2>&1; then
  if PGPASSWORD="${NEW_PASS}" psql -h "${NEW_HOST}" -p "${NEW_PORT}" \
      -U "${NEW_USER}" -d "${NEW_DB}" \
      --set=sslmode="${NEW_SSL}" \
      -c "SELECT count(*) AS users FROM users;" >/dev/null 2>&1; then
    echo "OK: psql connect + SELECT works."
  else
    echo "ERROR: psql connect failed. Check password / firewall / sslmode."
    exit 1
  fi
else
  echo "WARNING: psql not installed on this VPS — skipping client check."
  echo "  Install with: apt-get install -y postgresql-client-common postgresql-client"
fi

# Same check via the venv'd python that the bot actually uses, since
# psql being happy doesn't always mean psycopg2 is.
echo "--- psycopg2 handshake (the one that actually matters) ---"
if [[ -x /root/hundlervpn/bot/venv/bin/python3 ]]; then
  /root/hundlervpn/bot/venv/bin/python3 - <<PY
import psycopg2, sys
try:
    c = psycopg2.connect(
        host="${NEW_HOST}", port=${NEW_PORT}, user="${NEW_USER}",
        password="${NEW_PASS}", database="${NEW_DB}",
        sslmode="${NEW_SSL}", connect_timeout=10,
    )
    cur = c.cursor()
    cur.execute("SELECT version()")
    print("OK:", cur.fetchone()[0][:80])
except Exception as e:
    print("ERROR:", e)
    sys.exit(1)
PY
else
  echo "WARNING: bot venv not found at /root/hundlervpn/bot/venv. Skipping."
fi

echo
echo "=== Phase 2: backup current configs to ${backup_dir} ==="
[[ -f "${BOT_UNIT}"  ]] && cp -a "${BOT_UNIT}"  "${backup_dir}/" && echo "  saved $(basename ${BOT_UNIT})"
[[ -f "${CHAT_UNIT}" ]] && cp -a "${CHAT_UNIT}" "${backup_dir}/" && echo "  saved $(basename ${CHAT_UNIT})"
[[ -f "${CHAT_ENV}"  ]] && cp -a "${CHAT_ENV}"  "${backup_dir}/" && echo "  saved $(basename ${CHAT_ENV})"

echo
echo "=== Phase 3: rewrite hundlervpn-bot.service env vars ==="
if [[ -f "${BOT_UNIT}" ]]; then
  # Replace tunnel host + port + password + sslmode lines (idempotent).
  sed -i \
    -e "s|^Environment=POSTGRESQL_HOST=.*|Environment=POSTGRESQL_HOST=${NEW_HOST}|" \
    -e "s|^Environment=POSTGRESQL_PORT=.*|Environment=POSTGRESQL_PORT=${NEW_PORT}|" \
    -e "s|^Environment=POSTGRESQL_PASSWORD=.*|Environment=POSTGRESQL_PASSWORD=${NEW_PASS}|" \
    "${BOT_UNIT}"

  # Add SSLMODE line if missing.
  if ! grep -q '^Environment=POSTGRESQL_SSLMODE=' "${BOT_UNIT}"; then
    sed -i "/^Environment=POSTGRESQL_DBNAME=/a Environment=POSTGRESQL_SSLMODE=${NEW_SSL}" "${BOT_UNIT}"
  fi

  echo "Updated ${BOT_UNIT}:"
  grep -E '^Environment=POSTGRESQL_' "${BOT_UNIT}" | sed 's/^/  /'
else
  echo "WARNING: ${BOT_UNIT} not found — main bot may live elsewhere."
fi

echo
echo "=== Phase 4: rewrite bot-chat .env ==="
if [[ -f "${CHAT_ENV}" ]]; then
  # Replace lines (handle both `KEY=value` and `KEY=value # comment` shapes).
  sed -i \
    -e "s|^POSTGRESQL_HOST=.*|POSTGRESQL_HOST=${NEW_HOST}|" \
    -e "s|^POSTGRESQL_PORT=.*|POSTGRESQL_PORT=${NEW_PORT}|" \
    -e "s|^POSTGRESQL_PASSWORD=.*|POSTGRESQL_PASSWORD=${NEW_PASS}|" \
    "${CHAT_ENV}"

  if ! grep -q '^POSTGRESQL_SSLMODE=' "${CHAT_ENV}"; then
    echo "POSTGRESQL_SSLMODE=${NEW_SSL}" >>"${CHAT_ENV}"
  fi

  echo "Updated ${CHAT_ENV}:"
  grep -E '^POSTGRESQL_' "${CHAT_ENV}" | sed 's/^/  /'
else
  echo "WARNING: ${CHAT_ENV} not found — chat bot may live elsewhere or use systemd Environment instead."
fi

echo
echo "=== Phase 5: reload systemd + restart both bots ==="
systemctl daemon-reload

if systemctl is-enabled --quiet hundlervpn-bot.service 2>/dev/null \
   || systemctl is-active  --quiet hundlervpn-bot.service 2>/dev/null; then
  systemctl restart hundlervpn-bot
  sleep 2
  systemctl --no-pager --lines=0 status hundlervpn-bot || true
fi

if systemctl is-enabled --quiet hundlervpn-bot-chat.service 2>/dev/null \
   || systemctl is-active  --quiet hundlervpn-bot-chat.service 2>/dev/null; then
  systemctl restart hundlervpn-bot-chat
  sleep 2
  systemctl --no-pager --lines=0 status hundlervpn-bot-chat || true
fi

echo
echo "=== Phase 6: short log tail to confirm no auth errors ==="
echo "--- hundlervpn-bot (last 15) ---"
journalctl -u hundlervpn-bot -n 15 --no-pager || true
echo
echo "--- hundlervpn-bot-chat (last 15) ---"
journalctl -u hundlervpn-bot-chat -n 15 --no-pager || true

echo
echo "=== Phase 7: db-tunnel.service ==="
if systemctl is-active --quiet "${TUNNEL_UNIT}" 2>/dev/null; then
  echo "${TUNNEL_UNIT} is still running. After both bots are confirmed healthy,"
  echo "  disable it with:"
  echo "    systemctl disable --now ${TUNNEL_UNIT}"
  echo "  (this script intentionally does NOT auto-disable the tunnel — keep it"
  echo "   as a safety net for the first 24h post-cutover.)"
else
  echo "${TUNNEL_UNIT} is inactive — nothing to do."
fi

echo
echo "=== Done. Backup of pre-migration configs: ${backup_dir} ==="
