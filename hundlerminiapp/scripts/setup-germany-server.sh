#!/bin/bash
# =============================================================================
# setup-germany-server.sh
#
# One-shot provisioning script for a new HundlerVPN exit server.
# Run AS ROOT on a clean Debian 11/12 or Ubuntu 22.04/24.04 box.
#
# What it does:
#   1. Installs Xray-core
#   2. Installs Cloudflare WARP in SOCKS5 proxy mode on 127.0.0.1:40000
#   3. Generates Reality keypair + shortId
#   4. Writes /usr/local/etc/xray/config.json (VLESS+Reality inbound,
#      WARP socks outbound, DNS direct, UDP blocked, TCP -> WARP)
#   5. Installs /opt/xray-sync.sh (pulls UUID pool from hundlervpn.xyz every 5min)
#   6. Installs /opt/xray-webhook.py + systemd service (port 9999, instant sync)
#   7. Opens UFW: 443/tcp + 9999/tcp
#   8. Starts everything and prints the DB INSERT SQL
#
# Usage on the new VPS:
#   curl -fsSL https://hundlervpn.xyz/scripts/setup-germany-server.sh | bash
# or
#   wget -O - https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/setup-germany-server.sh | bash
#
# Or paste manually (if the repo is private):
#   cat > /tmp/setup.sh   # paste the whole file
#   bash /tmp/setup.sh
# =============================================================================

set -euo pipefail

# ---- Config ----------------------------------------------------------------
SYNC_TOKEN="${SYNC_TOKEN:-hVpN2026sEcReT_xR4y}"
APP_URL="${APP_URL:-https://hundlervpn.xyz}"
SNI="${SNI:-www.microsoft.com}"
# Reality serverNames array — must include EVERY SNI any client could send.
# Client-side picks one per (user, server) from `lib/sub-token.ts` SNI_POOLS.default
# for foreign exits. Keep `www.microsoft.com` first for backward compat with
# clients that have cached older subscriptions (pre-2026-05-08).
SNI_POOL_JSON="${SNI_POOL_JSON:-[\"www.microsoft.com\", \"www.cloudflare.com\", \"www.apple.com\", \"www.tiktok.com\"]}"
REALITY_DEST="${REALITY_DEST:-www.microsoft.com:443}"
INBOUND_PORT="${INBOUND_PORT:-443}"
WEBHOOK_PORT="${WEBHOOK_PORT:-9999}"
# ---------------------------------------------------------------------------

