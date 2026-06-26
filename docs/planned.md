## Planned: Multi-Region Web Hosting (idea, not implemented yet)
Goal: serve hundlervpn.xyz fast and reliably both for RU users and for users outside Russia.
- Current state: site hosted only on Timeweb (RU datacenter). RU users are fine; non-RU users may see slower loads / regional blocks of RU IPs.
- Plan (staged rollout):
  1. **Stage 1 — Cloudflare Free in front of hundlervpn.xyz.** Proxy A-record (orange cloud), origin stays on Timeweb. Static assets cached at edge POPs (Moscow, Amsterdam, Frankfurt, etc.). Hides origin IP. Zero cost, ~15 min to set up.
  2. **Stage 2 — NL web mirror + geo-routing.** Deploy the Next.js app on a separate NL VPS (NOT the NL Xray node — use a dedicated NL web VPS). Use Cloudflare Load Balancer ($5/mo) with Geo Steering: country=RU → Timeweb origin, else → NL mirror. Alternative: Cloudflare Worker that routes by `req.cf.country` (free up to 100k req/day).
- Constraints to handle for Stage 2:
  - DB stays in Hostman managed PG (<DB_HOST>, v68). NL mirror must reach it over internet → IP whitelist in the Hostman Postgres dashboard for the NL mirror's egress IP, or tunnel via WireGuard. Adds ~70ms latency per DB query if the mirror sits on a non-EU exit.
  - All env vars (XRAY_SYNC_TOKEN, PLATEGA_SECRET_KEY, OXAPAY_API_KEY, RESEND_API_KEY, etc.) must be synced to both origins.
  - Payment callbacks (/api/payments/sbp/callback, /api/payments/crypto/callback) hit whichever origin Cloudflare routes the callback IP to — both origins must be able to process them (same DB, same secrets).
  - Xray sync script (/opt/xray-sync.sh on VPN servers) calls APP_URL which is behind Cloudflare — both origins must expose /api/xray/clients identically.
- Recommendation: start with Stage 1. Only move to Stage 2 if latency/availability complaints from non-RU users persist after Cloudflare is in place.


## Planned: Per-Server SNI & Anti-Block Hardening (ideas, not implemented yet)

**Discussed 2026-05-03 after analysing competitors (Latvia bridge using
`max.ru` steal-SNI; Volna VPN using self-hosted `*.volna-vpn.sbs`).** Goal:
make HundlerVPN harder to detect/block by RKM-class DPI, especially on
the SNI/IP-correlation vector that current Russian DPI is starting to use.

### Current state (the problem)
- **All servers (NL + DE) share the same SNI**: `www.microsoft.com`
  (hardcoded as default in `scripts/setup-germany-server.sh` line 34 and
  `scripts/install-xray-sync.sh` line 18, mirrored into `servers.sni` in DB).
- **All servers listen on the same port**: 443.
- **Steal-mode Reality**: `realitySettings.dest = "www.microsoft.com:443"`,
  the NL/DE Xray fetches the live TLS handshake from the real Microsoft
  every time a client connects.

Three concrete failure modes:
1. **`microsoft.com` is on Russia's sanctions blast-radius.** If RKM
   ever decides to null-route the Microsoft IP ranges (post-sanction
   escalation, plausible), `realitySettings.dest` cannot complete →
   Reality handshake fails → entire fleet dies simultaneously.
2. **SNI/IP correlation check (already shipped on TSPU boxes per
   leaks).** DPI resolves `microsoft.com` → set of legit Microsoft IPs.
   Then checks: "is the destination IP I'm seeing this TLS to actually
   in that set?" Our node IPs are obviously NOT in
   Microsoft's IP space → flagged as spoofed-SNI VPN.
3. **One SNI = one block-rule.** A single firewall rule
   `block sni=www.microsoft.com when dst_ip not in microsoft_subnet`
   takes down every HundlerVPN server at once. No graceful degradation.

### Proposal A — short-term fix: switch to a Russian steal-SNI
Cheapest, fastest mitigation. **Migrate `realitySettings.dest` and
`serverNames` from `www.microsoft.com` to `max.ru`** on NL and DE.
Latvian competitor in the analysed config does exactly this.

Pros:
- Zero infra cost (no domain, no cert).
- Mail.ru / VK Group is systemic in RU → not getting blocked by RKM.
- Doesn't require any client-side migration logic — once Xray config
  is updated and `servers.sni` is updated, `/api/sub/[token]` regenerates
  the VLESS URI and Happ/v2rayTun pulls the new config within 1 hour
  (`profile-update-interval: 1`).

