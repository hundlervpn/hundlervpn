#!/bin/bash
# =============================================================================
# migrate-server-to-xudp.sh
#
# Server-side patch for existing VPN nodes (DE/NL/RU) when migrating from
# VLESS+Reality+xtls-rprx-vision -> VLESS+Reality+XUDP.
#
# Run AS ROOT on each VPN VPS that pre-dates 2026-05-09.
#
# What it does (idempotent — safe to re-run):
#   1. Patches /opt/xray-sync.sh: removes the literal `flow=xtls-rprx-vision`
#      from the placeholder client (keeps line valid JSON).
#   2. Forces an immediate sync run so /usr/local/etc/xray/config.json is
#      regenerated against the new /api/xray/clients output (which already
#      returns flow="" if the DB-side migrate-vision-to-xudp.js was run).
#   3. Adds a server-side Xray routing rule: TG-CIDR -> freedom (direct).
#      Why: with XUDP, TG UDP arrives at the VPS via VLESS. Default outbound
#      on DE/NL is the WARP SOCKS5 cascade (TCP-only — UDP fails). On RU it's
#      already freedom direct, so the rule is a no-op there. The rule routes
#      TG (TCP signaling AND UDP voice) past WARP, sending both flows from
#      the VPS's own IPv4 address. NAT-match satisfied = TG voice connects.
#   4. Validates config (`xray -test`) before applying.
#   5. Restarts xray. Auto-rolls-back if restart fails.
#
# Run:
#   ssh root@<VPN_NODE_IP>
#   curl -fsSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/migrate-server-to-xudp.sh | bash
#
# Or copy/paste:
#   cat > /tmp/xudp.sh   # paste this whole file
#   bash /tmp/xudp.sh
# =============================================================================

set -euo pipefail

XRAY_CONFIG="/usr/local/etc/xray/config.json"
SYNC_SCRIPT="/opt/xray-sync.sh"
BACKUP="${XRAY_CONFIG}.pre-xudp.$(date +%s)"

log()  { echo -e "\n\033[1;34m[xudp]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*"; }
die()  { echo -e "\n\033[1;31m[fatal]\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must run as root"
command -v jq >/dev/null 2>&1 || die "jq not installed (apt install -y jq)"
[ -f "$XRAY_CONFIG" ] || die "$XRAY_CONFIG not found — is this a HundlerVPN node?"

cp -a "$XRAY_CONFIG" "$BACKUP"
log "Backed up current config to $BACKUP"

# ---- 1. Patch /opt/xray-sync.sh placeholder line ----------------------------
if [ -f "$SYNC_SCRIPT" ]; then
  if grep -q '"flow":"xtls-rprx-vision"' "$SYNC_SCRIPT"; then
    log "Patching $SYNC_SCRIPT — removing flow from placeholder client…"
    # Replace `,"flow":"xtls-rprx-vision"` with empty so the placeholder JSON
    # becomes `{"id":"...","email":"placeholder"}`. Order-independent.
    sed -i 's/,"flow":"xtls-rprx-vision"//g' "$SYNC_SCRIPT"
    sed -i 's/"flow":"xtls-rprx-vision",//g' "$SYNC_SCRIPT"
  else
    log "$SYNC_SCRIPT placeholder already migrated (no flow=vision)"
  fi
else
  warn "$SYNC_SCRIPT not present — skipping placeholder patch"
fi

# ---- 2. Force a sync run so config.json picks up the new no-flow clients ----
if [ -x "$SYNC_SCRIPT" ]; then
  log "Forcing immediate xray-sync run…"
  bash "$SYNC_SCRIPT" || warn "xray-sync.sh exited non-zero — check log"
else
  warn "$SYNC_SCRIPT not executable; skipping forced sync (will run on next cron tick)"
fi

# ---- 3. Patch routing rules ------------------------------------------------
# Two changes in one jq pass:
#   a) Add TG-CIDR -> direct rule at the TOP of routing.rules (idempotent:
#      strips any prior copy before re-adding). Needed because TG signaling
#      TCP on DE/NL used to cascade through WARP -> Cloudflare IP; TG voice
#      UDP needs the SAME source IP as TCP (reflector NAT-match). Routing
#      TG to direct makes both flows exit from the DE/NL VPS IP.
#   b) Flip any `{"network":"udp","outboundTag":"block"}` rule to outboundTag
#      "direct". This is the critical fix for v61 (2026-05-09): the previous
#      udp-block rule was silently dropping ALL XUDP-decoded UDP except TG
#      reflector pins. P2P TG UDP (random peer IPs), Discord UDP, WhatsApp
#      UDP all hit this rule and died. Flipping to direct sends all decoded
#      UDP out of the VPS as UDP datagrams from the server's own IP → works.
#      On RU the rule doesn't exist (RU default is freedom direct), so the
#      map is a no-op there.
log "Patching routing rules: + TG-CIDR -> direct (top) ; flip udp-block -> udp-direct…"

TG_CIDRS='[
  "91.108.4.0/22","91.108.8.0/21","91.108.16.0/21",
  "91.108.36.0/23","91.108.38.0/23","91.108.56.0/22",
  "95.161.64.0/20","149.154.160.0/20","185.76.151.0/24"
]'

