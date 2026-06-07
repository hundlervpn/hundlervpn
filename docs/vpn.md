## VPN Architecture

### Servers (as of May 2026):
- **Yandex Cloud** (158.160.254.104) — bridge/entry server, accepts user connections
  - Pure dokodemo-door passthrough to NL VPS:443 — does NOT validate UUIDs.
  - **No xray-webhook** is needed here; UUID changes do not require restart on YC.
- **Netherlands VPS** (185.238.169.235) — foreign exit node + UUID validator for the NL flow.
  - YC dokodemo-door points its TCP byte-stream at NL:443; NL runs the actual VLESS+Reality
    handshake against the UUID pool, then forwards through WARP (Cloudflare) SOCKS5 on
    127.0.0.1:40000.
  - Runs `/opt/xray-webhook.py` on port 9999 (must use `ThreadingHTTPServer` — see
    "NL Webhook Deadlock" below).
- **Germany VPS** (213.182.213.183) — standalone exit node, direct (no cascade)
  - Xray VLESS+Reality on :443, WARP SOCKS5 on 127.0.0.1:40000
  - Provisioned via `scripts/setup-germany-server.sh`.
- **Russia VPS** (85.239.53.25, hostname `msk-1-vm-2ypv`) — direct RU exit, NO WARP,
  ad-blocking via DNS. Provisioned via `scripts/setup-rf-server.sh` (2026-05-07).
  - Xray VLESS+Reality on :443, freedom outbound direct (no SOCKS5 cascade).
  - **Purpose**: a Russian-IP exit so users can reach RU-only services
    (Госуслуги, FNS personal cabinet, Russian banks, RU streaming) without
    being geo-blocked, while still benefiting from the rest of the VPN
    stack (Reality cover, ad blocking, no logging).
  - **DNS**: system + Xray pinned to AdGuard plain DNS `94.140.14.14` /
    `94.140.15.15` (NOT DoH — see "DoH Circular Resolution Incident"
    below). `/etc/resolv.conf` made immutable via `chattr +i` so cloud-init
    cannot reset it on reboot. Xray DNS also has `hosts` overrides for
    `lkfl2.nalog.ru` (213.24.64.175) and `lknpd.nalog.ru` (213.24.64.181).
  - **Routing rules**: ads (`geosite:category-ads-all`, `category-ads`)
    blocked, BitTorrent protocol blocked (`protocol: bittorrent -> block`,
    anti-abuse on RU IP), `geoip:private` blocked (no LAN pivoting),
    everything else direct (TCP and UDP — UDP/QUIC needed for HTTP/3
    YouTube). Sniffing destOverride covers `http`, `tls`, `quic` so
    domain-based blocks match QUIC traffic too. The `geosite:torrent`
    and `geosite:win-spy` codes are NOT used because they only exist in
    the Loyalsoldier extended geosite.dat fork; the stock xray-core
    geosite.dat shipped with the official zip rejects them with
    "code not found in geosite.dat: TORRENT" at startup.
  - Runs `/opt/xray-webhook.py` on port 9999 (threading version).
  - Reality SNI: `www.microsoft.com`. Reality keys (private/public/shortId)
    are cached in `/usr/local/etc/xray/.reality-keys` (mode 0600) — re-runs
    of `setup-rf-server.sh` REUSE them so the DB row stays valid.

### TCP tuning (BBR + fq, 2026-05-07):
All 4 nodes (NL bridge, NL exit, DE, RU) are migrated from CUBIC/fq_codel to
**BBR + fq** for 2-3× higher throughput on lossy mobile paths (RU operators
+ TSPU drops). BBR (Google, model-based) ignores transient packet loss as
a congestion signal — vs CUBIC which collapses the TCP window on ANY loss.
`fq` qdisc provides the pacing BBR relies on (without it pacing is bursty,
−30% perf).

Both `setup-germany-server.sh` and `setup-rf-server.sh` now apply this in
**step 1b** (between base packages and Xray install). Idempotent — re-runs
are safe. Future nodes inherit it automatically.

To check on any live node:
```bash
sysctl net.ipv4.tcp_congestion_control net.core.default_qdisc
# expected: bbr / fq
```

To enable on a node that lacks it (idempotent block):
```bash
grep -q "^net.core.default_qdisc=fq$" /etc/sysctl.conf \
  || echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf
grep -q "^net.ipv4.tcp_congestion_control=bbr$" /etc/sysctl.conf \
  || echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf
sysctl -p >/dev/null
```
Takes effect on new TCP connections immediately, no Xray/system restart.

### SNI rotation (Reality serverNames pool, 2026-05-08):
DPI (TSPU, ISP) increasingly fingerprints by the **(server-IP, SNI) pair**.
"Every connection to 158.160.254.104 advertises SNI=www.microsoft.com" is
a recognisable pattern even though each individual TLS handshake looks
legit. Spreading users across 4 SNIs per node breaks the pattern.

**Source of truth**: `lib/sub-token.ts` `SNI_POOLS` constant.

**Per-country pools**:
- **Foreign exits** (DE, NL, anything not RU): `www.microsoft.com`,
  `www.cloudflare.com`, `www.apple.com`, `www.tiktok.com`
- **Russia exit** (RU): `www.microsoft.com`, `yastatic.net`,
  `storage.yandex.net`, `vk.com` — RU CDN domains so the (RU IP, SNI)
  pair stays plausible (foreign SNI on a RU IP is slightly weird).

`www.microsoft.com` is **first in both pools** for backward compat with
clients that have cached subscriptions from before the rollout (those
configs only know the legacy single SNI). Don't reorder.