Cons (still present):
- Still fails SNI/IP correlation (max.ru's real IPs are Mail.ru's, ours
  aren't).
- Still one SNI for the whole fleet.

Implementation:
1. SQL: `UPDATE servers SET sni='max.ru' WHERE is_active=true;`
2. SSH each VPN VPS, edit `/usr/local/etc/xray/config.json`:
   `realitySettings.dest = "max.ru:443"`, `serverNames = ["max.ru"]`.
3. `xray -test -config /usr/local/etc/xray/config.json && systemctl restart xray`.
4. Update both setup scripts (`setup-germany-server.sh` line 34-35,
   `install-xray-sync.sh` line 18-19) so future servers default to
   `max.ru` too.

⚠️ Restart drops all active connections for 5-15s. Schedule for low-load
window (early morning Moscow time) and announce in TG.

### Proposal B — long-term fix: self-hosted SNI per server (Volna-style)
**Best-in-class anti-block** technique used by serious commercial VPNs
(Mullvad, ProtonVPN, Volna). Each server gets its own subdomain of
`hundlervpn.xyz`, its own real Let's Encrypt cert, and Reality's
`dest` points to a local nginx that holds that cert.

Architecture:
```
DNS:
  obxod.hundlervpn.xyz  A  195.216.169.154  (NL direct IP)
  de.hundlervpn.xyz   A   <DE_SERVER_IP>   (DE direct IP)
  it.hundlervpn.xyz   A   <next server>     (etc.)

Per VPS:
  - certbot --standalone -d <subdomain>.hundlervpn.xyz   (port 80 used briefly)
  - nginx on 127.0.0.1:8443 with the LE cert + a fake "coming soon" landing
  - Xray realitySettings:
      "dest": "127.0.0.1:8443"
      "serverNames": ["<subdomain>.hundlervpn.xyz"]
```

Why this beats steal-mode:
- **SNI/IP correlation PASSES**: DNS for `nl.hundlervpn.xyz` legitimately
  points to our YC IP, so DPI's check "does dst_ip match SNI's DNS?"
  returns YES.
- **No external dependency**: Reality dest is `127.0.0.1` — nothing on
  the public internet can break our handshake.
- **Per-server isolation**: blocking `nl.hundlervpn.xyz` doesn't take
  out `de.hundlervpn.xyz`. RKM has to write N rules for N servers.
- **Different ports per server are cheap to add** (e.g. NL on 443, DE
  on 8443) — already supported by `servers.port` column.
- **Wildcard cert** via Let's Encrypt DNS-01 challenge for
  `*.hundlervpn.xyz` removes the need to renew per-subdomain.

Cost: domain we already own + ~30 min provisioning per server + free LE
certs (auto-renew via certbot timer). Total marginal cost: $0.

Implementation plan:
1. **DNS**: add A-records for each existing/planned server (`nl.`, `de.`, …).
2. **New helper script** `scripts/setup-self-hosted-sni.sh` (idempotent,
   like `setup-germany-server.sh`):
   - Apt-get certbot + nginx.
   - Run `certbot certonly --standalone -d $SUBDOMAIN` (or DNS-01 if
     port 80 is busy — preferred for wildcard).
   - Drop a minimal nginx vhost on `127.0.0.1:8443` with `ssl_certificate`
     pointing to the LE cert and a static fake-landing root.
   - Patch `/usr/local/etc/xray/config.json`: replace `dest` and
     `serverNames` with the new subdomain values.
   - `xray -test && systemctl restart xray`.
3. **DB migration**: `UPDATE servers SET sni='<sub>.hundlervpn.xyz',
   host='<sub>.hundlervpn.xyz' WHERE id=<id>;`. (Note: `host` already
   uses a domain for NL; this just generalises it to all.)
4. **Fake landing**: a single static `index.html` per server checked
   into `scripts/fake-landings/` so all servers serve a consistent
   "coming soon"/blog template if someone hits the subdomain in a
   browser. Different per region for plausibility.
5. **Setup-germany-server.sh + install-xray-sync.sh**: update defaults
   to **require** `--sni` and `--reality-dest=127.0.0.1:8443` rather
   than fall back to `www.microsoft.com` — prevents future sloppiness.

Risk + mitigation:
- **Cert renewal**: LE certs expire every 90 days. certbot timer handles
  it automatically, but if it ever fails Reality dest will keep working
  (cert is fetched from local nginx, but the cert mismatch surface is
  small — Reality doesn't validate cert chain). Still, monitor with a
  cron that pings `https://<sub>.hundlervpn.xyz` weekly.
- **Subdomain enumeration**: someone scraping CT logs sees all our
  server subdomains. Mitigation: use random-looking subdomains
  (e.g. `nl-r1.hundlervpn.xyz`, `nl-r2.hundlervpn.xyz`) and rotate
  occasionally. Not urgent.

### Proposal C — defence-in-depth: vary ports and fingerprints across the fleet
On top of Proposal B, give different servers different (port, fingerprint)
tuples so RKM can't write a "block all VLESS-Reality on :443 with
chrome fingerprint" rule and kill us with a single line.

| Server | Port | Fingerprint | SNI |
|---|---|---|---|
| NL | 443 | chrome | nl.hundlervpn.xyz |
| DE | 8443 | firefox | de.hundlervpn.xyz |
| IT (future) | 2053 | safari | it.hundlervpn.xyz |
| TR (future) | 443 | chrome | tr.hundlervpn.xyz |

`servers` table already has `port` and `fingerprint` columns; only
`/api/sub/[token]` needs to verify it propagates them per-row (it does).


## Planned: Speed Optimisations (ideas, not implemented yet)

**Discussed 2026-05-03 after user reported ~50% throughput loss
through VPN (235 → 110 Mbps download).** Speed loss is normal for our
stack but every step here can recover some of it.

Ranked by expected impact, easiest first:

### 1. Enable BBR congestion control on every VPN VPS — FREE, ~10-30% gain
Linux defaults to TCP CUBIC. BBR (Google) is dramatically better on
long-RTT lossy links — which is exactly the YC→NL→WARP→internet path.
One-time setup per VPS:
```bash
echo "net.core.default_qdisc=fq"          >> /etc/sysctl.conf
echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf
sysctl -p
sysctl net.ipv4.tcp_congestion_control   # verify == bbr
```
Add to `scripts/setup-germany-server.sh` as a default step so every
new server gets it from day one.

### 2. WARP+ subscription — ~$5/mo per server, +50-80% throughput
WARP free tier is rate-limited around 100-150 Mbps per connection
(matches our observed throughput exactly). WARP+ ($4.99/mo via
Cloudflare) removes the limit. Replace `wgcf` profile on each VPS
with a WARP+ keypair (one-time, no architectural change). Same
SOCKS5 endpoint on `127.0.0.1:40000`, just faster.

Bonus: free WARP+ keys can be generated via TG bots like
`@generatewarpplusbot` (rotated periodically) for testing before
committing to paid.

### 3. Use DE instead of NL for users who care about speed — already shipped
DE flow is 1 hop shorter (no YC→NL bridge). 10-15% better throughput,
~30 ms lower ping. Just a UX/marketing nudge, no code changes — the
"Pro" label is already there.

### 4. Optional "Direct" servers (no WARP) — +80-100%, BUT VPS IP visible
Add a separate server entry per region with `outbound = freedom`
instead of WARP SOCKS5. Faster, but the user's traffic exits with
the VPS IP — which means:
- Sites can fingerprint our VPS IP and block it (CAPTCHAs, geo-fences).
- RKM correlation easier ("traffic exiting from this DE IP
  consistently looks like VLESS-Reality client"). Eventually leads
  to the IP being blocked.

Use case: power users who want raw speed, accept the trade-off.
UX label idea: "🇩🇪 Germany Speed (no WARP, IP exposed)".

### 5. VPS upgrade to 2+ vCPU — ~$10/mo, raises single-stream ceiling
VLESS Vision crypto is single-threaded per connection. On 1-vCPU VPS
the ceiling is ~150-200 Mbps regardless of channel speed. 2-vCPU
roughly doubles single-user ceiling because the kernel can interleave
crypto across cores when paired with multi-stream clients.

### 6. MTU / MSS clamping — situational, free
Some ISPs fragment 1500-byte packets through VPN tunnels causing
massive throughput loss. Clamp MSS to PMTU on each VPN VPS:
```bash
iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN \
  -j TCPMSS --clamp-mss-to-pmtu
iptables-save > /etc/iptables/rules.v4
```
Effect: 0% on healthy links, +20% if user is behind a fragmenting NAT.

### What does NOT improve speed (don't bother)
- Switching SNI from `microsoft.com` to anything else — purely an
  anti-block change, throughput identical.
- Self-hosted SNI (Proposal B above) — anti-block only.
- Switching uTLS fingerprint — purely cosmetic for DPI.
- Reality vs vanilla VLESS-TLS — overhead near-identical.
- Mux.cool / multiplexing — helps multi-stream browsing, NOT
  single-stream speedtest numbers users complain about.

### Priority order recommended
1. **BBR** (free, instant +20%, zero risk) — do first, on existing servers.
2. **DE Pro server** as the recommended default in client UI — already
   doable without code changes.
3. **WARP+ on DE** as a paid pilot — measure delta vs free WARP. If
   solid, raise on NL too.
4. **Self-hosted SNI** (Proposal B) — schedule before we hit the next
   wave of RKM enforcement, not as a speed item.
5. Everything else only if user complaints persist after the above.


## TODO: Native Client Update Manifest Endpoint (2026-05-15)

Нужно для Windows / macOS / Linux нативных клиентов чтобы они могли
показать юзеру баннер «Доступна новая версия» и сами скачать installer.

### Endpoints

```
GET /api/clients/windows/latest.json
GET /api/clients/macos/latest.json
GET /api/clients/linux/latest.json
```

Response (one per platform):

```json
{
  "version": "0.2.0",
  "url": "https://hundlervpn.xyz/dl/hundler-0.2.0-win-x64.exe",
  "sha256": "<hex SHA-256 of the binary>",
  "release_notes": "Краткое описание изменений на русском, max 200 chars",
  "min_version": "0.1.0",
  "mandatory": false
}
```

- `min_version` — версия ниже которой работа не поддерживается. Клиент
  заблокирует кнопку Connect, покажет красный баннер.
- `mandatory` — то же что `min_version`-trigger, но через явный флаг.
- `sha256` — клиент должен сверить **после** скачивания (см.
  `hundlerwindows/lib/services/binary_integrity.dart` как шаблон).

### Storage layout

```
hundlerminiapp/public/dl/
├── hundler-0.1.0-win-x64.exe
├── hundler-0.2.0-win-x64.exe   ← latest
└── hundler-latest-win-x64.exe  → symlink на latest
```

`public/dl/` обслуживается напрямую Next.js — не нужны API-handler'ы
для скачивания файла, только для манифеста.

### Implementation hint

Простой статический handler в `app/api/clients/[platform]/latest.json/
route.ts`:

```ts
import { NextResponse } from 'next/server';

const MANIFESTS: Record<string, object> = {
  windows: {
    version: '0.2.0',
    url: 'https://hundlervpn.xyz/dl/hundler-0.2.0-win-x64.exe',
    sha256: '<computed at build-time>',
    release_notes: 'Исправления стабильности, SHA-256 проверка sing-box',
    min_version: '0.1.0',
    mandatory: false,
  },
};

export async function GET(_: Request, { params }: { params: { platform: string } }) {
  const m = MANIFESTS[params.platform];
  if (!m) return new NextResponse('Not found', { status: 404 });
  return NextResponse.json(m, {
    headers: { 'Cache-Control': 'public, max-age=300' }, // 5 min cache
  });
}
```

CI пайплайн на сборку Windows клиента должен:
1. Собрать `hundler-X.Y.Z-win-x64.exe` (через `flutter build windows`
   + Inno Setup или MSIX packaging).
2. Подписать Authenticode-сертификатом (EV preferred — пройдёт
   SmartScreen без warning'а).
3. Загрузить в `hundlerminiapp/public/dl/`.
4. Обновить `MANIFESTS.windows` в route.ts с новой версией и SHA-256.
5. Деплой Next.js → клиенты при следующем `check()` увидят апдейт.

### Auto-update strategy (полностью автоматический)

Сейчас юзер тапает баннер → открывается браузер → юзер сам скачивает
и запускает installer. Это MVP. Для full-auto:

- Использовать `auto_updater` Flutter package (Squirrel.Windows под капотом).
- Или собственный механизм: скачать exe → проверить SHA-256 → запустить
  с флагом `--update`, новый exe убивает старый Hundler.exe, копирует
  себя на его место, рестартует.

Безопасность: подписанный exe + SHA-256 проверка обязательны. Без них
attacker может подсунуть свой installer через DNS-poisoning или MITM.

---