# IMPORTANT: temp file MUST have a `.json` suffix — `xray -test -config FOO`
# determines the format by file extension and rejects extensionless files
# with "Failed to get format of …". `mktemp --suffix=.json` is GNU-only but
# present on every Debian/Ubuntu we run on (BusyBox mktemp is not in scope).
TMP_CONFIG="$(mktemp --suffix=.json)"
jq --argjson cidrs "$TG_CIDRS" '
  .routing.rules = (
    [{ "type": "field", "ip": $cidrs, "outboundTag": "direct" }]
    + (.routing.rules // [] | map(
        # Drop any old TG-CIDR-direct rule (idempotent re-add above)
        select(.ip != $cidrs or .outboundTag != "direct")
        # Flip udp-block -> udp-direct so decoded XUDP UDP egresses
        | if (.network == "udp" and .outboundTag == "block"
              and (.port == null) and (.ip == null))
          then .outboundTag = "direct"
          else . end
      ))
  )
' "$XRAY_CONFIG" > "$TMP_CONFIG"

XRAY_TEST_LOG="$(mktemp)"
if ! /usr/local/bin/xray -test -config "$TMP_CONFIG" >"$XRAY_TEST_LOG" 2>&1; then
  BAD_FILE="${XRAY_CONFIG}.xudp-rejected.$(date +%s).json"
  cp -a "$TMP_CONFIG" "$BAD_FILE"
  warn "xray -test rejected the patched config. Full output:"
  echo "------ xray -test output ------"
  cat "$XRAY_TEST_LOG"
  echo "------ end ------"
  warn "Patched config saved to: $BAD_FILE"
  warn "Original config remains untouched at: $XRAY_CONFIG"
  rm -f "$TMP_CONFIG" "$XRAY_TEST_LOG"
  die "Inspect $BAD_FILE + the output above to diagnose."
fi
rm -f "$XRAY_TEST_LOG"

mv "$TMP_CONFIG" "$XRAY_CONFIG"
chmod 644 "$XRAY_CONFIG"

# ---- 4. Restart xray with auto-rollback -------------------------------------
log "Restarting xray…"
if ! systemctl restart xray; then
  warn "xray restart failed — rolling back to $BACKUP"
  cp -a "$BACKUP" "$XRAY_CONFIG"
  systemctl restart xray
  die "rolled back to pre-XUDP config; investigate before retrying"
fi

sleep 2
if ! systemctl is-active --quiet xray; then
  warn "xray is not active post-restart — rolling back"
  cp -a "$BACKUP" "$XRAY_CONFIG"
  systemctl restart xray
  die "rolled back to pre-XUDP config"
fi

# ---- 5. Smoke check ---------------------------------------------------------
log "xray active. Verifying inbound flow on VLESS clients…"
FLOW_COUNT=$(jq '[.inbounds[] | select(.protocol=="vless") | .settings.clients[] | select(.flow=="xtls-rprx-vision")] | length' "$XRAY_CONFIG")
if [ "$FLOW_COUNT" -gt 0 ]; then
  warn "Still $FLOW_COUNT clients with flow=xtls-rprx-vision in config!"
  warn "This usually means /api/xray/clients hasn't been updated server-side yet."
  warn "Run: node scripts/migrate-vision-to-xudp.js (on the API host) and try again."
else
  log "All VLESS clients are now flow-less (XUDP-ready) ✓"
fi

echo
echo "============================================================="
echo "  XUDP migration applied on $(hostname) ($(curl -fsSL https://api.ipify.org 2>/dev/null || echo '<UNKNOWN>'))"
echo "============================================================="
echo "  Backup config : $BACKUP"
echo "  Current flow  : $FLOW_COUNT clients still on Vision (target: 0)"
echo "============================================================="