log() { echo -e "\n\033[1;34m[setup]\033[0m $*"; }
die() { echo -e "\n\033[1;31m[fatal]\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must run as root"

# 1. Base packages ------------------------------------------------------------
log "Installing base packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget gnupg lsb-release ca-certificates \
  jq ufw python3 cron

# 1b. TCP BBR + fq qdisc -----------------------------------------------------
# BBR (Google, 2016) replaces CUBIC's loss-based congestion control with a
# model-based one that measures bottleneck bandwidth and min-RTT directly.
# On lossy mobile paths (typical RU operators + TSPU drops), BBR sustains
# 2-3x the throughput of CUBIC because it ignores transient packet loss as
# a congestion signal. `fq` (Fair Queue) is the pacing qdisc BBR relies on;
# without it BBR still works but pacing is bursty and degrades ~30 %. This
# takes effect for new TCP connections immediately after `sysctl -p` — no
# reboot, no Xray restart, safe to do before Xray is even installed.
# Idempotent: `grep -q` guards against duplicate lines on re-runs.
log "Enabling BBR + fq qdisc…"
grep -q "^net.core.default_qdisc=fq$" /etc/sysctl.conf \
  || echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf
grep -q "^net.ipv4.tcp_congestion_control=bbr$" /etc/sysctl.conf \
  || echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf
sysctl -p >/dev/null
if ! sysctl -n net.ipv4.tcp_congestion_control | grep -q '^bbr$'; then
  echo "[setup] WARNING: BBR not active after sysctl -p (kernel <4.9?); continuing"
fi

# 2. Xray-core ----------------------------------------------------------------
log "Installing Xray-core…"
bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install

# 3. Cloudflare WARP (SOCKS5 mode) -------------------------------------------
log "Installing Cloudflare WARP…"
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
  | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg

DISTRO_CODENAME="$(lsb_release -cs)"
echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ ${DISTRO_CODENAME} main" \
  > /etc/apt/sources.list.d/cloudflare-client.list

apt-get update -qq
apt-get install -y -qq cloudflare-warp

log "Registering & connecting WARP…"
warp-cli --accept-tos registration new       || true   # ok if already registered
warp-cli --accept-tos mode proxy             || true   # ok if already in this mode
warp-cli --accept-tos proxy port 40000       || true
warp-cli --accept-tos connect                || true   # ok if already connected

# Sanity: give warp a moment then test
sleep 3
if ! curl -fsS --socks5 127.0.0.1:40000 --max-time 10 https://www.cloudflare.com/cdn-cgi/trace/ | grep -q warp=on; then
  echo "[setup] WARNING: WARP SOCKS5 at 127.0.0.1:40000 not responding yet; continuing anyway"
fi

# 4. Generate Reality keys ---------------------------------------------------
log "Generating Reality keypair + shortId…"
KEYS_RAW="$(/usr/local/bin/xray x25519)"
PRIVATE_KEY="$(echo "$KEYS_RAW" | grep -i 'private' | awk '{print $NF}')"
PUBLIC_KEY="$(echo "$KEYS_RAW"  | grep -i 'public'  | awk '{print $NF}')"
SHORT_ID="$(openssl rand -hex 8)"

[ -n "$PRIVATE_KEY" ] && [ -n "$PUBLIC_KEY" ] || die "failed to parse xray x25519 output"

# 5. Xray config -------------------------------------------------------------
log "Writing /usr/local/etc/xray/config.json…"
install -d -m 0755 /usr/local/etc/xray
cat > /usr/local/etc/xray/config.json <<EOF
{
  "log": { "loglevel": "warning" },
  "api": {
    "tag": "api",
    "services": ["HandlerService", "LoggerService", "StatsService"]
  },
  "stats": {},
  "policy": {
    "levels": {
      "0": { "statsUserUplink": true, "statsUserDownlink": true }
    },
    "system": {
      "statsInboundUplink": true,
      "statsInboundDownlink": true,
      "statsOutboundUplink": true,
      "statsOutboundDownlink": true
    }
  },
  "inbounds": [
    {
      "tag": "api",
      "listen": "127.0.0.1",
      "port": 10085,
      "protocol": "dokodemo-door",
      "settings": { "address": "127.0.0.1" }
    },
    {
      "tag": "vless-in",
      "listen": "0.0.0.0",
      "port": ${INBOUND_PORT},
      "protocol": "vless",
      "settings": {
        "clients": [],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "${REALITY_DEST}",
          "xver": 0,
          "serverNames": ${SNI_POOL_JSON},
          "privateKey": "${PRIVATE_KEY}",
          "shortIds": ["${SHORT_ID}"]
        }
      },
      "sniffing": {
        "enabled": true,
        "destOverride": ["http", "tls"]
      }
    }
  ],
  "outbounds": [
    {
      "tag": "warp",
      "protocol": "socks",
      "settings": {
        "servers": [{ "address": "127.0.0.1", "port": 40000 }]
      }
    },
    { "tag": "direct", "protocol": "freedom" },
    { "tag": "block",  "protocol": "blackhole" }
  ],
  "routing": {
    "domainStrategy": "AsIs",
    "rules": [
      { "type": "field", "inboundTag": ["api"],          "outboundTag": "api" },
      { "type": "field", "port": 53, "network": "udp",   "outboundTag": "direct" },
      { "type": "field", "network": "udp",               "outboundTag": "block" },
      { "type": "field", "network": "tcp",               "outboundTag": "warp" }
    ]
  }
}
EOF

