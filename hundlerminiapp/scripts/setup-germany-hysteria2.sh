#!/bin/bash
# =============================================================================
# setup-germany-hysteria2.sh
#
# Phase-1 PILOT: install Hysteria2 on the Germany VPS (213.182.213.183) as a
# UDP-friendly transport ALONGSIDE the existing VLESS+Reality+WARP setup.
#
# Goal: make TG voice + Discord voice + WhatsApp voice work in RU networks
# where TSPU blocks UDP egress to TG reflectors. The client will (in Phase 2)
# route TG/voice traffic through this Hy2 inbound, while general TCP traffic
# keeps flowing through the existing VLESS+Reality :443 path.
#
# What this script does (idempotent — safe to re-run):
#   1. Install Hysteria2 binary via official installer (https://get.hy2.sh/)
#   2. Generate a random 32-byte hex auth password, cache in /etc/hysteria/.password
#   3. Generate a self-signed ECDSA P-256 cert (CN=de.hundlervpn.xyz, 100yr)
#      ⚠️  PILOT ONLY — switch to Let's Encrypt before opening to all users.
#   4. Write /etc/hysteria/config.yaml: UDP/8443, password auth, outbound
#      chained through existing WARP SOCKS5 on 127.0.0.1:40000, masquerade
#      cover to microsoft.com.
#   5. Enable+start hysteria-server.service (provided by the installer)
#   6. Open UFW UDP/8443
#   7. Print the credentials block (server, port, password, cert SHA256
#      fingerprint, sni) for plugging into a Hy2 client.
#
# Run AS ROOT on the DE VPS:
#   ssh root@213.182.213.183
#   curl -fsSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/setup-germany-hysteria2.sh | bash
#
# Or copy/paste:
#   cat > /tmp/hy2.sh   # paste this whole file
#   bash /tmp/hy2.sh
#
# After it runs successfully, verify locally on the VPS:
#   ss -lunp | grep :8443           # hysteria listening on UDP/8443
#   systemctl status hysteria-server
#   journalctl -u hysteria-server -n 30 --no-pager
# =============================================================================

set -euo pipefail

# ---- Config ----------------------------------------------------------------
HY2_PORT="${HY2_PORT:-8443}"
HY2_SNI="${HY2_SNI:-de.hundlervpn.xyz}"
HY2_DIR="/etc/hysteria"
HY2_CERT_DIR="${HY2_DIR}/cert"
HY2_PASSWORD_FILE="${HY2_DIR}/.password"
HY2_CONFIG="${HY2_DIR}/config.yaml"
# 2026-05-16: Hy2 теперь использует HTTP auth — на каждый client connection
# Hy2-server делает POST на этот URL с {addr, auth, tx}; backend валидирует
# sub-token и возвращает 200 ok | 200 ok=false. Это даёт мгновенное
# отключение Hy2 при истечении подписки / kick устройства (без рестарта Hy2).
HY2_AUTH_URL="${HY2_AUTH_URL:-https://hundlervpn.xyz/api/hysteria/auth}"
# 2026-05-16: Hy2 trafficStats API — слушает на 127.0.0.1, отдаёт per-user
# uplink/downlink. Используется /opt/hy2-traffic.sh для накопления статы
# в `user_server_traffic` (та же таблица что для VLESS). Secret рандомится
# и кэшируется как hy2-auth password.
HY2_TRAFFIC_PORT="${HY2_TRAFFIC_PORT:-7653}"
HY2_TRAFFIC_SECRET_FILE="${HY2_DIR}/.traffic-secret"
# ---------------------------------------------------------------------------
# NOTE: Hy2 outbound is DIRECT (= DE VPS IP 213.182.213.183), not chained
# through WARP. Reasons:
#   1. WARP-CLI SOCKS5 on 127.0.0.1:40000 is TCP-only (UDP ASSOCIATE through
#      Cloudflare WARP is unreliable); Hy2 traffic is QUIC/UDP so chaining
#      through it would silently drop most packets.
#   2. For TG voice, what we actually need is a CONSISTENT source-IP for both
#      TCP signaling and UDP voice (reflector NAT-match). Phase-2 client config
#      will route ENTIRE TG CIDR (TCP + UDP) through this Hy2 outbound, so
#      both come from the same DE VPS IP. NAT-match satisfied.
#   3. General (non-TG) traffic still uses VLESS+Reality+WARP path, so the
#      WARP anonymity is preserved for everything except voice.
# ---------------------------------------------------------------------------

