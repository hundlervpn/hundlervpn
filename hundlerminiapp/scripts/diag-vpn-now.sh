#!/bin/bash
# diag-vpn-now.sh — single-shot snapshot of a VPN VPS at the moment a user
# reports "VPN dropped". Run on NL (185.238.169.235) and/or DE
# (213.182.213.183) RIGHT WHEN the issue is happening, save the output.
#
# It checks every layer of the VPN stack:
#   1. Xray service status + last restart time (was it just restarted?)
#   2. Active inbound TCP connections on :443 (are clients still connected?)
#   3. WARP outbound: is the SOCKS5 proxy on 127.0.0.1:40000 reachable?
#      Does it actually route traffic to the internet?
#   4. YC bridge reachable from NL (NL only — DE is standalone)
#   5. Last 30 lines of xray-sync.log (recent restart events)
#   6. Last 20 errors from Xray journal
#   7. System load (CPU saturation can stall Xray under load)
#   8. Memory pressure (OOM-kill risk)
#
# Usage on the server:
#   bash <(curl -sf https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/diag-vpn-now.sh)
# OR copy this file to /opt/diag.sh, chmod +x, then `/opt/diag.sh`
set +e
echo "==================================================================="
echo "VPN diagnostic snapshot — $(date -Iseconds)"
echo "host: $(hostname) ip: $(hostname -I | awk '{print $1}')"
echo "==================================================================="

echo -e "\n[1] Xray service:"
systemctl is-active xray 2>&1
systemctl show xray --property=ActiveEnterTimestamp,SubState,MainPID,Result 2>&1
echo ""
echo "Last 5 systemd events for xray:"
journalctl -u xray --since '15 min ago' --no-pager 2>/dev/null | grep -E 'Stopped|Started|Failed|exited|killed' | tail -5

echo -e "\n[2] Active inbound TCP on :443:"
COUNT=$(ss -tn state established '( sport = :443 )' 2>/dev/null | tail -n +2 | wc -l)
echo "  $COUNT established connections"
echo "  Top 5 client IPs:"
ss -tn state established '( sport = :443 )' 2>/dev/null | tail -n +2 | awk '{print $4}' | cut -d: -f1 | sort | uniq -c | sort -rn | head -5

echo -e "\n[3] WARP outbound check (5s timeout):"
WARP_IP=$(curl -sf -m 5 --socks5 127.0.0.1:40000 https://ifconfig.me/ip 2>/dev/null)
if [ -n "$WARP_IP" ]; then
  echo "  ✅ WARP alive — exit IP: $WARP_IP"
else
  echo "  ❌ WARP DEAD or unreachable"
  echo "  Listener check:"
  ss -tlnp 2>/dev/null | grep ':40000' || echo "    nothing on :40000"
  echo "  WARP service status:"
  systemctl is-active warp-svc 2>/dev/null || systemctl is-active warp-cli 2>/dev/null || echo "    no warp service found"
fi

echo -e "\n[4] YC bridge reachability (NL only):"
if hostname -I | grep -q '185.238.169.235'; then
  if timeout 3 bash -c '</dev/tcp/158.160.254.104/443' 2>/dev/null; then
    echo "  ✅ YC bridge :443 reachable"
  else
    echo "  ❌ YC bridge :443 UNREACHABLE — all NL traffic blocked"
  fi
else
  echo "  (DE server — not applicable, DE is standalone)"
fi

echo -e "\n[5] Recent xray-sync.log (last 15 lines):"
tail -15 /var/log/xray-sync.log 2>/dev/null || echo "  no log file"

echo -e "\n[6] Last 20 xray errors / rejects (15 min):"
journalctl -u xray --since '15 min ago' --no-pager 2>/dev/null | grep -i -E 'error|fail|reject' | tail -20

echo -e "\n[7] System load:"
uptime
echo "Top 5 CPU consumers:"
ps aux --sort=-%cpu --no-headers 2>/dev/null | head -5 | awk '{print "  "$3"% "$11}'

echo -e "\n[8] Memory:"
free -h | head -3

echo -e "\n[9] Webhook reachability (port 9999):"
if timeout 3 bash -c '</dev/tcp/127.0.0.1/9999' 2>/dev/null; then
  echo "  ✅ webhook port 9999 listening"
else
  echo "  ❌ webhook port 9999 NOT listening"
fi

echo -e "\n==================================================================="
echo "End of snapshot. Save this output and post to support."
echo "==================================================================="
