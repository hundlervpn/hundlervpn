#!/bin/bash
# =============================================================================
# setup-rf-server.sh
#
# Provisions a HundlerVPN exit server inside the Russian Federation.
#
# Goal differs from the foreign exit nodes (NL / DE):
#   * The whole point of an RF node is for the upstream service to see a
#     RUSSIAN IP — for accessing RU-only services (Gosuslugi, Sber,
#     Yandex), and for letting the user piggy-back on whatever YouTube
#     anti-throttle routes the host's transit happens to use.
#   * Therefore: NO Cloudflare WARP. Outbound is `freedom` (direct).
#   * To still trim banner ads, trackers, and a meaningful chunk of
#     YouTube ad domains, we point both the system resolver AND Xray's
#     own DNS at AdGuard's ad-blocking DNS, and add a routing rule that
#     drops the entire `geosite:category-ads-all` set into the blackhole
#     outbound for any traffic flowing through the VLESS tunnel.
#
# What it does (resembles setup-germany-server.sh, minus WARP):
#   1. Installs Xray-core
#   2. Sets system DNS to AdGuard DNS (94.140.14.14, 94.140.15.15)
#   3. Generates Reality keypair + shortId
#   4. Writes /usr/local/etc/xray/config.json with
#        - VLESS+Reality inbound on 443
#        - dns block -> AdGuard
#        - freedom (direct) outbound
#        - blackhole outbound
#        - routing rule: geosite:category-ads-all -> block
#        - routing rule: udp (except :53) -> block, tcp -> direct
#   5. Installs /opt/xray-sync.sh (pulls UUID pool every 5 min, diff-restart)
#   6. Installs /opt/xray-webhook.py + systemd service (port 9999)
#   7. Opens UFW: 443/tcp + 9999/tcp
#   8. Starts everything and prints the DB INSERT SQL
#
# Usage on the new VPS (as root):
#   curl -fsSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/setup-rf-server.sh | bash
# or
#   wget -O /tmp/setup.sh https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/setup-rf-server.sh
#   bash /tmp/setup.sh
# =============================================================================

set -euo pipefail

# ---- Config ----------------------------------------------------------------
SYNC_TOKEN="${SYNC_TOKEN:-hVpN2026sEcReT_xR4y}"
APP_URL="${APP_URL:-https://hundlervpn.xyz}"
SNI="${SNI:-www.microsoft.com}"
# Reality serverNames array — must include EVERY SNI any client could send.
# Client-side picks one per (user, server) from `lib/sub-token.ts` SNI_POOLS.RU
# for the Russian exit. The list is RU CDN domains so the (RU IP, SNI) pair
# stays plausible vs DPI heuristics. Keep `www.microsoft.com` first for
# backward compat with clients that have cached older subscriptions (pre-2026-05-08).
SNI_POOL_JSON="${SNI_POOL_JSON:-[\"www.microsoft.com\", \"yastatic.net\", \"storage.yandex.net\", \"vk.com\"]}"
REALITY_DEST="${REALITY_DEST:-www.microsoft.com:443}"
INBOUND_PORT="${INBOUND_PORT:-443}"
WEBHOOK_PORT="${WEBHOOK_PORT:-9999}"
SERVER_NAME="${SERVER_NAME:-YT}"
SERVER_COUNTRY="${SERVER_COUNTRY:-RU}"
# AdGuard DNS — drops trackers and banner ads, kills a chunk of YouTube
# ad endpoints (doubleclick.net, googlesyndication.com etc).
DNS_PRIMARY="${DNS_PRIMARY:-94.140.14.14}"
DNS_SECONDARY="${DNS_SECONDARY:-94.140.15.15}"
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