/usr/local/bin/xray -test -config /usr/local/etc/xray/config.json \
  || die "xray config validation failed"

# 6. Client sync script ------------------------------------------------------
log "Installing /opt/xray-sync.sh…"
cat > /opt/xray-sync.sh <<'SYNC'
#!/bin/bash
# xray-sync.sh — pulls UUID pool from HundlerVPN API and patches the clients
# array in the existing Xray config, restarting Xray only on diff.
set -euo pipefail

API_URL="__APP_URL__/api/xray/clients?token=__SYNC_TOKEN__"
XRAY_CONFIG="/usr/local/etc/xray/config.json"
INBOUND_TAG="vless-in"

RESPONSE=$(curl -sf --max-time 15 "$API_URL") \
  || { echo "[$(date -Iseconds)] ERROR: API fetch failed"; exit 1; }

OK=$(echo "$RESPONSE" | jq -r '.ok // false')
[ "$OK" = "true" ] || { echo "[$(date -Iseconds)] ERROR: API ok=false"; exit 1; }

NEW_CLIENTS=$(echo "$RESPONSE" | jq -c '[.clients[] | {id, flow, email}]')
NEW_COUNT=$(echo "$NEW_CLIENTS" | jq 'length')

OLD_CLIENTS=$(jq -c '[.inbounds[] | select(.tag=="'"$INBOUND_TAG"'") | .settings.clients[] | {id, flow, email}]' "$XRAY_CONFIG" 2>/dev/null || echo '[]')
OLD_COUNT=$(echo "$OLD_CLIENTS" | jq 'length')

# Sanity guard: refuse to apply a snapshot that would wipe most of the
# existing client list. The UUID pool is over-provisioned (~1000 entries),
# so any response with 0 clients or a sudden >50 % drop is a transient
# backend hiccup, NOT a real bulk expiration. Without this guard, a single
# bad response from /api/xray/clients during a backend deploy can flush
# Xray's accepted-clients list on every VPN node simultaneously (incident
# 2026-05-07 ~21:15 MSK: NL+DE+RU all went "no ping, no traffic" for ~5 min
# until the next cron tick recovered). Defence in depth — API endpoint is
# also hardened separately.
if [ "$NEW_COUNT" -lt 1 ]; then
  echo "[$(date -Iseconds)] SANITY: API returned 0 clients (was $OLD_COUNT). Refusing to wipe Xray."
  exit 1
fi
if [ "$OLD_COUNT" -gt 100 ] && [ "$NEW_COUNT" -lt $((OLD_COUNT / 2)) ]; then
  echo "[$(date -Iseconds)] SANITY: API returned $NEW_COUNT clients, was $OLD_COUNT (>50% drop). Refusing."
  exit 1
fi

# Restart-relevant diff: ONLY uuid + flow.
# Email is re-labelled on every signup (`pool-N` -> `tg-{tid}-s{sid}`)
# for traffic accounting. Including email caused a full Xray restart
# every cron tick, dropping every active TCP session and showing as
# "Ping N/A" / unstable connection in clients. We now restart ONLY
# when the actual UUID list changes (pool refill, orphan purge, key
# revocation). Label-only diffs are written to disk silently and
# take effect at the next genuine restart.
OLD_KEYSET=$(echo "$OLD_CLIENTS" | jq -cS '.|sort_by(.id)|map({id, flow})')
NEW_KEYSET=$(echo "$NEW_CLIENTS" | jq -cS '.|sort_by(.id)|map({id, flow})')
OLD_FULL=$(echo "$OLD_CLIENTS" | jq -cS '.|sort_by(.id)')
NEW_FULL=$(echo "$NEW_CLIENTS" | jq -cS '.|sort_by(.id)')

# Xray v26 determines config format from the file extension and rejects
# anything it doesn't recognize. `.tmp` is rejected with
#   "Failed to get format of <path>"
# so we keep the `.json` extension on the temp file.
TMP="${XRAY_CONFIG%.json}.new.json"