log()  { echo -e "\n\033[1;34m[hy2]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*"; }
die()  { echo -e "\n\033[1;31m[fatal]\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must run as root"

# 1. Install Hysteria2 ------------------------------------------------------
if ! command -v hysteria >/dev/null 2>&1; then
  log "Installing Hysteria2 (official installer)…"
  bash <(curl -fsSL https://get.hy2.sh/)
else
  log "Hysteria2 already installed: $(hysteria version | head -n1)"
fi

# 2. Auth password (cache for re-runs) ---------------------------------------
mkdir -p "$HY2_DIR"
if [ ! -f "$HY2_PASSWORD_FILE" ]; then
  log "Generating new Hy2 auth password…"
  openssl rand -hex 16 > "$HY2_PASSWORD_FILE"
  chmod 600 "$HY2_PASSWORD_FILE"
else
  log "Re-using cached Hy2 auth password from $HY2_PASSWORD_FILE"
fi
HY2_PASSWORD="$(cat "$HY2_PASSWORD_FILE")"

# 2b. Traffic-stats secret (cache for re-runs) ------------------------------
if [ ! -f "$HY2_TRAFFIC_SECRET_FILE" ]; then
  log "Generating Hy2 trafficStats secret…"
  openssl rand -hex 16 > "$HY2_TRAFFIC_SECRET_FILE"
  chmod 600 "$HY2_TRAFFIC_SECRET_FILE"
else
  log "Re-using cached Hy2 trafficStats secret"
fi
HY2_TRAFFIC_SECRET="$(cat "$HY2_TRAFFIC_SECRET_FILE")"

# 3. Self-signed cert -------------------------------------------------------
mkdir -p "$HY2_CERT_DIR"
# 0750 (not 0700) so the `hysteria` system user (created by the official
# installer) can traverse into the dir and read cert.pem + key.pem at
# service start. We chown -R to hysteria below; until then 0750 keeps
# random world readers out while still allowing hysteria group access.
chmod 750 "$HY2_CERT_DIR"
if [ ! -f "${HY2_CERT_DIR}/cert.pem" ] || [ ! -f "${HY2_CERT_DIR}/key.pem" ]; then
  log "Generating self-signed ECDSA P-256 cert (CN=${HY2_SNI}, 100 yr)…"
  openssl req -x509 -newkey ec \
    -pkeyopt ec_paramgen_curve:prime256v1 \
    -nodes \
    -keyout "${HY2_CERT_DIR}/key.pem" \
    -out   "${HY2_CERT_DIR}/cert.pem" \
    -subj "/CN=${HY2_SNI}" \
    -days 36500 \
    -addext "subjectAltName=DNS:${HY2_SNI}"
  chmod 640 "${HY2_CERT_DIR}/key.pem"
  chmod 644 "${HY2_CERT_DIR}/cert.pem"
else
  log "Re-using existing cert in ${HY2_CERT_DIR}"
fi

# Compute SHA256 fingerprint for client pinning (better than insecure=true)
HY2_CERT_FP="$(openssl x509 -in "${HY2_CERT_DIR}/cert.pem" -noout -fingerprint -sha256 \
  | sed 's/.*=//' | tr -d ':' | tr 'A-F' 'a-f')"

# 4. Config -----------------------------------------------------------------
log "Writing ${HY2_CONFIG}…"
cat > "$HY2_CONFIG" <<EOF
# HundlerVPN Hysteria2 inbound (Germany)
# Generated by scripts/setup-germany-hysteria2.sh — do not hand-edit.

listen: :${HY2_PORT}

tls:
  cert: ${HY2_CERT_DIR}/cert.pem
  key:  ${HY2_CERT_DIR}/key.pem

# 2026-05-16: HTTP auth. На каждый new client connection Hy2 шлёт POST
# на backend URL с {addr, auth, tx} → backend валидирует sub-token юзера
# и активность подписки. При истечении подписки или kick устройства —
# backend возвращает 200 ok=false, юзер не пускается. Без рестарта Hy2.
#
# Старый "type: password" с одним глобальным паролем НЕ обеспечивал
# отключения юзеров при expire (один пароль на всех, никак не привязан
# к конкретному telegram_id). Сейчас каждый клиент пишет в auth свой
# sub-token — и это естественный per-user механизм.
auth:
  type: http
  http:
    url: ${HY2_AUTH_URL}
    insecure: false

# 2026-05-16: trafficStats API — слушает на 127.0.0.1 (НЕ выставляется
# наружу), отдаёт per-user uplink/downlink в JSON. Защищается shared
# secret (Bearer header). /opt/hy2-traffic.sh поллит этот API каждые 5 мин
# и шлёт байты в /api/xray/traffic (единая таблица user_server_traffic).
trafficStats:
  listen: 127.0.0.1:${HY2_TRAFFIC_PORT}
  secret: ${HY2_TRAFFIC_SECRET}

# Hy2 uses BBR-like congestion control by default; ignoreClientBandwidth
# tells the server to use BBR (model-based) instead of trusting the client's
# declared up/down values. Better for diverse client networks (mobile, RU
# operators with heavy loss).
ignoreClientBandwidth: true

# No outbounds: section = Hy2 uses default direct egress (DE VPS IP).
# See top-of-file comment for why we don't chain through WARP for the pilot.

# Masquerade: Hy2 listens on UDP, but if anyone probes the TLS handshake
# with a non-Hy2 client they get a fake proxy serving microsoft.com content.
# Provides anti-DPI cover so the listener doesn't look like an anomalous UDP
# service.
masquerade:
  type: proxy
  proxy:
    url: https://www.microsoft.com/
    rewriteHost: true
EOF
chmod 640 "$HY2_CONFIG"

# 4b. Ownership for the unprivileged hysteria daemon -------------------------
# The official installer drops privileges and runs hysteria-server.service as
# the dedicated `hysteria` system user. We need that user to be able to read
# /etc/hysteria/config.yaml + cert.pem + key.pem. chown -R to hysteria:hysteria
# is the simplest way; root can still write to these files on subsequent
# re-runs of this script regardless of ownership.
if id -u hysteria >/dev/null 2>&1; then
  log "Setting ownership: chown -R hysteria:hysteria $HY2_DIR"
  chown -R hysteria:hysteria "$HY2_DIR"
else
  warn "User 'hysteria' not found — Hy2 may have installed under a different"
  warn "user. Check 'systemctl cat hysteria-server.service' for the User= line"
  warn "and chown $HY2_DIR to that user manually."
fi

# 5. systemd service --------------------------------------------------------
# The official installer creates /etc/systemd/system/hysteria-server.service
# pointing at /etc/hysteria/config.yaml. Just (re)start it.
log "Reloading systemd + (re)starting hysteria-server.service…"
systemctl daemon-reload
systemctl enable hysteria-server.service >/dev/null 2>&1 || true
systemctl restart hysteria-server.service

sleep 2
if ! systemctl is-active --quiet hysteria-server.service; then
  echo
  echo "---- hysteria-server.service journal (last 30 lines) ----"
  journalctl -u hysteria-server.service -n 30 --no-pager || true
  die "hysteria-server.service failed to start — check journal above"
fi

# 6. Firewall ---------------------------------------------------------------
log "Opening UFW for UDP/${HY2_PORT}…"
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${HY2_PORT}/udp" >/dev/null 2>&1 || true
  ufw status verbose | grep -E "${HY2_PORT}/udp" || true
fi

# 7. Smoke test (optional) --------------------------------------------------
log "Smoke check: hysteria-server is running on UDP/${HY2_PORT}"
ss -lunp 2>/dev/null | grep -E ":${HY2_PORT}\b" || warn "ss didn't see :${HY2_PORT} — service may still be starting"

# ---- Output credentials ---------------------------------------------------
PUBLIC_IP="$(curl -fsSL https://api.ipify.org 2>/dev/null || echo '<UNKNOWN>')"

echo
echo "============================================================="
echo "  Hysteria2 installed on Germany VPS"
echo "============================================================="
echo "  Server IP   : ${PUBLIC_IP}"
echo "  Port (UDP)  : ${HY2_PORT}"
echo "  SNI         : ${HY2_SNI}    (self-signed)"
echo "  Auth        : HTTP -> ${HY2_AUTH_URL}"
echo "  Cert SHA256 : ${HY2_CERT_FP}"
echo "============================================================="
echo
echo "Auth: each user uses their OWN sub-token as Hy2 password. The Hy2"
echo "server calls ${HY2_AUTH_URL} on every connection to validate."
echo "The static '${HY2_PASSWORD}' password is no longer used (kept in"
echo "/etc/hysteria/.password as a backup if you ever revert)."
echo
echo "Smoke test backend auth-callback reachability from THIS host:"
echo
echo "  curl -fsS -X POST ${HY2_AUTH_URL} \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"addr\":\"smoke-test\",\"auth\":\"definitely-bad-token\",\"tx\":0}'"
echo "  # Expect: 200 OK with body  {\"ok\":false}"
echo
echo "Live tail Hy2 auth log:"
echo "  journalctl -u hysteria-server -f | grep -E 'auth|Auth'"
echo
echo "============================================================="