# 2. System DNS -> AdGuard ---------------------------------------------------
# We override /etc/resolv.conf so any process on the box (including Xray's
# freedom outbound when it does name resolution via Go's net.Dial) hits
# AdGuard's ad-blocking resolver. Disable systemd-resolved if present so it
# doesn't reset the file on next boot.
log "Pointing system DNS at AdGuard (${DNS_PRIMARY}, ${DNS_SECONDARY})…"
if systemctl list-unit-files 2>/dev/null | grep -q '^systemd-resolved\.service'; then
  systemctl disable --now systemd-resolved.service >/dev/null 2>&1 || true
fi
# Idempotent re-run safety: a previous (possibly partial) run may have set
# the immutable bit on /etc/resolv.conf. Clear it first, otherwise the
# heredoc below fails with "Operation not permitted".
chattr -i /etc/resolv.conf 2>/dev/null || true
# Drop any symlink first (resolvconf / systemd-resolved) — we want a real file.
[ -L /etc/resolv.conf ] && rm -f /etc/resolv.conf
cat > /etc/resolv.conf <<EOF
# Managed by setup-rf-server.sh — AdGuard DNS for system + Xray.
nameserver ${DNS_PRIMARY}
nameserver ${DNS_SECONDARY}
options timeout:2 attempts:2
EOF
# Make it immutable so apt / cloud-init / netplan can't silently flip it
# back to ISP DNS on the next reboot.
chattr +i /etc/resolv.conf 2>/dev/null || true

# 3. Xray-core ----------------------------------------------------------------
# We avoid the official Xray-install installer here because its `.dgst`
# verification step routinely hangs from Russian transit (we've seen the
# zip download succeed at 800-900 KB/s and then `Downloading verification
# file…` stall indefinitely). Manual install: download the release zip
# with a hard --max-time, unzip the binary + geo data, drop a minimal
# systemd unit. Idempotent — skipped entirely if /usr/local/bin/xray
# already exists from a prior partial run.
XRAY_VERSION="${XRAY_VERSION:-v26.3.27}"

install_xray_manual() {
  local rel_path="XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-64.zip"
  # Try mirrors first — github.com release downloads are routinely throttled
  # from Russian transit, and the *.dgst verification step in the official
  # installer hangs indefinitely as a result. The Chinese GitHub proxies
  # (ghfast.top, gh-proxy.com, hub.gitmirror.com) reliably serve the same
  # release artefacts from CDN edges that ARE reachable from RU. Direct
  # github.com is the LAST fallback, with --max-time so we don't hang
  # forever the way the official installer does.
  local urls=(
    "https://ghfast.top/https://github.com/${rel_path}"
    "https://gh-proxy.com/https://github.com/${rel_path}"
    "https://hub.gitmirror.com/https://github.com/${rel_path}"
    "https://github.com/${rel_path}"
  )
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  log "Downloading Xray ${XRAY_VERSION} (manual, no dgst)…"
  local got=0
  for u in "${urls[@]}"; do
    echo "[setup]   trying $u"
    if curl -fL --max-time 180 --connect-timeout 10 \
            "$u" -o "${tmp_dir}/xray.zip" 2>&1 | tail -2; then
      if [ -s "${tmp_dir}/xray.zip" ]; then
        got=1
        echo "[setup]   ok ($(stat -c%s "${tmp_dir}/xray.zip") bytes from $u)"
        break
      fi
    fi
    rm -f "${tmp_dir}/xray.zip"
  done
  if [ "$got" -ne 1 ]; then
    rm -rf "$tmp_dir"
    return 1
  fi
  apt-get install -y -qq unzip >/dev/null 2>&1 || true
  if ! unzip -qo "${tmp_dir}/xray.zip" -d "${tmp_dir}/x"; then
    rm -rf "$tmp_dir"
    return 1
  fi
  install -d -m 0755 /usr/local/bin /usr/local/share/xray /usr/local/etc/xray
  install -m 0755 "${tmp_dir}/x/xray"         /usr/local/bin/xray
  install -m 0644 "${tmp_dir}/x/geoip.dat"    /usr/local/share/xray/geoip.dat
  install -m 0644 "${tmp_dir}/x/geosite.dat"  /usr/local/share/xray/geosite.dat
  cat > /etc/systemd/system/xray.service <<'UNIT'
[Unit]
Description=Xray Service
Documentation=https://github.com/XTLS/Xray-core
After=network.target nss-lookup.target

[Service]
User=root
ExecStart=/usr/local/bin/xray run -config /usr/local/etc/xray/config.json
Restart=on-failure
RestartPreventExitStatus=23
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  rm -rf "$tmp_dir"
  return 0
}

