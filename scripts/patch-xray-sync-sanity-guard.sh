#!/bin/bash
# patch-xray-sync-sanity-guard.sh
#
# Live-VPS patch for incident 2026-05-07 ~21:15 MSK (all three VPN nodes
# simultaneously dropped traffic for ~5 min because /api/xray/clients
# briefly returned an empty list during a Hostman backend deploy and the
# downstream sync script applied that as "990 clients -> 0 clients" diff,
# restarting Xray with no accepted clients).
#
# This script appends a sanity guard to /opt/xray-sync.sh that aborts on
# (a) empty client list and (b) >50 % drop. It is idempotent — re-running
# is a no-op once the guard is already in place. Backup is made each run.
#
# USAGE:
#   ssh root@<vps> 'bash -s' < patch-xray-sync-sanity-guard.sh
#
# OR copy onto the VPS and run locally:
#   bash patch-xray-sync-sanity-guard.sh

set -euo pipefail

SYNC=/opt/xray-sync.sh

# ── Pre-flight ──────────────────────────────────────────────────────────────
if [ ! -f "$SYNC" ]; then
  echo "ERROR: $SYNC not found — is this a VPN VPS that ran setup-*-server.sh?" >&2
  exit 1
fi

if grep -q 'SANITY: API returned' "$SYNC"; then
  echo "[patch] $SYNC already contains the sanity guard, skipping."
  exit 0
fi

if ! grep -q '^OLD_COUNT=' "$SYNC"; then
  echo "ERROR: $SYNC has no OLD_COUNT= line — unexpected layout, refusing to patch." >&2
  exit 1
fi

# ── Backup ──────────────────────────────────────────────────────────────────
TS=$(date +%Y%m%d-%H%M%S)
BACKUP="${SYNC}.pre-sanity.${TS}"
cp "$SYNC" "$BACKUP"
echo "[patch] backup written to $BACKUP"

# ── Insert guard right after the existing OLD_COUNT=... line ──────────────
# Use awk to avoid sed multiline quoting hell. The guard is written verbatim,
# matching the version inlined into setup-germany-server.sh and
# setup-rf-server.sh as of commit 8cc43c8.
awk '
  /^OLD_COUNT=/ && !inserted {
    print
    print ""
    print "# Sanity guard (incident 2026-05-07 ~21:15 MSK): refuse to wipe the"
    print "# Xray client list on a transient empty API response."
    print "if [ \"$NEW_COUNT\" -lt 1 ]; then"
    print "  echo \"[$(date -Iseconds)] SANITY: API returned 0 clients (was $OLD_COUNT). Refusing to wipe Xray.\""
    print "  exit 1"
    print "fi"
    print "if [ \"$OLD_COUNT\" -gt 100 ] && [ \"$NEW_COUNT\" -lt $((OLD_COUNT / 2)) ]; then"
    print "  echo \"[$(date -Iseconds)] SANITY: API returned $NEW_COUNT clients, was $OLD_COUNT (>50% drop). Refusing.\""
    print "  exit 1"
    print "fi"
    inserted = 1
    next
  }
  { print }
' "$SYNC" > "${SYNC}.new"

# ── Validate syntax before swapping ────────────────────────────────────────
if ! bash -n "${SYNC}.new"; then
  echo "ERROR: patched script has bash syntax errors, NOT applying. See ${SYNC}.new for inspection." >&2
  exit 1
fi

mv "${SYNC}.new" "$SYNC"
chmod +x "$SYNC"

echo "[patch] /opt/xray-sync.sh patched successfully."
echo "[patch] next cron tick (or webhook trigger) will use the new guard."
echo "[patch] roll back with: cp '$BACKUP' '$SYNC'"