if [ "$OLD_KEYSET" = "$NEW_KEYSET" ]; then
  if [ "$OLD_FULL" = "$NEW_FULL" ]; then
    echo "[$(date -Iseconds)] no changes ($NEW_COUNT clients)"
    exit 0
  fi

  # Labels changed only — update config silently, NO restart.
  # See xray-sync.sh comment re: --slurpfile vs --argjson + ARG_MAX.
  jq --slurpfile clients <(printf '%s' "$NEW_CLIENTS") \
    '(.inbounds[] | select(.tag=="'"$INBOUND_TAG"'") | .settings.clients) = $clients[0]' \
    "$XRAY_CONFIG" > "$TMP"

  if ! /usr/local/bin/xray -test -config "$TMP" >/dev/null 2>&1; then
    echo "[$(date -Iseconds)] ERROR: relabelled config invalid, aborting (no restart)"
    /usr/local/bin/xray -test -config "$TMP" 2>&1 | tail -5 || true
    rm -f "$TMP"
    exit 1
  fi

  mv "$TMP" "$XRAY_CONFIG"
  echo "[$(date -Iseconds)] labels updated, no restart ($NEW_COUNT clients)"
  exit 0
fi

# UUID set actually changed — must restart.
jq --slurpfile clients <(printf '%s' "$NEW_CLIENTS") \
  '(.inbounds[] | select(.tag=="'"$INBOUND_TAG"'") | .settings.clients) = $clients[0]' \
  "$XRAY_CONFIG" > "$TMP"

if ! /usr/local/bin/xray -test -config "$TMP" >/dev/null 2>&1; then
  echo "[$(date -Iseconds)] ERROR: new config invalid, aborting"
  /usr/local/bin/xray -test -config "$TMP" 2>&1 | tail -5 || true
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$XRAY_CONFIG"
systemctl restart xray
echo "[$(date -Iseconds)] restarted: clients changed ($NEW_COUNT clients)"
SYNC

# Inject real URL + token (avoids heredoc quoting issues)
sed -i "s|__APP_URL__|${APP_URL}|g" /opt/xray-sync.sh
sed -i "s|__SYNC_TOKEN__|${SYNC_TOKEN}|g" /opt/xray-sync.sh
chmod +x /opt/xray-sync.sh

# Cron every 5 min, with log. Safe against empty crontab + pipefail:
# `crontab -l` on a fresh system exits 1, which would otherwise abort the
# whole pipeline under `set -o pipefail`.
touch /var/log/xray-sync.log
{
  crontab -l 2>/dev/null | grep -v 'xray-sync.sh' || true
  echo "*/5 * * * * /opt/xray-sync.sh >> /var/log/xray-sync.log 2>&1"
} | crontab -