if [ -x /usr/local/bin/xray ] && /usr/local/bin/xray version >/dev/null 2>&1; then
  log "Xray already installed ($(/usr/local/bin/xray version | head -1)); skipping."
else
  log "Installing Xray-core…"
  if ! install_xray_manual; then
    log "Manual install failed; falling back to official installer (may hang on .dgst)…"
    timeout 180 bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install \
      || die "both manual and official Xray installers failed"
  fi
fi

[ -x /usr/local/bin/xray ] || die "/usr/local/bin/xray missing after install step"

# 4. Reality keys (persistent across re-runs) -------------------------------
# Re-running this script must NOT rotate the Reality keypair — the DB row
# created via add-rf-server.js (or the equivalent INSERT) caches the public
# key, and any clients with cached subscriptions hold the old keys too. If
# we regenerated on every run, even an unrelated re-run (e.g. to fix a
# DNS config) would break every existing client.
#
# Cache the keypair + shortId in /usr/local/etc/xray/.reality-keys on disk;
# only generate fresh values if the cache file is missing or unreadable.
KEYS_FILE="/usr/local/etc/xray/.reality-keys"
install -d -m 0755 /usr/local/etc/xray

if [ -s "$KEYS_FILE" ] && grep -q '^PRIVATE_KEY=' "$KEYS_FILE" \
                       && grep -q '^PUBLIC_KEY='  "$KEYS_FILE" \
                       && grep -q '^SHORT_ID='   "$KEYS_FILE"; then
  log "Re-using cached Reality keypair from ${KEYS_FILE} (re-run safe)…"
  # shellcheck disable=SC1090
  . "$KEYS_FILE"
else
  log "Generating Reality keypair + shortId (first run on this VPS)…"
  KEYS_RAW="$(/usr/local/bin/xray x25519)"
  PRIVATE_KEY="$(echo "$KEYS_RAW" | grep -i 'private' | awk '{print $NF}')"
  PUBLIC_KEY="$(echo "$KEYS_RAW"  | grep -i 'public'  | awk '{print $NF}')"
  SHORT_ID="$(openssl rand -hex 8)"
  [ -n "$PRIVATE_KEY" ] && [ -n "$PUBLIC_KEY" ] || die "failed to parse xray x25519 output"
  umask 077
  cat > "$KEYS_FILE" <<KEYS
# setup-rf-server.sh — cached Reality keys for this VPS.
# Delete this file ONLY if you intentionally want to rotate keys
# (will require updating the corresponding servers row in the DB).
PRIVATE_KEY=${PRIVATE_KEY}
PUBLIC_KEY=${PUBLIC_KEY}
SHORT_ID=${SHORT_ID}
KEYS
  chmod 0600 "$KEYS_FILE"
fi

[ -n "$PRIVATE_KEY" ] && [ -n "$PUBLIC_KEY" ] && [ -n "$SHORT_ID" ] \
  || die "Reality keys missing after init"