**Client picking**: `pickSniForServer(server, userId)` in
`lib/sub-token.ts` — deterministic by `(userId, server.host)` so the
same user always gets the same SNI on the same server (cached configs
don't re-key on every poll). Different users converge to a roughly even
~25 % split per SNI.

**Server side**: each Xray-Reality node's `serverNames` array MUST
include EVERY SNI in the pool — Reality only accepts inbound TLS
handshakes whose SNI matches one of those entries; everything else
falls through to the donor `dest` site. The `serverNames` array is
baked into:
- `scripts/setup-germany-server.sh` (foreign-exit `SNI_POOL_JSON` default)
- `scripts/setup-rf-server.sh` (RU `SNI_POOL_JSON` default)

**Live-node patch**: `scripts/patch-reality-sni-pool.sh` — auto-detects
pool from current config / hostname / IP, idempotent (re-runs are no-op
if the array already matches), validates with `xray -test` before
applying, automatic rollback on restart failure. Run on each existing
node BEFORE deploying the matching mini-app build (otherwise clients
who poll during the deploy window get an SNI the server doesn't yet
accept and break until the next poll).

**Order of operations for the SNI pool rollout**:
1. SSH to each VPN node (DE, NL exit, RU) and run
   `scripts/patch-reality-sni-pool.sh` (auto-detects pool).
2. Verify with `jq '.inbounds[] | select(.tag=="vless-in") | .streamSettings.realitySettings.serverNames' /usr/local/etc/xray/config.json`
3. Push the matching `lib/sub-token.ts` + `app/api/sub/[token]/route.ts`
   change to Hostman (auto-deploys).
4. Existing users keep working with their cached SNI (still in the array);
   their next subscription poll re-keys them onto a new pool entry.

The YC bridge (158.160.254.104) does NOT do TLS termination — it's pure
dokodemo-door TCP passthrough to the NL exit which IS the Reality
terminator. So the YC bridge does NOT need this patch.

### Hysteria2 inbound on Germany (PILOT, 2026-05-08):
Phase-1 pilot for fixing TG voice / Discord voice / WhatsApp voice in RU
networks where TSPU blocks UDP egress to TG reflectors and the existing
VLESS+Reality+xtls-rprx-vision path can't carry UDP at all.

**Why Hysteria2**: it's a QUIC-based protocol designed for UDP from day
one, with built-in BBR-like congestion control optimised for lossy paths.
Sing-box / Hiddify / NekoBox / v2rayTun / modern Happ all support it as
a client outbound, so we don't have to invent anything.

**Architecture (DE only, pilot)**:
- Existing: VLESS+Reality on TCP/443 → WARP SOCKS5 (127.0.0.1:40000) →
  Cloudflare WARP exit. UNCHANGED. General TCP traffic still uses this
  path with full WARP anonymity.
- New: Hysteria2 on UDP/8443 → **direct egress** (DE VPS IP
  213.182.213.183). Self-signed ECDSA cert, password auth.
- Phase-2 client routing (NOT YET DEPLOYED): TG CIDR (TCP+UDP both) →
  Hy2 outbound. This way TG TCP signaling and UDP voice both come from
  the SAME source IP (DE VPS direct), satisfying the reflector NAT-match
  requirement.

**Why direct egress (not WARP-chain) for Hy2**:
- WARP-CLI SOCKS5 on 127.0.0.1:40000 supports only TCP CONNECT, not UDP
  ASSOCIATE. Hy2 traffic is QUIC/UDP — chaining through WARP SOCKS5
  would silently drop most packets.
- For TG voice the critical thing is consistent source-IP between TCP
  signaling and UDP voice (NOT a Cloudflare exit IP). Direct DE VPS IP
  satisfies that consistency.
- Trade-off accepted: Hy2 users' TG-only traffic exposes the DE VPS IP
  rather than a Cloudflare WARP IP. Acceptable because (a) the DE VPS
  IP is already the public IP of an exit node and (b) only TG traffic
  goes via Hy2, everything else stays on VLESS+WARP.

**Server-side install**: `scripts/setup-germany-hysteria2.sh`. Idempotent.
Caches password in `/etc/hysteria/.password` (mode 0600) and cert in
`/etc/hysteria/cert/` (mode 0700) so re-runs preserve credentials.
Installs Hysteria2 binary via official `https://get.hy2.sh/` script
(creates `hysteria-server.service` automatically). Opens UFW UDP/8443.

**Cert strategy**: pilot uses self-signed ECDSA P-256 (CN=de.hundlervpn.xyz,
100 yr). Client connects with `pinSHA256=<fingerprint>` for cert pinning
(better than `insecure: true` because it still authenticates the server).
Before broad rollout, switch to Let's Encrypt via Hy2's built-in ACME
support (requires real DNS A record `de-hy2.hundlervpn.xyz → 213.182.213.183`).

**Manual run on DE**:
```bash
ssh root@213.182.213.183
curl -fsSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/setup-germany-hysteria2.sh | bash
```
Script prints the connection details (server IP, port, password, SNI,
cert SHA256 fingerprint) at the end. Save those — they're needed for
Phase-2 DB schema population.

**Phase-2 rollout** (LIVE as of 2026-05-08, commits `6e2f867` (v55) +
`94643d2` (v56)):

*DB migration* (`scripts/add-hysteria2-columns.js`, idempotent):
- `hysteria2_port INTEGER NULL` (e.g. 8443)
- `hysteria2_password TEXT NULL`
- `hysteria2_sni TEXT NULL` (e.g. de.hundlervpn.xyz)
- `hysteria2_cert_sha256 TEXT NULL` (lowercase hex, no colons)

DE server (id=4, host=213.182.213.183) populated with:
- port=8443
- password=66004e76f286dfd3c4760dacca57671c
- sni=de.hundlervpn.xyz
- cert_sha256=281310e402a92ce5f86d7be2d6cbbbc34b883ca5f4b1a62a6c4d9c7683dbb043

NL/RU rows stay NULL until Hy2 installed on those boxes. The code
paths all null-check before emitting Hy2 entries, so the feature
cleanly no-ops for those servers.

*v55 code changes* (`app/api/sub/[token]/route.ts`):
- SELECT in GET handler pulls the 4 Hy2 columns.
- `ServerConfig` type (in `lib/sub-token.ts`) gets the 4 optional Hy2
  fields.
- `buildSingboxConfig` emits a `type: "hysteria2"` sing-box outbound
  for every Hy2-enabled server. Tag pattern: `"🇩🇪 Германия | Hy2 voice"`
  (distinct from the VLESS tag so route rules can target it).
  TLS pinning via `tls.pin_sha256` (lowercase hex) — strict pin, NOT
  `insecure: true`.
- New route rule (FIRST in rule list, just after DNS): TG CIDR →
  `hy2Tags[0]`. Both TCP signaling and UDP voice on TG destinations
  pin to the same Hy2 outbound. Same source IP for TCP+UDP = TG
  reflector NAT-match satisfied. Rule omitted entirely if no server
  has Hy2 configured.

*v56 code changes* (Happ + URI-list Hy2 support):
- `lib/sub-token.ts` `buildHysteria2Uri(server)` helper — builds a
  standards-compliant `hysteria2://` URI with `pinSHA256=sha256/<base64>`.
  Hex → base64 conversion at build time since we store hex in DB but
  the URI scheme expects base64.
- `app/api/sub/[token]/route.ts` `buildHappSingleServerHy2Profile`:
  Xray-JSON profile with `protocol: "hysteria"` + `settings.version: 2`
  outbound (schema confirmed via Xray-core issue #5921). Crucially,
  Xray-JSON TLS block has **NO `pinSHA256` field** (unlike sing-box) —
  only `allowInsecure`. Pilot uses `allowInsecure: true` for the
  self-signed cert and relies on the Hy2 auth password for access
  control. Before broad rollout: switch DE cert to Let's Encrypt via
  Hy2's built-in ACME support, then flip `allowInsecure` to false.
- `buildHappRoutingRulesForHy2`: Happ routing tuned for Hy2 profile.
  **NO** `udp -> direct` rule and **NO** QUIC block — the user picks
  this profile to route UDP THROUGH the tunnel, forcing direct would
  defeat the point. Everything else (DNS, BT → direct, RU IP/domain
  routing, push, catch-all) stays.
- `buildHappJsonArray` now loops through each server and emits TWO
  entries for Hy2-enabled servers: VLESS profile first, Hy2 profile
  immediately after. UI shows them adjacent:
    🇳🇱 Нидерланды | LTE
    🇩🇪 Германия | Pro
    🇩🇪 Германия | Pro Hy2
    🇷🇺 Россия | YouTube
- URI-list response (for v2rayNG/Streisand): `hysteria2://` URI
  appended right after each server's `vless://` line.

*Scope coverage after v56*:
- sing-box clients (Hiddify): Hy2 outbound + automatic TG-CIDR routing
  via the route rule. User doesn't have to do anything — TG traffic
  auto-routes through Hy2.
- Happ: extra "…Hy2" profile per Hy2-enabled server. User MANUALLY
  picks it when they want Hy2 (e.g. for all voice/games). Not
  auto-routed because Happ per-profile routing can't easily route TG
  CIDRs to a DIFFERENT Happ profile (each profile is self-contained).
- v2rayNG/Streisand: extra `hysteria2://` URI line. User MANUALLY
  picks the resulting profile, same pattern as Happ.

*Deferred to Phase-3*:
- Install Hy2 on NL + RU exit nodes (`setup-nl-hysteria2.sh`,
  `setup-rf-hysteria2.sh` — TBD). Once installed + DB rows updated,
  every node gets its own Hy2 profile automatically (the code already
  iterates all servers with Hy2 columns set).
- Switch DE Hy2 cert from self-signed → Let's Encrypt via Hy2 ACME.
  Requires DNS A record `de-hy2.hundlervpn.xyz → 213.182.213.183`.
  Then flip `allowInsecure` to `false` in `buildHappSingleServerHy2Profile`
  and drop `pinSHA256` from `buildHysteria2Uri` (CA chain trust is
  sufficient).

**Verification on the live DE box**:
```bash
ss -lunp | grep :8443                    # hysteria listening on UDP/8443
systemctl status hysteria-server         # active (running)
journalctl -u hysteria-server -n 30      # no errors
hysteria version                         # check installed version
```

**Test from a laptop** (install Hy2 CLI first via `https://get.hy2.sh/`):
```yaml
# hy2-test.yaml
server: 213.182.213.183:8443
auth: <password from /etc/hysteria/.password on DE>
tls:
  sni: de.hundlervpn.xyz
  pinSHA256: <SHA256 from script output>
  insecure: true   # accept self-signed for pilot
socks5:
  listen: 127.0.0.1:1080
```
```bash
hysteria client -c hy2-test.yaml
# In another terminal:
curl --socks5 127.0.0.1:1080 -fsSL https://www.cloudflare.com/cdn-cgi/trace
# Should show ip=213.182.213.183 (or DE region IP), proving Hy2+direct works
```

### Voice / video calls — UDP direct fallback (2026-05-08):
**Symptom**: Discord voice calls show "RTC Connecting…" forever, or
audio drops on connect. Telegram and WhatsApp calls similarly fail.

**Root cause**: VLESS+Reality with `xtls-rprx-vision` flow is **strictly
TCP**. Voice calls use UDP — Discord WebRTC opens UDP sockets on
dynamic high ports (≈ 50000–65000) directly to **IPs** that the Discord
gateway hands the client over the WSS control channel. There's no DNS
lookup for those IPs and no SNI on the UDP packets, so domain-based
routing rules (`discord.media`, `discord.gg`, …) **don't match**. The
UDP traffic falls through to the catch-all proxy rule and gets silently
dropped by the VLESS outbound.

**Fix (v47, 2026-05-08)**: catch-all `network: udp → direct` rule in
both client config builders. This routes EVERY UDP packet (except DNS
on port 53 and QUIC on port 443) through the freedom / direct outbound
= the user's local ISP. Implemented in `app/api/sub/[token]/route.ts`:

- `buildSingboxConfig` route.rules order:
  1. `protocol: dns → dns-out` (so DNS works through the tunnel)
  2. (existing) Telegram CIDRs + TG/Discord/WhatsApp domain rules — kept
     for explicit clarity, also catches the TCP control plane of these
     apps.
  3. `port: 443, network: udp → block` (QUIC) — without this, browsers
     would route HTTP/3 traffic to the local ISP and leak browsing
     activity. Block forces fallback to TCP/443 which goes via VPN.
  4. `network: udp → direct` — the actual fix. ALL non-DNS, non-QUIC
     UDP escapes via local ISP.
  5. (existing) RU domain / IP rules.
  6. Catch-all → proxy (TCP only by this point).

- `buildXrayConfig` `routing.rules` mirrors the same shape:
  `port=53→dns-out`, `bittorrent→direct`, `port=443 udp→block`,
  `udp→direct`, then existing TG/Discord/RU rules, then
  `port=0-65535→proxy`.

**Tradeoff**: All UDP traffic — voice, online games, custom protocols —
bypasses the VPN. The user's local ISP sees those destinations (but
not the contents — voice is encrypted by Discord/Signal/etc on top).
TCP traffic (web HTTPS, app APIs, Discord control plane) still goes
through the VPN as before. This is the standard tradeoff for
Reality-based VPNs that don't deploy an additional UDP transport.

**Why we don't tunnel UDP via Hysteria2/TUIC/WireGuard yet**: those
require a separate inbound on every node (different port, different
TLS profile or no TLS) and a different client config branch. Out of
scope for now — the direct-fallback rule covers ~all real-world voice
use cases without any infra change.

**Code version**: `v47-udp-direct-fallback-2026-05-08` — verifiable via
`curl -I https://hundlervpn.xyz/api/sub/<token>` → `X-Code-Version`
header.

**Why only mini-app config builders fix this, NOT raw VLESS URLs**:
clients that consume the raw `vless://` URL (NekoBox, v2rayN with
default config) have no client-side routing rules — every packet goes
through the proxy outbound. Those clients need the user to manually
configure `network=udp → direct` (or use a sub-config-aware client
like Happ / v2rayTun / Hiddify which DO consume our JSON configs).
Recommend Happ in user docs for this reason.

### Subscription `routing` HTTP header (v48, 2026-05-08):
**Problem follow-up**: `isXrayClient(ua)` was tightened in v44 — Happ /
v2rayNG / Streisand / v2RayTun now get a **base64 VLESS list** (not
JSON config) so their multi-server UI works (each `vless://` URI
becomes a separate entry in the server list). But base64 VLESS lists
have NO routing rules → the v47 UDP→direct fix in the JSON builders
doesn't reach those users → Discord voice still broken on Happ /
v2RayTun.

**Fix**: emit a `routing` HTTP response header on every subscription
response, with a payload formatted appropriately for the detected
client (auto-applied without user intervention).

**Per-client format** (UA-dispatched in `buildRoutingHeader`):
- **Happ** (matches `\bHapp\//i`): `routing: happ://routing/onadd/{base64}`
  — base64 is a [Happ routing profile](https://routing.happ.su) JSON.
  Profile name is hard-coded to `Hundler VPN` so re-polls override the
  same profile (instead of accumulating duplicates). Includes
  `DirectSites` (`category-ru`, `telegram`, `apple`), `DirectIp`
  (`geoip:ru` + `geoip:private` + Telegram CDN /22 ranges),
  `BlockSites` (`category-ads-all`).
  **Limitation**: Happ profile format is domain/IP only — NO
  `network: udp` filter primitive — so Discord WebRTC voice (random
  UDP/50000-65000 to GCP IPs) still hits the proxy outbound and
  drops. Telegram calls work because we list the explicit TG CDN
  CIDRs in `DirectIp`. Recommend Hiddify (sing-box JSON path applies
  the proper UDP→direct rule) or v2RayTun (routing header below)
  for full Discord voice support.
- **v2RayTun** (matches `\bv2raytun\b/i`): `routing: {base64}` — base64
  is an Xray-routing JSON. Format docs:
  `https://docs.v2raytun.com/headers#routing`. Supports
  `{ network: 'udp', outboundTag: 'direct' }` so the FULL UDP→direct
  fallback applies → Discord voice + games + Telegram all work.
- **Other clients** (sing-box, Hiddify, NekoBox): `null` returned —
  these consume the JSON config in the response body which already
  carries the routing rules.

The header is set in `subHeaders` *before* the JSON / VLESS body is
built, so it goes out on every successful subscription response
(Happ-/v2RayTun-specific clients ignore the header type they don't
understand).

**Code path**: `app/api/sub/[token]/route.ts` →
- `isHappClient(ua)` / `isV2RayTunClient(ua)` (UA detectors)
- `buildHappRoutingProfile(name)` (Happ profile JSON)
- `buildV2RayTunRoutingConfig(name)` (Xray-routing JSON)
- `buildRoutingHeader(ua)` (dispatcher)

**Code version**: `v48-routing-header-happ-v2raytun-2026-05-08`.

### YC bridge SSH access (lessons learned 2026-05-07):
The YC VM (currently named `compute-vm-2-2-20-ssd-1776178370896` in folder
`b1g6mbhsa39jb1rgc52e`) runs as user `solmaster` and was provisioned with
an SSH key that is easy to lose. If `ssh solmaster@158.160.254.104` returns
`Permission denied (publickey)`, recover via YC Cloud Shell (which has `yc`
CLI pre-installed and authenticated):

```bash
# 1. Generate a fresh keypair in Cloud Shell
ssh-keygen -t ed25519 -f ~/.ssh/yc_bridge -N "" -q -C "hundler-cli"

# 2. Push it to the VM's metadata (replaces the existing ssh-keys entry)
yc compute instance add-metadata \
  --name compute-vm-2-2-20-ssd-1776178370896 \
  --metadata ssh-keys="solmaster:$(cat ~/.ssh/yc_bridge.pub)"

# 3. Wait ~30 s for the YC guest agent to sync, then SSH in
ssh -i ~/.ssh/yc_bridge -o StrictHostKeyChecking=no solmaster@158.160.254.104

# 4. Inside, sudo is passwordless for solmaster.
```

The `add-metadata` call REPLACES the `ssh-keys` metadata value entirely —
any previous keys for `solmaster` stop working. Acceptable for a recovery
scenario where we already lost the original key.

The Cloud Shell URL is https://console.yandex.cloud (link shows on the YC
landing page). It auto-authenticates with the YC account in the browser.

### Adding a new VPN server:
The reference scripts are now `setup-germany-server.sh` (foreign exit
with WARP) and `setup-rf-server.sh` (RU exit, ad-blocking, no WARP).
Pick the one closer to the new node's role and copy/adapt.

1. SSH as root to the clean VPS, run the appropriate setup script.
   Both install Xray + `/opt/xray-sync.sh` + `/opt/xray-webhook.py`,
   generate Reality keys, write config, open UFW 443/9999, and print
   the DB INSERT SQL at the end.
   - For Germany-style (foreign exit, WARP, ad-blocking off):
     `scripts/setup-germany-server.sh`
   - For RU-style (direct exit, AdGuard DNS ad-blocking, no WARP):
     `scripts/setup-rf-server.sh`
2. Run the printed `INSERT INTO servers (…)` on the Hostman Postgres DB
   (host `132.243.242.196` — was Timeweb `5.42.118.215` until v68).
   Reference one-shots: `scripts/add-germany-server.js`,
   `scripts/add-rf-server.js` (idempotent — skip if host row exists).
3. **Webhook URL list — v67 (2026-05-17)**: ничего больше править в
   `XRAY_WEBHOOK_URL` не нужно. `lib/xray-webhook.ts::getWebhookUrls()`
   читает список хостов из `SELECT host FROM servers WHERE is_active=TRUE`
   и строит `http://<host>:9999/sync` динамически на каждом вызове.
   ENV `XRAY_WEBHOOK_URL` остаётся только fallback'ом на случай если
   БД-запрос упадёт. Шаг этот раньше был обязателен (без него новый VPS
   получал sync только через 5-минутный cron `/opt/xray-sync.sh`), что
   и вызывало симптом «Hysteria + Россия мгновенно вернулись, остальные
   N/A минут 5 после promo apply».

### v68 (2026-05-17) — DB migration Timeweb → Hostman managed PG

**Reason**: Timeweb-hosted Postgres at `5.42.118.215` had been unreliable
for weeks: GeoIP filter that silently drops non-RU SSLRequest (forced the
SSH-tunnel workaround in v66), unpredictable connection resets, and the
ongoing Hostman DE outage made the foreign side basically unreachable.
Hostman themselves now offer managed Postgres in a separate region, so
the entire DB moved there.

**New target**:
- Host: `132.243.242.196`
- Port: `5432`
- User: `gen_user`
- DB: `default_db`
- SSL: required (TLSv1.3, libpq auto-negotiates; psycopg2 needs explicit
  `sslmode=require`)

**Migration procedure** (already executed for prod):
1. `pg_dump --format=custom --no-owner --no-privileges` from OLD →
   `*.dump` file (custom-format, ~200 KB compressed for 11 MB DB).
2. In Hostman UI: open the user's **Privileges** tab and tick
   *"Select all privileges"* → Save. Without this `gen_user` cannot
   `CREATE TABLE` in `public` (managed-PG default leaves the role with
   USAGE only — `pg_database_owner` keeps schema ownership). If you
   skip this step `pg_restore` returns 246 *"permission denied for
   schema public"* errors and 0 tables are created.
3. From a psql session connected to NEW as `gen_user`:
   `DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION gen_user; GRANT ALL ON SCHEMA public TO gen_user;`
   This makes `gen_user` the schema owner so subsequent `pg_restore`
   FK-constraints can resolve the table-create order.
4. `pg_restore --dbname=<NEW> --no-owner --no-privileges *.dump`.
5. Row-count diff between OLD and NEW must match exactly (we got
   identical counts for all 13 verified core tables — users/subs/
   vpn_keys/payments/sessions/uuid_pool/etc.). Any drift = run another
   dump+restore cycle right before flipping env vars.

**Cutover** (env-var flip — no schema migration, no code rollout needed
since `lib/postgres-config.ts` and bot configs already read from env):
- Hostman dashboard (Next.js Mini App service) — set
  `POSTGRESQL_HOST=132.243.242.196` and `POSTGRESQL_PASSWORD=<new>`.
  Save → service auto-restarts and picks up the new pool.
- Telegram bots VPS — edit `/etc/systemd/system/hundlervpn-bot.service`
  (and chat-bot equivalent), `systemctl daemon-reload && systemctl
  restart hundlervpn-bot hundlervpn-chat-bot`.
- The old `db-tunnel.service` SSH bridge through `158.160.254.104` is
  **no longer required** if the new Hostman DB allows direct inbound
  from the bot VPS IP. Verify with `psql 'postgresql://...@132.243.242.196:5432/...'`
  from the bot host before disabling the tunnel. If the tunnel is
  still in place, it can stay running — it is just unused.

**Known gotcha — password special chars**: Hostman UI's password
input silently fails to apply passwords containing `=` / `,` / `|` /
`*`. The user sees the password in the UI but the actual server still
has the old hash. Symptom: `FATAL: password authentication failed
for user "gen_user"` for both URL-encoded and PGPASSWORD forms, while
`postgres` user returns `pg_hba.conf rejects` (proving the IP itself
is whitelisted). Fix: pick an alphanumeric password, **restart the DB
instance** if the UI does not apply within ~60 s. Verified that
`HundlerVPN2026Strong` applies cleanly; anything with `=`/`,`/`|`
does not.

**Hardcoded references swept**: all `scripts/*.{js,mjs}` (58 files)
had their inline `postgresql://gen_user:sE*Hn5,Ar=9bc6@5.42.118.215:5432/default_db`
fallback rewritten to the new IP + new password. `bot/main.py`,
`bot-chat/config.py` and `bot/hundlervpn-bot.service` had their env
fallback host updated. The OLD password no longer exists in this
repo — `Select-String` over the whole tree returns no matches.

**Rollback** (if NEW DB falls over): Hostman dashboard env var flip
back to `POSTGRESQL_HOST=5.42.118.215` + old password, restart. OLD
DB is still alive and unchanged until you explicitly delete it from
the Timeweb console (do NOT delete it for at least a week post-cutover
in case any rare-event row needs to be restored).

### `setup-rf-server.sh` quirks (lessons learned 2026-05-07):
- **Xray release zip download**: the official `XTLS/Xray-install`
  installer hangs indefinitely on the `.dgst` verification fetch from
  Russian transit (the zip downloads at ~850 KB/s, then dgst stalls
  forever). The script bypasses this by trying Chinese GitHub proxies
  first (`ghfast.top`, `gh-proxy.com`, `hub.gitmirror.com`) before
  direct `github.com`, all with `--max-time 180`. Manual install of the
  unzipped binary + geo data + a minimal systemd unit. Idempotent —
  skipped if `/usr/local/bin/xray` already exists and `xray version`
  succeeds.
- **`/etc/resolv.conf` immutability**: the script sets `chattr +i` at
  the end of the DNS step. Re-runs first do `chattr -i` to remove the
  flag, otherwise the heredoc rewrite fails with "Operation not permitted".
- **Reality key persistence**: the keys are generated only on first run
  and cached at `/usr/local/etc/xray/.reality-keys`. Subsequent runs
  source that file and reuse the existing keypair, so iterating on
  routing/DNS/etc on a deployed VPS does NOT invalidate the matching
  `servers` DB row. Delete the cache file manually only if you intend
  to rotate keys (then UPDATE the row).

### DB table `servers`:
- id=1: old server 2.27.40.77 (is_active=false, decommissioned)
- id=4: Germany, host=213.182.213.183, port=443, country=DE,
  name='Pro', sort_order=**1** (is_active=true) — displayed as `🇩🇪 Германия | Pro`,
  appears FIRST in client UIs by default (2026-05-08 swap, see below).
- id=3: Netherlands, host=vpn.hundlervpn.xyz (158.160.254.104), port=443, country=NL,
  name='LTE', sort_order=**2** (is_active=true) — displayed to users as
  `🇳🇱 Нидерланды | LTE`. NL is the YC bridge cascade — entry IP is YC, so user
  traffic exits Yandex Cloud's network. YC LTE/mobile egress pricing made this
  the most expensive flow per GB, hence demoted from default to second.
- id=5: Russia, host=85.239.53.25 (`msk-1-vm-2ypv`), port=443, country=RU,
  name='YouTube', sort_order=3 (is_active=true) — displayed as `🇷🇺 Россия | YouTube`.
  Provisioned 2026-05-07 via `scripts/setup-rf-server.sh` + `scripts/add-rf-server.js`.
  See the **Russia VPS** bullet under "Servers" above for routing / DNS / ad-blocking notes.
- **`sort_order` column** (INTEGER NOT NULL DEFAULT 100) — controls the order in which
  servers appear in client UIs. `/api/sub/[token]` orders by `sort_order ASC, country
  ASC, name ASC` so explicit priorities (1, 2, 3 …) appear first; defaults of 100
  fall back to alphabetical. Set via
  `UPDATE servers SET sort_order = N WHERE country = '…';` (see
  `scripts/set-server-sort-order.js` for the canonical DE=1 / NL=2 / RU=3 setup).
- To add a new server: INSERT into servers with host, port, country, public_key, sni,
  short_id, fingerprint, flow, is_active=true, a short `name` (e.g. 'LTE', 'Pro', '5G')
  appended after the country name in client UI, and an explicit `sort_order` if it
  should appear at a specific position (otherwise it defaults to 100 = end of list).
  Leave `name` empty to show only flag + country. `/api/sub/[token]` already iterates
  over all `is_active=TRUE` rows, so no code changes needed for new servers.

### UUID Pool Architecture (v35, 2026-04-19) — INSTANT CONNECT:
**Why**: Xray-core v26.x does NOT support reliable hot-reload (`xray api adu`
silently fails — CLI can't serialize protobuf TypedMessage for account field).
Any change to client list requires `systemctl restart xray`, dropping ALL
connections for 5-15s. Previously every new device triggered a webhook →
restart → "Ping N/A" for 30+ seconds while the new device retried.

**Solution**: Pre-allocate a large pool of UUIDs and load them ALL into Xray
config ahead of time with placeholder emails. When a user needs a UUID, we
claim one from the pool and just re-label it in the DB — Xray already knows
the UUID and accepts the connection instantly. NO restart needed on signup.

**Components**:
- DB table `uuid_pool` (`db/schema.sql` ~L394): `id`, `uuid`,
  `assigned_to_key_id` (FK vpn_keys, ON DELETE SET NULL), `assigned_at`.
  Partial indexes on `assigned_to_key_id IS NULL` and `IS NOT NULL`.
- Initial seed: 1000 UUIDs via `POST /api/xray/pool?action=seed`.
- `lib/uuid-pool.ts`: `claimUuid()` uses `FOR UPDATE SKIP LOCKED` to prevent
  concurrent races. `acquireUuid()` auto-refills when empty.
- `maybeRefill()` is called opportunistically after each claim — adds 500
  UUIDs when free count drops below 100.
- `POST /api/xray/pool` admin actions: `seed`, `refill`, `auto`, `add&n=N`.
- `GET /api/xray/pool` returns `{total, free, assigned}` stats.

**Signup flow (post-v35)**:
1. `/api/sub/[token]` → `ensurePerDeviceUuid()` inserts vpn_key with placeholder,
   calls `acquireUuid(keyId)` → assigns pool UUID → updates key_hash.
2. Pool UUID is ALREADY in Xray config with `pool-N` email.
3. Client connects with the UUID → Xray accepts immediately (it's a known
   client) → instant connect, no restart.
4. Next cron sync renames the Xray email from `pool-N` to `tg-{tid}-s{sid}`
   (for traffic accounting) — but the UUID stays valid throughout.

**Device removal / subscription expiration (v48 SOFT KICK + 2026-05-16 cron purge)**:
- v47 hard-DELETE caused race conditions during renewals (UUID disappeared
  from pool between expire-tick and renewal-tick → user got
  `uuid_pool_exhausted` from `acquireUuid()`). v48 switched to SOFT KICK:
  pool row stays, `/api/xray/clients` filters it out at SELECT-time via
  `WHERE up.assigned_to_key_id IS NULL OR ak.vpn_key_id IS NOT NULL`. So
  Xray immediately drops the user, but the row in DB remains.
- **Problem this caused (admins noticed by 2026-05-16)**: orphan rows
  accumulated unbounded — admin pool stats showed `assigned: 1500` while
  `alive` was only ~500. Headline number became useless for capacity
  planning, and `loadPoolStats()` widget felt "broken".
- **Fix**: cron `/api/cron/sweep-expired` (already runs every 1 minute)
  now calls `purgeOrphanUuids()` after the deactivation pass. Hard-DELETE
  is safe at this point because:
    - Xray never had these UUIDs (filter excluded them since v48).
    - User is already kicked — DELETE has no client-visible effect.
    - Renewal race fixed separately by `restoreActivePoolEntries()` in
      the same cron (re-creates pool rows for `is_active=TRUE` keys whose
      pool row got GC'd).
- `getPoolStats()` now exposes `alive` + `orphan` counts separately so
  admin sees `Total / Free / Alive / Dead`. Admin UI has a manual
  «🗑 Очистить мёртвые (N)» button (only visible when `orphan > 0`)
  calling `POST /api/admin/pool?action=purge-orphans` for instant cleanup
  between cron ticks.
- Once the next `/api/xray/clients` snapshot reaches the VPN VPS sync
  script, Xray's accepted-clients list no longer contains the deleted
  UUIDs, so the user's cached VLESS config gets "user not found" within
  seconds of the restart.
- Pool size shrinks proportionally to the number of expired UUIDs.
  `acquireUuid()` will trigger a synchronous refill on the next signup
  if the free pool is empty, and `maybeRefill()` keeps free ≥ 100 in
  the steady state.
- `deactivateExpiredAccess` automatically fires `triggerXraySync('fire-and-forget')`
  whenever `purged > 0`, so any user-touch path that detects an expired
  subscription (Mini App `/api/users/sync`, Telegram OAuth callback,
  promo apply, payment callbacks, Telegram bot webhook) propagates the
  kick to Xray within ~1 second — no waiting for the 5-min cron.
- For users who never re-open the app, the new `/api/cron/sweep-expired`
  endpoint (token-protected, see "Cron Sweep" below) runs the same
  global expiration + purge every 1 minute, also firing the webhook.
- Pre-v47 "soft kick" behaviour (UUID remained valid under `pool-N`
  label, recycled to a future user) was the documented compromise; v47
  makes it a HARD kick by deleting the row outright. Same code path as
  the device-kick endpoint — unified pattern across all expiration
  scenarios.

**Scaling**:
- 1000 UUIDs in config = ~200 KB RAM on Xray (irrelevant)
- 10,000 = ~2 MB, 100,000 = ~20 MB — Marzban and large providers run these
  numbers routinely.
- Pool auto-grows: `maybeRefill()` keeps free ≥ 100 by adding batches of 500.
- When the pool extends (rare, every ~400-500 new users) ONE restart happens.

**Migration from legacy per-device UUIDs**:
One-time script copied all existing active `vpn_keys.key_hash` into
`uuid_pool` with `assigned_to_key_id = vk.id`. This preserves all existing
user UUIDs so no client has to reimport the subscription.

### Client Sync (critical for subscription enforcement):
- Each VPN server runs /opt/xray-sync.sh via cron every 5 minutes
- Script calls: https://hundlervpn.xyz/api/xray/clients?token=XRAY_SYNC_TOKEN
- API returns ALL pool UUIDs (assigned with user emails + free with `pool-N`
  placeholders). Xray config thus always contains the full pool; signup
  does NOT require a restart.
- Script uses diff + conditional restart (only restarts Xray when the
  complete client list changes, i.e. pool refill or email re-labelling).
- Subscription expires → GC on next sync DELETES the orphan pool row via
  `purgeOrphanUuids()`, so the UUID is wiped from the pool entirely.
  Combined with the diff-based restart in `xray-sync.sh`, the cached
  client config dies within seconds of the restart — see "v47 HARD KICK"
  note above.
- **Webhook** for instant sync: `/opt/xray-webhook.py` on every VPN VPS that VALIDATES
  UUIDs (NL exit + DE), port 9999, triggered by `triggerXraySync()` from
  `lib/xray-webhook.ts` on UUID changes.
  Env (comma-separated for multi-server fan-out):
  `XRAY_WEBHOOK_URL=http://185.238.169.235:9999/sync,http://213.182.213.183:9999/sync`
  - YC bridge (158.160.254.104) is NOT in this list — it's a passthrough, doesn't run
    its own VLESS validation, doesn't need restart on UUID changes.
  - Webhook is called from DELETE `/api/users/devices` only (instant kick).
  - **Not** called on new device add (v34+) — UUID pool makes webhook
    unnecessary for that path.
  - `triggerXraySync('fire-and-forget')` uses `?async=1` query param so the
    Python HTTPServer returns 202 instantly (sync runs in background).
  - **NL Webhook Deadlock (incident 2026-04-25)**: The NL VPS originally ran an
    older `/opt/xray-webhook.py` built on Python's single-threaded `HTTPServer`. A
    `BrokenPipeError` (client disconnect mid-response) wedged the only request thread,
    leaving the service `systemctl status` = active but unable to accept any new
    connections. Symptom: device kicks took **exactly 5 minutes** to drop the user on
    NL (cron interval) while DE dropped instantly. Fix: replace `/opt/xray-webhook.py`
    with the `ThreadingHTTPServer` version from `scripts/xray-webhook.py`. The Germany
    setup script (`scripts/setup-germany-server.sh`) already inlines the threading
    version, so this only ever bit the legacy NL install. To verify reachability from
    your machine: `node scripts/check-webhooks.js`.
  - **DoH Circular Resolution Incident (2026-05-07, RU node)**: The first version of
    `setup-rf-server.sh` configured Xray's DNS to use `https://dns.adguard-dns.com/dns-query`
    as the primary resolver, with the plain-IP AdGuard servers (`94.140.14.14` /
    `94.140.15.15`) listed as secondary. Xray cannot resolve the DoH endpoint's hostname
    without DNS, but the only DNS source is that same DoH endpoint — Xray detects the
    loop (`DOH//dns.adguard-dns.com tries to resolve itself! Use IP or set "hosts" instead`),
    times out after ~5 seconds, then falls back to the plain-IP entries. Adds 5+ seconds
    of wall time to every fresh hostname lookup; symptom on the box was YouTube / Apple /
    Google domains constantly logging `context deadline exceeded` errors and the user's
    phone feeling sluggish. **Fix**: drop the DoH entry, keep only plain-IP AdGuard.
    DoH is irrelevant on the server side — Xray IS the DNS client, the queries never
    leave Xray's process anyway, and AdGuard's ad blocking happens identically over
    plain UDP/53. The script now writes only plain-IP servers; do NOT add DoH back
    without a working `hosts` bootstrap. If you need to patch a deployed VPS without
    re-running the whole script (which would also touch other config sections), the
    one-shot is: `jq '.dns.servers = ["94.140.14.14","94.140.15.15"]'
    /usr/local/etc/xray/config.json > /tmp/x.json && mv /tmp/x.json
    /usr/local/etc/xray/config.json && systemctl restart xray`.
- **/opt/xray-traffic.sh** runs via cron every 5 min, collects per-user traffic
  stats via `xray api statsquery` and POSTs to `/api/xray/traffic?token=TOKEN`.
  Xray stats/policy must be enabled in config (stats:{}, policy with statsUserUplink/Downlink).

### Subscription URL:
- Generated in lib/sub-token.ts via getSubscriptionUrl(telegramId)
- Format: https://hundlervpn.xyz/api/sub/TOKEN
- TOKEN = base64url(telegramId) + HMAC signature (secret: XRAY_SYNC_TOKEN)
- Endpoint: app/api/sub/[token]/route.ts
- Requires env vars: APP_URL and XRAY_SYNC_TOKEN
- **Response format auto-detected by User-Agent** (3 possible formats):
  1. **sing-box JSON** — for NekoBox / NekoRay / sing-box CLI clients.
     Detected by UA substrings: `sing-box`, `singbox`, `nekobox`, `nekoray`.
     Returns full sing-box config with DNS, routing, outbounds.
  2. **Xray JSON** — ONLY for raw Xray-core / v2ray-core CLI (UA substrings: `xray/`, `v2ray/`)
     or via explicit `?format=xray` override. Returns full Xray config with DNS, routing,
     outbounds (see "Xray Config Details" below).
     - **Happ / v2rayNG / Streisand were intentionally removed from this list in v44**
       because they parse JSON subscriptions as a **single profile** (Happ docs § 3.1
       "Принцип прямой передачи 1:1") — multiple `vnext[]` entries or outbounds in one
       JSON become ONE entry in the UI server picker. Those clients now get format #3
       so each server shows up as a separate entry.
  3. **Base64 VLESS URIs** — DEFAULT format for:
     - **Happ** (iOS / Android / Windows / macOS)
     - **v2rayNG** / **Streisand**
     - **v2rayTun** (its parser only accepts base64 URIs, not Xray JSON)
     - **Hiddify Next** (parses URIs into its own sing-box config internally)
     - any unknown UA
     Returns a base64-encoded list of `vless://...` URIs, one per `is_active=TRUE` server.
     Clients show every URI as a separate server in the UI. DNS/routing is handled by
     the client's active routing profile (e.g. Happ's default profile uses CF DoH via proxy).
- **Manual override**: append `?format=singbox` / `?format=xray` to subscription URL to force a format
  (useful for testing or when UA detection fails).

### Client Format Flow:
- Config generation helpers live in `app/api/sub/[token]/route.ts`:
  - `buildSingboxConfig(keys, servers)` — sing-box JSON
  - `buildXrayConfig(uuid, servers)` — Xray JSON
  - plain VLESS URIs via `buildVlessLinkFromServer()` from `lib/sub-token.ts`
- Version marker in response header `X-Code-Version: vNN-...` — used to verify deploy propagation from Timeweb.

### Xray Config Details (Happ / v2rayNG / Windows / etc.):
Current version: **v40-revert-uri-params-2026-04-19** (simplified per v37/v40 cleanup).
- **CRITICAL: DNS interception via `dns-out` outbound.**
  VLESS + Reality uses `xtls-rprx-vision` flow which is TCP-only. Our exit chain is
  VLESS → NL VPS → WARP SOCKS5, and WARP's SOCKS5 doesn't proxy UDP either.
  Without interception, DNS queries (UDP/53) get routed to the VLESS outbound and fail silently →
  browsers show `DNS_PROBE_STARTED` / "Не удаётся найти DNS-адрес сайта".
  Config includes `{ protocol: 'dns', tag: 'dns-out' }` outbound and first routing rule
  `{ port: 53, outboundTag: 'dns-out' }` — Xray resolves DNS internally using its
  `dns.servers` config (`['8.8.8.8', '1.1.1.1']` simple list) and responds directly to
  the client, never sending UDP over the VPN.
- **NO `geoip:` / `geosite:` references.**
  Happ's bundled `geoip.dat` ships without the `RU` section — using `geoip:ru` or
  `geosite:category-ru` triggers "Критическая ошибка XrayCore. файле geoip.dat отсутствует
  секция: RU". Config uses only inline rules: `domain:.ru`, `domain:.su`, `domain:.xn--p1ai`
  (punycode for .рф; **not** regex — unicode regex breaks some clients), hardcoded RU
  service keywords (yandex/sber/vk/ok/wildberries/ozon/mts/megafon/…), and explicit RU IP
  CIDRs (Yandex, VK, Mail, OK, major ISPs, private networks).
- **DNS: `['8.8.8.8', '1.1.1.1']`** — simple list, not tagged servers. Previously had
  tagged `direct-dns`/`proxy-dns`/`fallback-dns` with routing rules like
  `inboundTag: ['direct-dns']`, but those rules were NO-OPS (DNS server tags are NOT
  inbound tags; Xray silently ignores them). Removed for cleanliness.
- **`queryStrategy: 'UseIPv4'`** — prevents IPv6 leaks on Android.
- **Explicit catch-all `{ port: '0-65535', outboundTag: 'proxy' }`** — needed for v2rayTun
  TUN mode (even though `proxy` is first outbound, some clients don't default-route).
- **BitTorrent → direct** (don't burn VPN bandwidth on torrents).
- **Push notifications → direct** (push.apple.com, api.push.apple.com, mtalk.google.com) —
  otherwise iOS/Android push stops working while VPN is on.
- **NO `sockopt.domainStrategy: 'ForceIPv4'`** in outbound streamSettings — removed in v37
  because it caused broken connections on Windows/Android for some users.
- **NO `meta: null` field** — v2rayTun chokes on it. Other clients just ignore.

### v2rayTun Compatibility (CRITICAL):
v2rayTun (iOS/Android/Windows, https://v2raytun.com) is Xray-core based but has a STRICT
subscription parser that **does NOT accept Xray JSON** (with `settings.vnext[]` nested
structure). It only parses **base64 VLESS URIs**.

The internal config v2rayTun builds from a VLESS URI uses a FLAT structure —
`settings: { address, port, id, flow, encryption }` — NOT `settings.vnext[0].users[0]`.
Feeding v2rayTun standard Xray JSON fails silently (no server shown, ping "n/a").

**Detection in `isXrayClient()` (`app/api/sub/[token]/route.ts`):** v2raytun is EXCLUDED.
UA substrings `happ/`, `v2rayng`, `streisand`, `xray/`, `v2ray/` match Xray JSON;
`v2raytun` specifically does NOT. It falls through to the base64 VLESS branch.

**VLESS URI — KEEP MINIMAL.** v2rayTun's URI parser rejects unknown/extra params silently.
Working set (v40):
```
encryption=none&security=reality&type=tcp&sni=...&fp=...&pbk=...&sid=...&flow=xtls-rprx-vision
```
DO NOT add (breaks v2rayTun import):
- `headerType=none`
- `spx=` (empty spiderX)

(Other providers' internal JSON has these fields but v2rayTun generates them from its
own defaults when absent from the URI.)

**Telegram-only symptom (still possible):** If v2rayTun connects but only Telegram works:
- Telegram uses hardcoded DC IPs (no DNS lookup needed) → works
- Other sites need DNS → if client sends DNS as UDP through tunnel, it dies on WARP
- Primary fix is server-side (see "Server-Side UDP Routing" below). Secondary fix is
  enabling FakeDNS / DoH in v2rayTun app settings.

### Server-Side UDP Routing (NL VPS, applied 2026-04-19):
Original Xray config on NL VPS (`/usr/local/etc/xray/config.json`) routed ALL traffic
(TCP+UDP) to the `warp` outbound (SOCKS5 at `127.0.0.1:40000`). But **WARP's SOCKS5 does
not proxy UDP** → all UDP traffic, including DNS (UDP/53), died silently.

Symptom: v2rayTun (which sends DNS as UDP through the tunnel via xudp) connected fine
but only Telegram (hardcoded IPs, no DNS) worked. Happ worked because our Xray JSON for
it has a `dns-out` outbound that intercepts UDP/53 client-side and turns it into TCP DNS
inside the tunnel.

**Fix (`/usr/local/etc/xray/config.json` routing.rules):**
```json
[
  {"type": "field", "inboundTag": ["api"], "outboundTag": "api"},
  {"type": "field", "port": 53, "network": "udp", "outboundTag": "direct"},
  {"type": "field", "network": "udp", "outboundTag": "block"},
  {"type": "field", "network": "tcp", "outboundTag": "warp"}
]
```

- **UDP/53 (DNS) → direct** (freedom outbound): DNS queries leave NL VPS with the server's
  own IP to 8.8.8.8 / 1.1.1.1 etc. Safe — DNS providers never ban for queries.
- **Other UDP → block** (blackhole): QUIC (UDP/443), WebRTC, etc. are dropped.
  Browsers fall back to HTTP/2 over TCP automatically. Prevents server IP from leaking to
  "bannable" destinations (YouTube, CDN, etc.).
- **TCP → warp**: unchanged. VLESS+Reality traffic still egresses through Cloudflare WARP
  for unblocking.

This fix makes DNS work for ALL clients (v2rayTun, Happ, future) without client-side
config. Happ's own `dns-out` interception is still there as a belt-and-suspenders layer.

To verify on NL VPS:
```bash
jq '.routing.rules' /usr/local/etc/xray/config.json
```

### Sing-box Config Details (Hiddify / NekoBox):
- Same split-routing logic as Xray but using sing-box syntax.
- Includes `dns-out` outbound via `{ type: 'dns', tag: 'dns-out' }` and route rule
  `{ protocol: 'dns', outbound: 'dns-out' }`.
- RU domain suffixes + keywords + IP CIDRs identical to Xray config.
- `final: 'proxy'` (or single server tag) is the default for unmatched traffic.
- `auto_detect_interface: true` — survives network changes.
- **CRITICAL: Bootstrap DNS for outbound resolution** (fixes Hiddify timeout).
  The DNS config uses three servers:
  - `dns-proxy` (`tcp://8.8.8.8` through proxy) — final, for foreign domains after tunnel
    is up. Uses plain TCP DNS (not DoH) because Cloudflare DoH was flaky through WARP;
    Google DNS over TCP is lighter and more reliable.
  - `dns-direct` (DoH 77.88.8.8 through direct) — for RU domains.
  - `dns-bootstrap` (plain UDP `8.8.8.8` through direct) — used to resolve the VLESS
    server's own hostname (e.g. `vpn.hundlervpn.xyz`) BEFORE the VPN handshake.
  The critical rule `{ outbound: 'any', server: 'dns-bootstrap' }` ensures all outbound
  server address resolution goes through `dns-bootstrap`, never routing through the VPN
  itself. `dns-local` (address: 'local') CANNOT be used for this because Hiddify's TUN
  interface hijacks the system resolver on startup, creating a deeper circular dep.
- **QUIC blocking** — route rule `{ port: 443, network: ['udp'], outbound: 'block' }`
  blocks HTTP/3 / QUIC (UDP:443). VLESS with vision flow is TCP-only; without this rule,
  browsers hang retrying HTTP/3 over UDP that silently fails through the tunnel.
- **`independent_cache: true`** in DNS config — improves performance.
- **`domain_suffix` without leading dots** — `['ru', 'su', 'рф']` (sing-box convention).
- **No `packet_encoding: 'xudp'`** — deprecated/removed in sing-box ≥ 1.8, incompatible
  with `flow: xtls-rprx-vision` which handles its own packet encoding.
- Version header `X-Code-Version: v20-singbox-tcp-dns-quic-block-2026-04-19` or later.

### Server Display Names (tags / remarks):
- Helper `buildServerTag(server)` in `lib/sub-token.ts` builds a consistent display tag.
- Format: `{flag emoji} {Russian country name} | {server.name from DB}`
  - Example: NL server with `name='LTE'` → `🇳🇱 Нидерланды | LTE`
- Russian country name map in `lib/sub-token.ts` (`COUNTRY_NAMES_RU`): NL, DE, FR, GB, US,
  CA, FI, SE, NO, CH, AT, PL, CZ, TR, JP, SG, HK, KR, RU, BY, KZ, UA. Add more there as
  new regions are launched.
- If `server.name` is empty or generic (`hundler vpn`, `vpn`, `server`) — only flag + country
  name are shown.
- Used in all three formats: sing-box `outbounds[].tag`, Xray config `remarks`, and VLESS URI
  `#fragment`.

### Per-Session UUID System (v41, current) — enables hard device kicks:
v36 briefly used one shared UUID per user (all devices same UUID). That made kick
enforcement impossible: deleting the `device_sessions` row didn't invalidate the
UUID on Xray, so the kicked client kept working via its cached VLESS config.
v41 reverts to **per-session UUIDs** (each `device_sessions` row gets its own
`vpn_keys` row + pool UUID) but preserves the UUID Pool architecture for
instant connect.

**Why the change back to per-session**:
- Security: explicit device kick from the UI MUST invalidate that specific
  device's UUID on Xray, without ejecting the user's other devices.
- Abuse prevention: without per-session UUIDs, a user could kick a device,
  add a new one in the freed slot, and keep the kicked device connected via
  its cached config — effectively getting 4 concurrent devices on a 3-device plan.
- The v36 motivation (v2rayTun confused by multiple UUIDs) was resolved
  separately — v2rayTun receives base64 VLESS URIs with a SINGLE UUID (the
  session's own), not multiple server entries with different UUIDs.

**Implementation (`ensureSessionUuid(sessionId, userId, subId, endDate, deviceName)` in `app/api/sub/[token]/route.ts`):**
1. Look up `device_sessions.vpn_key_id` for this session.
2. If linked AND the linked key is EXCLUSIVE to this session (no other active
   sessions share it) → reuse, refresh expiry.
3. If linked but SHARED with other sessions (legacy pre-v41 user still
   transitioning) → fall through to step 4, leaving the shared key intact for
   the other sessions.
4. Allocate a fresh per-device `vpn_keys` row (`key_uri = 'per-device'`),
   claim a UUID from `uuid_pool` via `acquireUuid(keyId)`, link
   `device_sessions.vpn_key_id = new_key_id`.
5. The UUID is already in Xray config (UUID Pool) under a `pool-N` label,
   so the first connect is instant — NO restart needed on signup.
6. On the next cron `/opt/xray-sync.sh` call, the email flips from `pool-N`
   to `tg-{telegramId}-s{sessionId}` for traffic accounting; the UUID value
   is unchanged.

**Legacy migration from v36 one-UUID-per-user**:
Users whose accounts were created during the v36 window have ONE shared
`vpn_keys` row linked from all their `device_sessions` rows. `ensureSessionUuid`
transparently migrates each session to its own per-device UUID on first
sub refresh: when the "shared" check finds ≥1 other session sharing the key,
the endpoint treats this session as un-linked and allocates a new key. Over
~1 hour (the default `profile-update-interval`), every active session has its
own UUID. The last remaining session on the shared key naturally "takes
ownership" of it (exclusive).

**Limitation during migration**: kicks on a session whose vpn_key is still
shared with others fall back to a **soft kick** — the session row is marked
`kicked_at = NOW()` but the shared UUID is NOT purged from the pool (other
sessions need it). The kicked device can keep connecting via its cached
UUID until either (a) the other sharing sessions migrate and the formerly
shared key becomes exclusive-to-the-kicked-session (then a second kick would
be hard), or (b) subscription expiration triggers the GC. After the 1-hour
migration window, all new kicks are HARD.

### Xray email labelling:
- **Assigned UUIDs**: email `tg-{telegramId}-s{sessionId}` for per-session tracking (used
  by `/opt/xray-traffic.sh` stats). Each session's UUID is unique, and each `tg-...-s...`
  email is likewise unique → no Xray "User X already exists" crash on restart.
- **Free pool UUIDs**: email `pool-N` where N is the `uuid_pool.id`.
- Xray REQUIRES unique `email` per client in `inbounds[].settings.clients[]` — duplicate
  emails crash the service on restart. The `/api/xray/clients` response suffixes every
  assigned UUID with `-s{sessionId}` to guarantee uniqueness even if a single user's
  key_hash somehow got duplicated.

### Device detection (Remnawave headers):
v2rayTun sends Remnawave-style headers: `X-HWID` (stable device hash), `X-Device-OS`,
`X-Device-Model`, `X-App-Version`. `X-HWID` takes priority in `buildDeviceHash`. Happ uses
its own UA format `Happ/ver/Platform/DEVICE_ID` parsed by `extractDeviceId()`.

### Client Application UI Choice:
`HomeView` in `app/page.tsx` (setup wizard step 1) lets users pick between two VPN clients:
- **Happ** (recommended — violet accent, "РЕКОМЕНДУЕТСЯ" badge). Full Xray JSON support
  with DNS interception, RU split-routing, QUIC blocking.
- **v2rayTun** (alternative — red accent). Base64 VLESS import, simpler config, relies on
  server-side UDP routing for DNS to work.

Icons: `components/HappIcon.tsx`, `components/V2RayTunIcon.tsx`. Download links resolved
by `getStoreLink()` in `HomeView`, branch on `setupClient` state (`'happ' | 'v2raytun'`).
Happ has OS-specific + Russia/Global App Store variants; v2rayTun has Windows .exe, iOS/macOS
App Store, Android Play Store (no Linux native build).

**Translations (`translations.ru` / `translations.en`):** `setupClientHappTitle`,
`setupClientHappSubtitle`, `setupClientV2RayTunTitle`, `setupClientV2RayTunSubtitle`,
`setupClientRecommended`, `setupChooseClient`.

### Subscription Response Headers (Happ / Hiddify / v2rayNG / v2rayTun):
- All `/api/sub/[token]` responses include these HTTP headers:
  - `subscription-userinfo: upload=0; download={bytes}; total=0; expire={unix_ts}`
    `total=0` means **infinite traffic** in client UI. Backend still tracks bytes.
    `download` = `subscriptions.traffic_used_bytes` (accumulated via `/api/xray/traffic`).
  - `profile-update-interval: 1` — auto-refresh subscription every 1 hour.
  - `profile-title: Hundler VPN` — displayed as subscription name.
  - `support-url: https://t.me/hundlervpnbot` — Telegram icon in client UI.
  - `profile-web-page-url: https://hundlervpn.xyz` — website icon in client UI.

### Traffic Tracking (unlimited, no cutoff):
- `plans.traffic_limit` (BIGINT, bytes) — exists in schema but NOT enforced.
- `subscriptions.traffic_used_bytes` (BIGINT) — accumulated upload+download for stats only.
- `/api/xray/clients` does NOT check traffic_used_bytes — traffic is unlimited.
- `/api/xray/traffic` — POST endpoint for VPN servers to report per-user traffic stats.
  Body: `{ stats: [{ email: "tg-123-s42", uplink: N, downlink: N }] }`.
  Auth: `?token=XRAY_SYNC_TOKEN`. Accumulates bytes into active subscription.
- NL VPS runs `/opt/xray-traffic.sh` via cron every 5 min (uses `xray api statsquery`).

### Device Limit Responses:
- When device limit exceeded, response depends on detected format:
  - **sing-box / Xray clients** → JSON `{ meta: null, outbounds: null, remarks: "⛔ Лимит устройств: X/X..." }`
    so Happ/Hiddify show the message in UI without crashing.
  - **Fallback clients** → base64 list of fake VLESS URIs with limit message in the `#fragment`.
- Response header `Profile-Title: Hundler VPN - Device Limit` signals the state to clients
  that respect subscription metadata.


## Security (VLESS vulnerability — April 2026):
- All VLESS clients expose unauthenticated SOCKS5 on localhost — spyware can detect VPN exit IP
- Our architecture mitigates this: entry (Yandex Cloud) ≠ exit (WARP/Cloudflare)
- Spyware sees only Cloudflare WARP IP, not our server IPs
- Happ client has additional vulnerability (xray API without auth, can dump configs)
- Consider blocking Happ by User-Agent in subscription endpoint if needed


## Adding a New VPN Server:
1. Set up VPS with Xray (VLESS + Reality)
2. INSERT into DB: servers (name, host, port, country, public_key, sni, short_id, fingerprint, flow, is_active=true)
3. Install /opt/xray-sync.sh on the server with correct API_URL and token
4. Add cron: */5 * * * * /opt/xray-sync.sh >> /var/log/xray-sync.log 2>&1
5. Subscription URLs will automatically include the new server


## v62 (2026-05-15): Hy2 outbound emission re-enabled + protocols field on /api/servers

После 2026-05-09 (XUDP migration, v60) Hy2 outbound emission был
**удалён** из `app/api/sub/[token]/route.ts::buildSingboxConfig` — XUDP-
on-VLESS уже несёт UDP внутри TCP/443 Reality stream, отдельный Hy2
не давал бенефита для TG voice. Сервер на DE 213.182.213.183:8443
оставили живым, но клиентам перестали о нём говорить.

**v62 возвращает Hy2 emission**, потому что Windows-клиент получил
полноценный UI выбора протокола (см. `hundlerwindows/WINDOWS-AGENTS.md`
батч 2026-05-15). Теперь юзер на экране Локаций может переключиться
с VLESS на Hysteria, и клиент должен иметь Hy2 outbound в
sing-box JSON чтобы это работало.

### Изменения

1. **`app/api/sub/[token]/route.ts::buildSingboxConfig`** (строки ~648-680):
   ```ts
   if (
     server.hysteria2_port &&
     server.hysteria2_password &&
     server.hysteria2_sni &&
     server.hysteria2_cert_sha256
   ) {
     const hy2Tag = `${tag} (Hy2)`;
     proxyTags.push(hy2Tag);
     outbounds.push({
       type: 'hysteria2',
       tag: hy2Tag,
       server: clientHost(server),
       server_port: server.hysteria2_port,
       password: server.hysteria2_password,
       tls: {
         enabled: true,
         server_name: server.hysteria2_sni,
         alpn: ['h3'],
         pin_sha256: [server.hysteria2_cert_sha256],
       },
     });
   }
   ```
   Tag-суффикс `(Hy2)` обязателен — клиент-side
   `SingboxConfigPatch.filterOutboundsByProtocol` использует
   `outbound.type === 'hysteria2'` для keep/drop, но человеку, который
   читает JSON в дебаге, удобно видеть что это за tag.

2. **`app/api/servers/route.ts`** — добавлено поле `protocols: string[]`
   per-server. Возможные значения: `['vless']` или `['vless', 'hysteria']`.
   Бэкенд НЕ возвращает `hysteria2_password` / `hysteria2_cert_sha256`
   в этот эндпоинт — только бинарный факт «Hy2 настроен на этом
   сервере». Реальные креденшелы остаются в gated `/api/sub/{token}`.

   ```ts
   const protocols: string[] = ['vless'];
   if (s.hysteria2_port && s.hysteria2_password) {
     protocols.push('hysteria');
   }
   ```

   Замечание: shorter `'hysteria'` (без `2`) — UI-tag,
   используемый клиентским `HundlerServer.supports()`.
   Sing-box `outbound.type === 'hysteria2'` — отдельная вселенная.

### Hy2 server inventory (по состоянию на 2026-05-15)

- **DE 213.182.213.183** — единственный с Hy2. Креденшелы в БД
  (`hysteria2_port=8443`, `hysteria2_password=66004e76...`,
  `hysteria2_sni=de.hundlervpn.xyz`,
  `hysteria2_cert_sha256=281310e4...`).
- **NL / RU** — пока без Hy2. Чтобы добавить:
  1. На VPS: `bash scripts/setup-{nl,rf}-hysteria2.sh` (TBD,
     по образцу `setup-germany-hysteria2.sh`).
  2. Скрипт пишет креды в `/etc/hysteria/.password` и cert в
     `/etc/hysteria/cert/`. Распечатает sha256 fingerprint.
  3. UPDATE servers SET hysteria2_port=8443, hysteria2_password='...',
     hysteria2_sni='nl.hundlervpn.xyz', hysteria2_cert_sha256='...'
     WHERE country='NL'.
  4. Никаких изменений в `route.ts` не требуется — код уже
     iterates всех серверов с заполненными hysteria2_* колонками.

### Что НЕ меняется

Phase-1/v55 route rule «TG-CIDR → hy2Tags[0]» в `buildSingboxConfig`
**намеренно не возвращён**. Аргументы:
- TG voice через XUDP-on-VLESS работает на DE/NL/RU после v60 — нет
  необходимости отдельно гнать TG-CIDR через Hy2.
- В v62 Hy2 — это явный «секондари путь, выбираемый юзером в UI», а
  не auto-routing для TG. Юзер сам решает что хочет переключиться.
- Если позже понадобится — рестора одной строкой из git-истории
  (commit `6e2f867` v55).

### Для других нативных клиентов (Android / iOS)

Текущий Android-клиент (`hundlerandroid/`) Hy2 НЕ использует —
там стоит однопрофильный sing-box и protocol switcher не реализован.
Если на Android захотят Hy2:
1. Скопировать `vpn_protocol_controller.dart` + `_ProtocolToggle`
   из `hundlerwindows/lib/features/{vpn,servers}/` в Android.
2. Расширить `HundlerServer.fromJson` чтобы парсить `protocols`.
3. В `CoreManager.kt::injectTunInboundIfMissing` добавить вызов
   `filterOutboundsByProtocol` ДО старта sing-box.
Никаких изменений на бэкенде сверх v62 не нужно — API уже отдаёт всё.

---


## Known issue: traffic-collector — RU остался (2026-05-16)

`/opt/xray-traffic.sh` + `/etc/cron.d/xray-traffic` (через
`scripts/install-xray-traffic-collector.sh`) сейчас развёрнуты на
**NL + DE**. RU (`85.239.53.25`) пока без локального collector'a, поэтому
в БД `user_server_traffic` нет записей с `server_id=5`.

История: 2026-05-15 был только NL. 2026-05-16 (одна сессия с
Hy2 HTTP auth, v63) поставили DE — после `setup-germany-hysteria2.sh`
запускается `install-xray-traffic-collector.sh`, который при первом
run сразу пушит `Pushed N users to 213.182.213.183 (id=4)`. RU отложили
на потом.

**Не путать с реальной работой сервера**: DE/RU Xray принимает трафик
нормально, юзеры подключаются, всё ходит. Просто на бэкенд per-user
статистика по этим нодам не льётся.

### Что это меняет

- ⚠️ **Админ-метрики per-server неполные** — в любом дашборде «трафик
  по регионам» DE/RU будут показаны как «никто не пользуется», что
  ложь (см. `journalctl -u xray | grep accepted` на DE — там идёт
  активный поток).
- ✅ **Биллинг не задет** — квот ни у одного сервера нет
  (`servers.traffic_limit_bytes = NULL` для всех 3 активных).
  `quota_exceeded` всегда false. Поэтому `/api/sub/{token}` никому
  не дропает DE/RU из списка.
- ✅ **Глобальный `subscription.traffic_used_bytes`** — обновляется по
  NL-only данным. Не критично, юзеры видят «использовано N GB»
  заниженным.
- ❌ **Антифрод слепнет на DE/RU** — если юзер качает 500GB/день
  через DE, не отловим. Маловероятный сценарий пока без квот.

### Diagnostic: статус collector'ов

```powershell
node scripts/diag-de-traffic.mjs
# Если в "Traffic summary per server" только NL — collector на DE/RU не работает.
```

Альтернатива на сервере:
```bash
ssh root@213.182.213.183 'ls -la /opt/xray-traffic.sh /etc/cron.d/xray-traffic 2>&1; tail -3 /var/log/xray-traffic.log 2>&1'
# "No such file or directory" → не установлен.
```

### Fix (когда понадобится)

```bash
ssh root@213.182.213.183 'bash -s' < scripts/install-xray-traffic-collector.sh
ssh root@85.239.53.25  'bash -s' < scripts/install-xray-traffic-collector.sh
```

Скрипт идемпотентен. Если Xray config надо патчить (добавляет `stats:
{}` + `policy.levels.0.statsUserUplink/Downlink` + api-inbound на
:10085) — будет `systemctl restart xray`, **~2 секунды дисконнекта
всех активных юзеров на этой ноде**. Делать в неактивное время.

После: через 5-10 минут проверить
`ssh root@<host> 'tail /var/log/xray-traffic.log'` — должны быть
строки `Pushed N users to <host> ...`. Через 15-30 минут
`diag-de-traffic.mjs` покажет DE/RU в summary.

### NB про названия серверов

В БД (`servers.name`) реальные значения **отличаются** от того что
видит юзер в Happ profile tag:

| id | DB name           | country | UI display (buildServerTag)                 |
|----|-------------------|---------|---------------------------------------------|
| 4  | `Германия`        | DE      | `🇩🇪 Германия`                             |
| 3  | `Обход Глушилок`  | NL      | `🇳🇱 Нидерланды \| Обход Глушилок`         |
| 5  | `YouTube`         | RU      | `🇷🇺 Россия \| YouTube`                    |

`buildServerTag` (см. `lib/sub-token.ts`) **дедупит** если `name ==
countryName` — поэтому DE показывается как `🇩🇪 Германия` без
`| Германия` суффикса.

### Историческая справка

Раньше (~2026-05-10) на NL был установлен `traffic_limit_bytes = 50GB`
с anti-abuse-bot rationale (см. комментарий в
`scripts/add-server-traffic-limits.js`). Позже всё было снято через
`scripts/remove-all-server-traffic-limits.js`. Сейчас никаких лимитов
нигде нет — это и есть текущая прод-конфигурация.

---


## v63 (2026-05-16): Hy2 per-user HTTP auth + admin Серверы split

Две связанные правки одной сессией. Решают «Hy2 не отключается при
expire подписки / kick устройства» и «в админке Германия одна
карточка, не понятно VLESS или Hysteria».

### A. Hy2 HTTP auth (per-user)

До v63 Hysteria2 на DE 213.182.213.183 использовал **один глобальный
password** `66004e76f286dfd3c4760dacca57671c` (cache в
`/etc/hysteria/.password`). При истечении подписки или kick устройства:
- VLESS отключался через purge `uuid_pool` + webhook → xray restart.
- Hy2 **не отключался** — пароль один для всех, никак не привязан к
  конкретному user_id. Юзер с истёкшей подпиской продолжал гонять
  трафик через Hy2 без ограничений.

**Фикс**: переключение Hy2 на `auth: { type: http, http: { url } }`.
На каждый new client connection Hy2 server делает POST на
`/api/hysteria/auth` с `{ addr, auth, tx }`, где `auth` = sub-token
конкретного юзера. Backend парсит токен через `parseSubTokenV2`,
смотрит активность подписки и отвечает `{ok:true, id:"tg-<id>"}` или
`{ok:false}`. Hy2 кеширует ответ только на время одной QUIC connection
— при reconnect повторяет запрос. Это даёт мгновенное отключение
(в пределах session timeout, ~30 сек).

**Код:**
- `app/api/hysteria/auth/route.ts` — backend endpoint. Optional
  `HYSTERIA_AUTH_SECRET` env для проверки `X-Hysteria-Secret` header
  (если задан — отказываем без него).
- `app/api/sub/[token]/route.ts` — sing-box Hy2 outbound + Happ Xray
  profile теперь emit'ят `password: <userSubToken>` / `auth:
  <userSubToken>` вместо `server.hysteria2_password`. `hy2AuthToken`
  параметр прокинут через `buildSingboxConfig`, `buildHappJsonArray`,
  `buildHappSingleServerHy2Profile`.
- `app/api/xray/traffic/route.ts` — regex для email расширен с
  `/^tg-(\d+)-/` на `/^tg-(\d+)(?:-|$)/` чтобы принимать Hy2-формат
  `tg-{telegramId}` (без `-s{sessionId}` суффикса). Пригодится для
  будущего Hy2 traffic collector.
- `scripts/setup-germany-hysteria2.sh` — `auth.type: password` →
  `auth.type: http`. Также генерирует `/etc/hysteria/.traffic-secret`
  (для будущего trafficStats API, см. ниже).

**Sub-token формат напоминание** (`lib/sub-token.ts`):
- TG-based: `<base64url(telegramId)><12-char hmac>` (e.g.
  `MjAyOTA2NTc3MA==Hash12chars`)
- User-id based: `u<base64url(userId)><12-char hmac>`

При деплое backend ДО переустановки Hy2 — старые клиенты, у которых
в Hy2 outbound записан общий статический password, получат
`{ok:false}` и отвалятся. Они вернутся когда их клиент сделает
`profile-update-interval` поллинг (1 час) и получит новую подписку с
sub-token-as-password.

### B. Hy2 trafficStats API + collector (готово)

`setup-germany-hysteria2.sh` добавляет в `/etc/hysteria/config.yaml`
блок `trafficStats: { listen: 127.0.0.1:7653, secret: <random> }`.
Hy2 слушает локально и отдаёт per-user uplink/downlink при
`GET /traffic?clear=1` с `Authorization: <secret>`.

`scripts/install-hy2-traffic-collector.sh` — идемпотентный
installer. Ставит `/opt/hy2-traffic.sh` + `/etc/cron.d/hy2-traffic`
(каждые 5 мин). Скрипт сам допилит `trafficStats` блок если в config
его не было (для серверов поставленных старой версией setup script).
Collector поллит API c `clear=1` → конвертит `{tx,rx}` в
`{uplink,downlink}` → POSTит на `/api/xray/traffic` с email
`tg-{telegramId}`.

### B.1 Migration: user_server_traffic.protocol (2026-05-16)

Чтобы VLESS и Hy2 трафик не сливались в одну строку, в таблице
`user_server_traffic` добавлена колонка `protocol VARCHAR(10) NOT NULL
DEFAULT 'vless'`. Новый PK — `(user_id, server_id, protocol)`.
Migration сделан одноразово через `scripts/migrate-traffic-protocol.mjs`
(скрипт удалён после успешного прогона); existing 43 строки получили
protocol='vless'.

**Зависимые места кода** (все обновлены в одной сессии):
- `/api/xray/traffic`: regex `^tg-(\d+)(-s\d+)?$` определяет protocol
  по наличию суффикса `-sN`. UPSERT идёт по composite key.
- `/api/admin/connections`: SQL переписан на `COUNT(*) FILTER (WHERE
  protocol = 'vless')` / `... 'hy2'` — отдельные агрегаты на карточку.
- `/api/sub/[token]` quota_exceeded: LEFT JOIN → LEFT JOIN LATERAL с
  `SUM(bytes_used)` чтобы не задублить серверы в результате (с новым
  PK у юзера может быть 2 строки на сервер — vless + hy2).

### B.2 Migration: user_server_traffic.last_active_at (2026-05-16)

До: "online" в админке = `updated_at < 10 min ago`. Срабатывало на
**любые** bytes > 0, включая TLS keep-alive (1-10 KB / 5min) — юзер с
мёртвым/idle VPN показывался online. По диагностике на момент введения
8 из 51 строк (16%) были false-online.

После: добавлена колонка `last_active_at TIMESTAMPTZ` (nullable).
Обновляется **только если** в 5-минутном батче трафика ≥ 100 KB
(порог настраивается через env `ACTIVE_BYTES_THRESHOLD`, default 102400).
`bytes_used` и `updated_at` продолжают апдейтиться как раньше — квоты не
теряют ни одного байта.

Backfill: для existing 43 vless-строк скопировали `updated_at →
last_active_at` где `bytes_used > 100KB`. Index
`idx_user_server_traffic_last_active_at` для быстрых "active in last N"
запросов. Migration script удалён.

**Зависимые места кода**:
- `/api/xray/traffic`: UPSERT добавляет `last_active_at = CASE WHEN
  $5 THEN NOW() ELSE old.last_active_at END`, где `$5` = `bytes >=
  ACTIVE_THRESHOLD_BYTES`. Threshold = `process.env.ACTIVE_BYTES_THRESHOLD
  || 102400`.
- `/api/admin/connections`: все FILTER и WHERE по `ust.updated_at` →
  `ust.last_active_at`. Юзеры с idle/handshake не попадают в "online" /
  "last_24h" / "last_7d" и не светятся в expanded user list.

**Порог 100 KB обоснование**: TLS keep-alive Reality 1-10 KB / 5 мин,
TG sync 50-200 KB, web browsing 1-50 MB, YouTube HD 30-100 MB.
100 KB — точно отсекает keep-alive, но ловит даже минимальную реальную
активность.

### B.3 Live admin refresh: webhook POST /traffic (2026-05-16)

До: cron на каждом VPS дёргает `/opt/xray-traffic.sh` и
`/opt/hy2-traffic.sh` раз в **5 минут**. Кнопка «Обновить» в админке
просто перечитывала БД — но БД сама обновляется только cron'ом, так что
кнопка показывала те же данные пока юзер не подождёт 5 мин. Теряла
смысл.

После: новая ручка `triggerTrafficRefresh()` в `lib/xray-webhook.ts`
параллельно дёргает каждый VPN-сервер по `POST /traffic` и **ждёт**
пока collector'ы запушат свежий трафик в `/api/xray/traffic`. Только
потом читает БД.

**Поток**:
```
Admin clicks ↻ Обновить
  → GET /api/admin/connections?refresh=1&telegramId=…
    → triggerTrafficRefresh()
      → fan-out POST http://{nl,de,ru}:9999/traffic?token=…
        → xray-webhook.py /traffic
          → /opt/xray-traffic.sh (sync, ~2-5s) → /api/xray/traffic UPSERT
          → /opt/hy2-traffic.sh (если есть, sync, ~1-2s) → UPSERT
        → 200 {ok:true, results:[...]}
      → wait 200ms (UPSERT settle)
    → SELECT user_server_traffic …
  → return {servers, refresh:{ok, servers:[…per-vps…]}}
```

UI рисует:
- Кнопка показывает «Опрос VPS…» вместо «...» пока идёт fan-out
- Под "Обновлено: HH:MM:SS" — мелкая строка `Live-pull: 3/3 серверов`
  (зелёная) или `2/3 серверов · de.host: timeout` (амбер + перечисление
  упавших VPS)
- Если `XRAY_WEBHOOK_URL` env не настроен → амбер ⚠ предупреждение.

**Periodic 30s polling** в админке остаётся **без** `refresh=1` —
просто перечитывает БД. Иначе мы бы долбили все VPS каждые 30 секунд
без причины.

**Изменения на стороне VPS**:
`scripts/xray-webhook.py` теперь поддерживает оба endpoint'а в одном
listener'е:
- `POST /sync` (старый, fire-and-forget, для UUID changes)
- `POST /traffic` (новый, синхронный, для admin live-pull)
- `GET /health` — теперь возвращает `{ok, version, sync_script,
  traffic_scripts:[…installed paths…]}` для introspection

`xray-webhook.py` использует `ThreadingHTTPServer` так что параллельные
запросы /sync и /traffic не блокируют друг друга.

**Деплой обновления webhook на VPS**:
Создан скрипт `scripts/update-xray-webhook.sh` — pull latest +
verify + restart + revert on fail. Запускать на каждом VPS
(NL/DE/RU) после мерджа в main:
```bash
ssh root@<vps>
curl -fsSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/scripts/update-xray-webhook.sh | bash
```

**Env vars (Hostman / .env.local)**:
- `XRAY_WEBHOOK_URL` — comma-separated `/sync` URLs всех VPN-серверов:
  `http://nl-host:9999/sync,http://de-host:9999/sync,http://ru-host:9999/sync`
  (helper сам заменяет `/sync` → `/traffic` для refresh fan-out).
- `XRAY_WEBHOOK_TOKEN` — общий secret, должен совпадать с
  `SYNC_TOKEN` в `/etc/default/xray-webhook` на каждом VPS.

### C. Admin Серверы: split DE на VLESS + Hysteria

Источник правды — `app/api/admin/connections/route.ts`. До v63 для
DE рисовалась **одна карточка «Германия»** с агрегатом трафика, но
админ не мог понять идёт ли он через VLESS или через Hy2.

**Фикс**:
- SQL запрос добавил `(s.hysteria2_port IS NOT NULL AND
  s.hysteria2_password IS NOT NULL) AS has_hy2`.
- Response build: для каждой строки `servers` эмитим карточку VLESS
  (всегда), плюс ещё одну Hy2 (если has_hy2). У них одинаковый `id`
  но разный `protocol: 'vless' | 'hy2'` + composite `key:
  ${id}-${protocol}`.
- Hy2-карточка пока всегда показывает `active_now: 0`, `last_24h: 0`,
  `users: []` и флаг `hy2_pending_collector: true` (потому что Hy2
  traffic collector ещё не написан, см. п. B). UI рендерит этот
  состояние как сноску «Hy2 traffic collector не установлен» вместо
  тупого «нет данных».
- VLESS-карточка карта получает суффикс «VLESS» в имени (например
  «Германия VLESS»), Hy2-карточка — «Hysteria».
- UI (`app/page.tsx`): `ConnServer.key`, `ConnServer.protocol`,
  `connExpanded: Set<string>` (был `Set<number>`), бэдж VLESS (синий) /
  HY2 (оранжевый) рядом с именем сервера.

Когда Hy2 traffic collector будет установлен — backend начнёт пушить
данные в карточку (нужно расширить SQL по `protocol`-колонке) и
`hy2_pending_collector` уйдёт.

### Удалили мусор

`scripts/delete-server-1.mjs` (одноразовый) — удалили `servers WHERE
id = 1` (host `2.27.40.77`, NL, `is_active=false`, FK refs 0). Это
был старый NL-эндпоинт ещё до миграции на `vpn.hundlervpn.xyz`. В
админке больше не торчит «Обход Глушилок OFF». Скрипт удалён после
успешного выполнения.