# 7. Webhook -----------------------------------------------------------------
log "Installing /opt/xray-webhook.py…"
cat > /opt/xray-webhook.py <<'WEBHOOK'
#!/usr/bin/env python3
"""Tiny HTTP endpoint that triggers /opt/xray-sync.sh on demand.

POST /sync?token=$SYNC_TOKEN          -> runs sync SYNCHRONOUSLY (returns after sync)
POST /sync?token=$SYNC_TOKEN&async=1  -> spawns sync ASYNC and returns 202 immediately
GET  /health                          -> 200 {"ok":true}
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os, subprocess, sys

SYNC_TOKEN  = os.environ.get("SYNC_TOKEN", "")
SYNC_SCRIPT = os.environ.get("SYNC_SCRIPT", "/opt/xray-sync.sh")
LISTEN_HOST = os.environ.get("LISTEN_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "9999"))
LOG_FILE    = os.environ.get("LOG_FILE", "/var/log/xray-sync.log")

if not SYNC_TOKEN:
    print("FATAL: SYNC_TOKEN env is required", file=sys.stderr)
    sys.exit(1)

def _parse_query(q: str):
    out = {}
    for pair in q.split("&"):
        if "=" in pair:
            k, v = pair.split("=", 1); out[k] = v
    return out

class Handler(BaseHTTPRequestHandler):
    server_version = "xray-webhook/1.1"

    def _respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write((body + "\n").encode())

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/health":
            return self._respond(200, '{"ok":true}')
        return self._respond(404, '{"error":"not found"}')

    def do_POST(self):
        parts = self.path.split("?", 1)
        path, query = parts[0], (parts[1] if len(parts) > 1 else "")
        if path != "/sync":
            return self._respond(404, '{"error":"not found"}')
        params = _parse_query(query)
        if params.get("token") != SYNC_TOKEN:
            return self._respond(403, '{"error":"forbidden"}')

        if params.get("async") == "1":
            try:
                with open(LOG_FILE, "a") as f:
                    f.write(f"[webhook] async from {self.client_address[0]}\n")
                    subprocess.Popen([SYNC_SCRIPT], stdout=f, stderr=subprocess.STDOUT, close_fds=True)
            except Exception as exc:
                return self._respond(500, f'{{"error":"spawn failed: {exc}"}}')
            return self._respond(202, '{"ok":true,"queued":true}')

        try:
            rc = subprocess.call([SYNC_SCRIPT], stdout=open(LOG_FILE, "a"),
                                 stderr=subprocess.STDOUT, close_fds=True)
            return self._respond(200 if rc == 0 else 500,
                                 f'{{"ok":{ "true" if rc == 0 else "false" },"rc":{rc}}}')
        except Exception as exc:
            return self._respond(500, f'{{"error":"run failed: {exc}"}}')

    def log_message(self, format, *args):
        sys.stderr.write("[%s] %s - %s\n" %
            (self.log_date_time_string(), self.client_address[0], format % args))

def main():
    srv = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f"xray-webhook listening on {LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    try: srv.serve_forever()
    except KeyboardInterrupt: srv.shutdown()

if __name__ == "__main__":
    main()
WEBHOOK
chmod +x /opt/xray-webhook.py

cat > /etc/systemd/system/xray-webhook.service <<EOF
[Unit]
Description=Xray sync webhook
After=network.target xray.service
Wants=xray.service

[Service]
Type=simple
Environment=SYNC_TOKEN=${SYNC_TOKEN}
Environment=SYNC_SCRIPT=/opt/xray-sync.sh
Environment=LISTEN_HOST=0.0.0.0
Environment=LISTEN_PORT=${WEBHOOK_PORT}
Environment=LOG_FILE=/var/log/xray-sync.log
ExecStart=/usr/bin/python3 /opt/xray-webhook.py
Restart=always
RestartSec=5
User=root
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now xray-webhook.service

# 7.5. WARP watchdog ---------------------------------------------------------
# Cloudflare WARP-svc occasionally enters a "Connected, healthy" zombie
# state where the SOCKS5 listener on 127.0.0.1:40000 returns
# "Can't complete SOCKS5 connection (4) Host unreachable" for every
# request — even though `warp-cli status` says everything is fine.
# Reproduced on DE 2026-05-06 after ~2 days uptime (MASQUE protocol).
# The only known recovery is `systemctl restart warp-svc`, so we run a
# tiny watchdog every minute that probes SOCKS5 and restarts the daemon
# if two consecutive probes fail. Cooldown is 10 minutes between restarts
# to prevent a fundamentally-broken WARP from getting hammered. Log file
# stays empty in healthy steady state.
log "Installing /opt/warp-watchdog.sh…"
cat > /opt/warp-watchdog.sh <<'WATCHDOG'
#!/bin/bash
set -euo pipefail
LOG=/var/log/warp-watchdog.log
LOCK=/var/run/warp-watchdog.lock
COOLDOWN_FILE=/var/run/warp-watchdog.cooldown
COOLDOWN_SEC=600
PROBE_URL=https://www.cloudflare.com/cdn-cgi/trace
PROBE_TIMEOUT=5

exec 9>"$LOCK"
flock -n 9 || exit 0

now_ts=$(date +%s)
if [ -f "$COOLDOWN_FILE" ]; then
  last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  if [ -n "$last" ] && [ "$((now_ts - last))" -lt "$COOLDOWN_SEC" ]; then
    exit 0
  fi
fi

probe() {
  curl --fail --silent --show-error --max-time "$PROBE_TIMEOUT" \
       --socks5 127.0.0.1:40000 "$PROBE_URL" 2>/dev/null \
    | grep -q '^warp=on$'
}

if probe; then exit 0; fi
sleep 3
if probe; then exit 0; fi

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
  fi
} >> "$LOG" 2>&1

echo "$now_ts" > "$COOLDOWN_FILE"
WATCHDOG
chmod +x /opt/warp-watchdog.sh
touch /var/log/warp-watchdog.log

# Cron every 1 minute (idempotent — strips any old entry first).
{
  crontab -l 2>/dev/null | grep -v 'warp-watchdog.sh' || true
  echo "* * * * * /opt/warp-watchdog.sh"
} | crontab -

# 8. Firewall ----------------------------------------------------------------
log "Opening firewall ports…"
ufw --force reset >/dev/null 2>&1 || true
ufw allow OpenSSH           >/dev/null
ufw allow ${INBOUND_PORT}/tcp  >/dev/null
ufw allow ${WEBHOOK_PORT}/tcp  >/dev/null
ufw --force enable          >/dev/null

# 9. Start Xray + initial sync -----------------------------------------------
log "Enabling & restarting xray…"
systemctl enable --now xray.service
systemctl restart xray

log "Running initial client sync (non-fatal if it fails)…"
if ! /opt/xray-sync.sh; then
  echo "[setup] WARNING: initial sync failed; check /var/log/xray-sync.log"
  echo "[setup] It will retry via cron every 5 min and via webhook on demand."
fi

# 10. Done -------------------------------------------------------------------
PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"

cat <<DONE

===========================================================
  HundlerVPN Germany node provisioned successfully
===========================================================

Server IP          : ${PUBLIC_IP}
Xray inbound port  : ${INBOUND_PORT}
Webhook port       : ${WEBHOOK_PORT}
Reality SNI        : ${SNI}
Reality dest       : ${REALITY_DEST}

Reality PUBLIC KEY : ${PUBLIC_KEY}
Reality SHORT ID   : ${SHORT_ID}

---- NEXT STEPS ----

1) Add the server to the HundlerVPN database by running this SQL
   (on any psql client connected to the Timeweb DB):

INSERT INTO servers
  (name, host, port, country, public_key, sni, short_id, fingerprint, flow, is_active)
VALUES
  -- 2026-05-09 (XUDP migration, v60): flow column is empty by default so
  -- VLESS+Reality runs without xtls-rprx-vision. UDP rides via XUDP packet
  -- encoding inside the same TCP/443 Reality stream. See migrate-vision-to-xudp.js
  -- for full migration notes.
  ('Pro', '${PUBLIC_IP}', ${INBOUND_PORT}, 'DE',
   '${PUBLIC_KEY}', '${SNI}', '${SHORT_ID}',
   'chrome', '', TRUE);

2) In Timeweb environment variables, update XRAY_WEBHOOK_URL so the
   main API fans out device-kick webhooks to BOTH servers:

XRAY_WEBHOOK_URL=http://185.238.169.235:9999/sync,http://${PUBLIC_IP}:${WEBHOOK_PORT}/sync

3) Verify:
   curl -sf http://${PUBLIC_IP}:${WEBHOOK_PORT}/health
   curl -sf ${APP_URL}/api/xray/clients?token=${SYNC_TOKEN} | jq '.clients | length'
   systemctl status xray xray-webhook

Subscriptions will start returning this server automatically once
the DB row is inserted (the /api/sub/[token] endpoint reads all
is_active=true servers).
===========================================================
DONE