# 5. Xray config -------------------------------------------------------------
# Routing intent (server-side, not client-side):
#   * inbound 'api'                     -> api outbound (xray stats)
#   * dns-inbound / port-53 traffic     -> dns-out (Xray's own resolver,
#                                          which uses plain AdGuard DNS and
#                                          applies the nalog.ru host overrides)
#   * BitTorrent protocol               -> block (anti-abuse on RU IP)
#   * geosite:category-ads-all          -> block (banner/tracking ads,
#                                          including chunks of YouTube ads)
#   * geosite:category-ads              -> block (smaller, classic list)
#   * geoip:private                     -> block (no LAN pivoting via the VPS)
#   * everything else (TCP and UDP)     -> direct (RU IP exit)
#
# Note: geosite:torrent and geosite:win-spy are deliberately NOT used here.
# They only exist in the Loyalsoldier extended geosite.dat fork; the
# stock xray-core geosite.dat shipped with the official zip does NOT have
# these categories (Xray refuses to start with "code not found in
# geosite.dat: TORRENT" if you reference them). BitTorrent is already
# blocked at the protocol-detection layer above, so the domain block was
# redundant; Windows telemetry is nice-to-have but not critical, and
# adding the Loyalsoldier dat would mean another GitHub download from RU
# which is unreliable enough that we'd rather not depend on it for
# the core install path.
#
# UDP is NOT blocked: YouTube/HTTP3 (QUIC) needs UDP, and we have no WARP
# bottleneck here so direct UDP is fine. (germany script blocks UDP because
# WARP's SOCKS5 only carries TCP.)
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
  "dns": {
    "hosts": {
      "lkfl2.nalog.ru": "213.24.64.175",
      "lknpd.nalog.ru": "213.24.64.181"
    },
    "queryStrategy": "UseIPv4",
    "servers": [
      "${DNS_PRIMARY}",
      "${DNS_SECONDARY}"
    ]
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
        "destOverride": ["http", "tls", "quic"]
      }
    }
  ],
  "outbounds": [
    {
      "tag": "direct",
      "protocol": "freedom",
      "settings": { "domainStrategy": "ForceIPv4" }
    },
    { "tag": "block",   "protocol": "blackhole" },
    { "tag": "dns-out", "protocol": "dns" }
  ],
  "routing": {
    "domainStrategy": "AsIs",
    "rules": [
      { "type": "field", "inboundTag": ["api"],                                                       "outboundTag": "api"    },
      { "type": "field", "port": 53,                                                                   "outboundTag": "dns-out" },
      { "type": "field", "protocol": ["bittorrent"],                                                  "outboundTag": "block"  },
      { "type": "field", "domain": ["geosite:category-ads-all", "geosite:category-ads"],            "outboundTag": "block"  },
      { "type": "field", "ip": ["geoip:private"],                                                     "outboundTag": "block"  },
      { "type": "field", "network": "tcp,udp",                                                        "outboundTag": "direct" }
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

# Sanity guard: refuse to wipe the Xray client list on a transient backend
# hiccup. See incident 2026-05-07 ~21:15 MSK — empty /api/xray/clients
# response during a Hostman deploy briefly killed all 3 nodes' Xray client
# pools simultaneously. Pool is ~1000 entries steady-state; 0 clients or
# a >50 % drop is never legitimate.
if [ "$NEW_COUNT" -lt 1 ]; then
  echo "[$(date -Iseconds)] SANITY: API returned 0 clients (was $OLD_COUNT). Refusing to wipe Xray."
  exit 1
fi
if [ "$OLD_COUNT" -gt 100 ] && [ "$NEW_COUNT" -lt $((OLD_COUNT / 2)) ]; then
  echo "[$(date -Iseconds)] SANITY: API returned $NEW_COUNT clients, was $OLD_COUNT (>50% drop). Refusing."
  exit 1
fi

# Restart only when the actual UUID set changes; label-only diffs (pool-N -> tg-…)
# are written silently and take effect at the next genuine restart.
OLD_KEYSET=$(echo "$OLD_CLIENTS" | jq -cS '.|sort_by(.id)|map({id, flow})')
NEW_KEYSET=$(echo "$NEW_CLIENTS" | jq -cS '.|sort_by(.id)|map({id, flow})')
OLD_FULL=$(echo "$OLD_CLIENTS" | jq -cS '.|sort_by(.id)')
NEW_FULL=$(echo "$NEW_CLIENTS" | jq -cS '.|sort_by(.id)')

TMP="${XRAY_CONFIG%.json}.new.json"

if [ "$OLD_KEYSET" = "$NEW_KEYSET" ]; then
  if [ "$OLD_FULL" = "$NEW_FULL" ]; then
    echo "[$(date -Iseconds)] no changes ($NEW_COUNT clients)"
    exit 0
  fi
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

sed -i "s|__APP_URL__|${APP_URL}|g" /opt/xray-sync.sh
sed -i "s|__SYNC_TOKEN__|${SYNC_TOKEN}|g" /opt/xray-sync.sh
chmod +x /opt/xray-sync.sh

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

# 10. Verify outbound is the local Russian IP --------------------------------
log "Sanity: verifying outbound IP (no WARP -> should be a Russian IP)…"
PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
GEO_JSON="$(curl -fsS --max-time 5 "https://ipinfo.io/${PUBLIC_IP}/json" 2>/dev/null || echo '{}')"
GEO_COUNTRY="$(echo "$GEO_JSON" | jq -r '.country // "?"' 2>/dev/null || echo '?')"
echo "[setup] Public IP : ${PUBLIC_IP}"
echo "[setup] Geo       : ${GEO_COUNTRY}"
if [ "$GEO_COUNTRY" != "RU" ] && [ "$GEO_COUNTRY" != "?" ]; then
  echo "[setup] WARNING: outbound IP geo is '${GEO_COUNTRY}', expected 'RU'."
  echo "[setup] If the host is NOT physically in Russia, this server won't serve"
  echo "[setup] its purpose (RU IP for the user). Continuing anyway."
fi

# 11. Done -------------------------------------------------------------------
cat <<DONE

===========================================================
  HundlerVPN RF (${SERVER_COUNTRY}) node provisioned
===========================================================

Server IP          : ${PUBLIC_IP}
Geo (ipinfo)       : ${GEO_COUNTRY}
Xray inbound port  : ${INBOUND_PORT}
Webhook port       : ${WEBHOOK_PORT}
Reality SNI        : ${SNI}
Reality dest       : ${REALITY_DEST}
DNS upstream       : ${DNS_PRIMARY}, ${DNS_SECONDARY} (AdGuard, ad-blocking)

Reality PUBLIC KEY : ${PUBLIC_KEY}
Reality SHORT ID   : ${SHORT_ID}

---- NEXT STEPS ----

1) Add the server to the HundlerVPN database (psql to Timeweb):

INSERT INTO servers
  (name, host, port, country, public_key, sni, short_id, fingerprint, flow, is_active, sort_order)
VALUES
  -- 2026-05-09 (XUDP migration, v60): flow column empty (no xtls-rprx-vision).
  -- VLESS+Reality + XUDP packet encoding carries UDP through the same
  -- TCP/443 Reality stream so TG voice / Discord / WhatsApp UDP work.
  ('${SERVER_NAME}', '${PUBLIC_IP}', ${INBOUND_PORT}, '${SERVER_COUNTRY}',
   '${PUBLIC_KEY}', '${SNI}', '${SHORT_ID}',
   'chrome', '', TRUE, 3);

2) In Timeweb env vars, append this server's webhook to XRAY_WEBHOOK_URL
   (comma-separated). Existing value:
   http://185.238.169.235:9999/sync,http://213.182.213.183:9999/sync

   New value (just append):
XRAY_WEBHOOK_URL=http://185.238.169.235:9999/sync,http://213.182.213.183:9999/sync,http://${PUBLIC_IP}:${WEBHOOK_PORT}/sync

3) Verify:
   curl -sf http://${PUBLIC_IP}:${WEBHOOK_PORT}/health
   curl -sf ${APP_URL}/api/xray/clients?token=${SYNC_TOKEN} | jq '.clients | length'
   systemctl status xray xray-webhook
   # From your phone with the new server selected, open
   # https://ipinfo.io/json — country should read "RU".

Subscriptions will start returning this server automatically once
the DB row is inserted (the /api/sub/[token] endpoint reads all
is_active=true servers ordered by sort_order ASC).
===========================================================
DONE
