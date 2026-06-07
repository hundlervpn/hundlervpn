import { createHash, randomUUID } from 'crypto';
import { dbQuery } from '@/lib/db';
import {
  parseSubTokenV2,
  buildVlessLink,
  buildVlessLinkFromServer,
  buildServerTag,
  pickSniForServer,
  clientHost,
  countryCodeToFlag,
  countryCodeToName,
  generateSessionHy2Password,
  type ServerConfig,
} from '@/lib/sub-token';
import { triggerXraySync } from '@/lib/xray-webhook';
import { acquireUuid, ensurePoolRowForKey } from '@/lib/uuid-pool';

const CODE_VERSION = 'v68.7-happ-profile-strategy-and-dns-fix-2026-05-18';

/**
 * Per-session UUID management with hard kick enforcement (v41).
 *
 * ARCHITECTURAL CHANGE (2026-04-19):
 * Previously all of a user's devices shared ONE UUID (`ensureUserUuid`). That
 * made it impossible to kick a single device: deleting the DB row didn't
 * invalidate the UUID on Xray, so the kicked client kept working via its
 * cached VLESS config.
 *
 * Now EACH device_session owns its own vpn_key + UUID drawn from the pool.
 * On explicit kick (`DELETE /api/users/devices`):
 *   1. session.kicked_at = NOW() (blocks re-registration of the same hash).
 *   2. uuid_pool row is DELETED (hard purge, not release) → Xray sync after
 *      that call returns one fewer UUID → Xray restart rejects the kicked
 *      client's cached UUID with "user not found".
 *   3. vpn_keys row is deleted.
 *
 * Legacy migration:
 * Users created before this rollout have ONE shared vpn_key across all their
 * sessions. `ensureSessionUuid` detects that (multiple rows of device_sessions
 * linked to the same vpn_key_id) and transparently upgrades each session to
 * its own per-device UUID on the next subscription refresh. Until every
 * session has migrated, kicks on a shared-key session fall back to a soft
 * kick (kicked_at set but UUID not purged — other sessions still need it).
 */
type UserUuidResult = { uuid: string; isNew: boolean } | null;

/**
 * Return the UUID this device_session should use, allocating a new per-device
 * vpn_key + pool UUID if needed. Handles migration from legacy shared keys.
 */
async function ensureSessionUuid(
  sessionId: number,
  userId: number,
  subscriptionId: number,
  endDate: string,
  deviceName: string,
): Promise<UserUuidResult> {
  // 1. Is this session already linked to an exclusive (per-device) vpn_key?
  const sessRes = await dbQuery<{ vpn_key_id: number | null }>(
    `SELECT vpn_key_id FROM device_sessions WHERE id = $1`,
    [sessionId],
  );
  let linkedKeyId = sessRes.rows[0]?.vpn_key_id ?? null;

  if (linkedKeyId) {
    // Check if this vpn_key is shared with other sessions (legacy case).
    const sharedRes = await dbQuery<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM device_sessions
        WHERE vpn_key_id = $1 AND id != $2 AND kicked_at IS NULL`,
      [linkedKeyId, sessionId],
    );
    const shared = (sharedRes.rows[0]?.cnt ?? 0) > 0;

    const keyRes = await dbQuery<{ id: number; key_hash: string | null; is_active: boolean }>(
      `SELECT id, key_hash, is_active FROM vpn_keys WHERE id = $1`,
      [linkedKeyId],
    );
    const keyRow = keyRes.rows[0];

    if (keyRow?.key_hash && !keyRow.key_hash.startsWith('pending-')) {
      if (!shared) {
        // Exclusive — reuse + refresh expiry.
        // v63: idempotent UPDATE — only writes if a snapshot-relevant field
        // actually changed. Without this, every Happ poll (every 60s)
        // wrote the row → if a parallel /api/users/state UPDATE had just
        // flipped is_active=FALSE, this re-flipped it TRUE → vpn_keys.is_active
        // toggled → /api/xray/clients snapshot drift → Xray restart-storm.
        await dbQuery(
          `UPDATE vpn_keys
             SET expires_at = $2, is_active = TRUE,
                 last_connected_at = NOW(), subscription_id = $3,
                 device_name = COALESCE(device_name, $4)
           WHERE id = $1
             AND (
               is_active IS DISTINCT FROM TRUE
               OR expires_at IS DISTINCT FROM $2::timestamptz
               OR subscription_id IS DISTINCT FROM $3::int
               OR device_name IS NULL
             )`,
          [keyRow.id, endDate, subscriptionId, deviceName],
        ).catch(() => {});
        // Make sure the pool row for this UUID exists and is bound to THIS
        // vpn_key id. If a past expiration cycle deleted the pool row (or
        // left it pointing at the now-inactive key), this re-creates / re-
        // binds it so the next /api/xray/clients snapshot includes the
        // UUID. Without this, the user's cached VLESS configs silently
        // fail with "invalid request user id" after a subscription renewal.
        // v64: if ensurePoolRowForKey actually wrote a row (recreated after
        // a prior purge, or rebound to a different vpn_key), fire the
        // webhook so all VPN servers reload xray within ~1s instead of
        // waiting up to 5 min for the next cron tick. This is the difference
        // between "VPN dies for 5 min until cron heals it" and "VPN heals
        // itself instantly on the next Happ poll".
        const poolChanged = await ensurePoolRowForKey(keyRow.id, keyRow.key_hash).catch((err) => {
          console.warn(`[ensureSessionUuid] ensurePoolRowForKey failed:`, err);
          return false;
        });
        if (poolChanged) {
          console.log(`[ensureSessionUuid] pool row healed for vpn_key=${keyRow.id}, firing webhook`);
          triggerXraySync('fire-and-forget').catch(() => {});
        }
        return { uuid: keyRow.key_hash, isNew: !keyRow.is_active };
      }
      // Shared (legacy) → fall through to create a fresh per-device key for
      // THIS session. Leave the shared key intact for the other sessions.
      console.log(
        `[ensureSessionUuid] migrating session=${sessionId} off shared key=${keyRow.id} userId=${userId}`,
      );
      linkedKeyId = null;
    } else {
      // Stale FK pointing at a missing / pending key → treat as unlinked.
      linkedKeyId = null;
    }
  }

  // 2. Need a fresh per-device vpn_key + UUID.
  const ins = await dbQuery<{ id: number }>(
    `INSERT INTO vpn_keys (user_id, subscription_id, key_uri, key_hash, device_name, created_at, expires_at, is_active)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, TRUE)
     RETURNING id`,
    [
      userId,
      subscriptionId,
      `per-device`,
      `pending-${randomUUID()}`,
      deviceName,
      endDate,
    ],
  );
  const newKeyId = ins.rows[0]?.id;
  if (!newKeyId) return null;

  const pooledUuid = await acquireUuid(newKeyId);
  if (!pooledUuid) {
    await dbQuery(`DELETE FROM vpn_keys WHERE id = $1`, [newKeyId]).catch(() => {});
    console.error(`[ensureSessionUuid] pool exhausted, refill failed`);
    return null;
  }

  await dbQuery(
    `UPDATE vpn_keys SET key_hash = $2 WHERE id = $1`,
    [newKeyId, pooledUuid],
  );

  // Link the new key to this session.
  await dbQuery(
    `UPDATE device_sessions SET vpn_key_id = $2 WHERE id = $1`,
    [sessionId, newKeyId],
  );

  console.log(
    `[ensureSessionUuid] new uuid=${pooledUuid.substring(0, 8)}… keyId=${newKeyId} sessionId=${sessionId} userId=${userId}`,
  );
  return { uuid: pooledUuid, isNew: true };
}

type VpnKeyRow = {
  id: number;
  key_hash: string;
  expires_at: string | null;
};

function isSingboxClient(ua: string): boolean {
  const lower = ua.toLowerCase();
  // NOTE: Hiddify and dart/ are intentionally EXCLUDED here.
  // Hiddify receives base64 VLESS URIs instead and builds its own sing-box
  // config internally — this is more reliable than our custom config because
  // Hiddify's generator is optimised for its bundled sing-box version.
  return (
    lower.includes('sing-box') ||
    lower.includes('singbox') ||
    lower.includes('nekobox') ||
    lower.includes('nekoray')
  );
}

function isXrayClient(ua: string): boolean {
  const lower = ua.toLowerCase();
  // Standard Xray JSON (with `settings.vnext[]` structure) is only served to
  // clients that explicitly identify as raw Xray-core / v2ray-core (e.g.
  // server-side usage, CLI, custom integrations).
  //
  // WHY Happ / v2rayNG / Streisand were REMOVED (v44):
  // Per Happ's own docs ("Принцип прямой передачи 1:1"), when Happ receives
  // a JSON subscription it passes the config to the Xray core UNCHANGED and
  // displays it as a SINGLE profile in the server list — regardless of how
  // many `vnext[]` entries or outbounds are inside. Users see only one server
  // even when we send a multi-server config.
  //
  // Happ's multi-server UI only works with "standard subscriptions" —
  // i.e. base64-encoded lists of `vless://` URIs where each URI becomes a
  // separate entry in the UI. v2rayNG / Streisand behave the same way.
  //
  // v2rayTun was already excluded for a different reason (its parser only
  // accepts base64 VLESS URIs, not Xray JSON).
  //
  // The buildXrayConfig path below is still used when callers explicitly
  // request `?format=xray` (e.g. server-side tools, tests).
  return (
    lower.includes('xray/') ||
    lower.includes('v2ray/')
  );
}

function isHappClient(ua: string): boolean {
  return /\bHapp\//i.test(ua);
}

function isV2RayTunClient(ua: string): boolean {
  // v2RayTun on iOS: "V2RayTun/2.x.x CFNetwork/… Darwin/…"
  // v2RayTun on Android: "V2RayTun/x.x.x okhttp/…"
  return /\bv2raytun\b/i.test(ua);
}

/**
 * Build a Happ routing profile (https://routing.happ.su format).
 * Pushed to Happ via the `routing: happ://routing/onadd/{base64}` HTTP
 * header so users on raw VLESS subscriptions get our routing rules
 * automatically.
 *
 * v49 (2026-05-08): TIGHTLY MEMORY-OPTIMISED for iOS. The previous v48
 * version referenced `geoip:ru`, `geoip:private`, `geosite:category-ru`,
 * `geosite:telegram`, `geosite:apple` which forced Happ to load slices of
 * the Loyalsoldier geo files (~12 MB total when uncompressed in memory).
 * On iOS Happ runs inside a Network Extension with a HARD 50 MB memory
 * cap → users hit "Критическая ошибка XrayCore: Лимит памяти туннеля
 * превышен (50 МБ)". Reference: VolnaVPN and EJX (other RU VPN
 * providers) both ship custom geo files of just 215–409 KB to avoid
 * exactly this issue.
 *
 * v49 fix: drop ALL `geoip:`/`geosite:` references → no slicing happens
 * → near-zero memory footprint regardless of whether useChunkFiles is
 * on. Use only inline CIDRs (Telegram CDN ranges from
 * core.telegram.org/resources/cidr.txt) and `domain:`/`keyword:`
 * suffix matchers (lightweight, no geo data needed).
 *
 * Other v49 changes:
 * - DomainStrategy: AsIs (was IPIfNonMatch) — matches what EJX uses;
 *   skips DNS resolution at routing time, much less work per packet.
 * - DNS: 1.1.1.1 (Cloudflare) for both remote and domestic — universally
 *   reachable, less likely to be blocked than dns.google in RU networks.
 * - LastUpdated removed — was previously set to NOW on every poll which
 *   forced Happ to re-download geofiles every minute (huge waste of
 *   battery/data). Now Happ uses cached geofiles forever (we don't
 *   reference them anyway).
 *
 * IMPORTANT LIMITATION: Happ profile format is domain/IP-only — no
 * `network: udp` filter primitive. So this profile cannot route TCP and
 * UDP differently.
 *
 * 2026-05-09 (XUDP migration, v60): with the move from xtls-rprx-vision
 * to plain VLESS+Reality + XUDP packet encoding, UDP NOW transits the
 * proxy outbound correctly (wrapped inside XUDP frames in the same
 * TCP/443 Reality stream). So all TG traffic (TCP signaling + UDP voice)
 * goes via VPN with one source IP = TG reflector NAT match satisfied =
 * voice works on RU operators where TSPU drops direct TG UDP. Discord /
 * WhatsApp UDP also now go via proxy (slightly higher latency than
 * local-ISP egress, but voice works correctly via XUDP). The Hiddify-
 * specific note no longer applies; both Hiddify (sing-box) and Happ
 * (Xray) get TG voice working via this profile.
 */
function buildHappRoutingProfile(name: string): object {
  return {
    Name: name,
    GlobalProxy: 'true',
    // v68.7 (2026-05-18): split DNS plane copying VolnaVPN / RoscomVPN —
    // both proven to work on RU LTE. Foreign domains via Google DoH
    // (resolved through the VPN tunnel), RU domains via Yandex DoH
    // (resolved DIRECT, returns local CDN IPs so wildberries / sber /
    // gosuslugi traffic stays on user's ISP). Without this split a RU
    // site's DNS query goes to Cloudflare 1.1.1.1, which often returns
    // a non-RU CDN IP that then has to ride the VPN — slow + sometimes
    // blocked by the RU bank for "foreign IP".
    RemoteDNSType: 'DoH',
    RemoteDNSDomain: 'https://8.8.8.8/dns-query',
    RemoteDNSIP: '8.8.8.8',
    DomesticDNSType: 'DoH',
    DomesticDNSDomain: 'https://77.88.8.8/dns-query',
    DomesticDNSIP: '77.88.8.8',
    // v68.6 (2026-05-17): self-hosted geosite.dat (68 KB) with the
    // categories we actually need (CATEGORY-RU, CATEGORY-GEOBLOCK-RU,
    // PRIVATE, TELEGRAM, APPLE, MICROSOFT, STEAM, etc). 100x smaller than
    // Loyalsoldier's 6 MB geosite.dat — fits comfortably under the iOS
    // 50 MB Network Extension memory cap. Geoipurl stays on Loyalsoldier
    // because (a) we don't reference any `geoip:` rule that would force
    // Happ to slice the IP file, and (b) our self-hosted attempt at
    // geoip failed: it had no `ru` section so `geoip:ru` triggered a
    // fatal XrayCore error on every launch.
    Geoipurl: 'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat',
    Geositeurl: 'https://hundlervpn.xyz/geosite.dat',
    DnsHosts: {},
    DirectSites: [
      // v68.6 (2026-05-17): geosite categories from our self-hosted
      // /public/geosite.dat (68 KB). UPPERCASE matches what the file
      // ships. Coverage:
      //   - CATEGORY-RU: every major RU site & its CDNs (incl. yandex,
      //     sber, vk, mail, ok, mts, beeline, megafon, wildberries CDN,
      //     ozon CDN, avito CDN, etc) — much wider than the inline
      //     keywords below. This is what fixes "RU LTE breaks our VPN".
      //   - PRIVATE: RFC1918 / loopback / multicast — never tunnel.
      //   - APPLE: iCloud / FaceTime / push — VPN/datacenter IPs get
      //     blocked by Apple, must stay on user's local network.
      'geosite:CATEGORY-RU',
      'geosite:PRIVATE',
      'geosite:APPLE',
      // Inline keyword/domain matchers — safety net for clients that
      // failed to download geosite.dat on first launch (offline, mirror
      // unreachable, etc). Identical to what buildSingboxConfig uses.
      // NOTE: Telegram domains are INTENTIONALLY routed through the VPN
      // (not listed here) — see function header comment for rationale.
      'keyword:yandex',
      'keyword:vk.com',
      'keyword:vk.me',
      'keyword:mail.ru',
      'keyword:ok.ru',
      'keyword:sber',
      'keyword:gosuslugi',
      'keyword:mos.ru',
      'keyword:nalog.ru',
      'keyword:tinkoff',
      'keyword:rutube',
      'keyword:wildberries',
      'keyword:ozon',
      'keyword:avito',
      'keyword:dzen',
      'keyword:mts.ru',
      'keyword:megafon',
      'keyword:beeline',
      'keyword:rostelecom',
      'domain:apple.com',
      'domain:icloud.com',
      'domain:cdn-apple.com',
    ],
    DirectIp: [
      // Private / loopback / multicast — never tunnel.
      '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
      '169.254.0.0/16', '224.0.0.0/4', '255.255.255.255',
      // NOTE: Telegram CDN CIDRs (91.108.x, 149.154.160.0/20, etc.)
      // are INTENTIONALLY NOT listed here in v50. Routing TG IPs to
      // direct meant TG traffic exited via the user's local ISP,
      // which fails when the ISP throttles/blocks TG (RU operators,
      // Iran, Turkmenistan, etc.). Now TG falls through to the
      // GlobalProxy default → through VPN → works.
    ],
    ProxySites: [],
    ProxyIp: [],
    BlockSites: [],
    BlockIp: [],
    // v68.7 (2026-05-18): IPIfNonMatch (was AsIs). With AsIs the engine
    // matches rules ONLY against the literal SNI/sniffed domain — apps
    // that connect by raw IP (DoH, Telegram MTProto, some games) skip
    // every `geosite:` / `domain:` / `keyword:` rule and fall to the
    // GlobalProxy default → broken on RU LTE. IPIfNonMatch first tries
    // to match the domain, and if no match is found re-resolves the IP
    // and matches against `DirectIp`/`geoip:` ranges. Same value
    // VolnaVPN and RoscomVPN ship in their working profiles.
    DomainStrategy: 'IPIfNonMatch',
    FakeDNS: 'false',
  };
}

/**
 * Build a v2RayTun routing config (Xray-routing JSON format).
 * Pushed via the `routing: {base64}` HTTP header — v2RayTun decodes and
 * applies it on top of its bundled Xray core. Format docs:
 * https://docs.v2raytun.com/headers#routing
 *
 * UNLIKE the Happ profile format, this DOES support `network: udp` so
 * we can implement the proper UDP→direct catch-all that fixes Discord
 * WebRTC voice + Telegram + WhatsApp + online games.
 *
 * v49 (2026-05-08): same memory optimisation as buildHappRoutingProfile
 * — removed `geoip:ru`, `geoip:private`, `geosite:category-ru`,
 * `geosite:telegram`, `geosite:category-ads-all` references because
 * v2RayTun on iOS hits the same 50 MB Network Extension memory cap.
 * Now uses only inline CIDRs and `keyword:`/`domain:` suffix matchers.
 */
function buildV2RayTunRoutingConfig(name: string): object {
  return {
    name,
    domainStrategy: 'AsIs',
    domainMatcher: 'hybrid',
    rules: [
      // DNS (UDP/53) → built-in dns-out (handled by v2RayTun)
      { type: 'field', port: 53, outboundTag: 'dns-out' },
      // BitTorrent → direct (anti-abuse, never through VPN)
      { type: 'field', protocol: ['bittorrent'], outboundTag: 'direct' },
      // QUIC (UDP/443) → block (force browsers to TCP/443 through VPN)
      { type: 'field', port: 443, network: 'udp', outboundTag: 'block' },
      // 2026-05-09 (v61): ALL non-DNS / non-QUIC UDP → falls through to the
      // implicit proxy outbound (final). Critical for TG voice on iOS where
      // TG attempts P2P UDP to a random peer-IP (NOT a TG-CIDR reflector);
      // routing P2P UDP via local ISP fails on RU operators (TSPU drops),
      // and TG iOS doesn't always fall back to the reflector. With ALL
      // UDP via VPN, both P2P UDP and reflector UDP exit from the VPN
      // server's IP — single consistent source IP → NAT-match works.
      // The TG-CIDR-specific rule (above the QUIC block) is no longer
      // needed but kept for clarity (no behavioural difference). Server
      // side MUST have udp → direct (NOT block) on DE/NL for this to work
      // — see migrate-server-to-xudp.sh which also flips that rule.
      // Private networks (inline — no geoip.dat needed).
      {
        type: 'field',
        ip: [
          '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
          '169.254.0.0/16', '224.0.0.0/4', '255.255.255.255',
        ],
        outboundTag: 'direct',
      },
      // RU services + Apple via keyword/domain matchers (no
      // geosite.dat dependency). Mirrors buildHappRoutingProfile.
      // NOTE: Telegram TCP routes through VPN (via the catch-all
      // proxy outbound that v2RayTun adds when no rule matches).
      // Telegram UDP (voice calls) is handled by the
      // `network: 'udp' → direct` catch-all above — that fires
      // BEFORE this domain rule since it matches first by network.
      {
        type: 'field',
        domain: [
          'keyword:yandex', 'keyword:vk.com', 'keyword:vk.me',
          'keyword:mail.ru', 'keyword:ok.ru', 'keyword:sber',
          'keyword:gosuslugi', 'keyword:mos.ru', 'keyword:nalog.ru',
          'keyword:tinkoff', 'keyword:rutube', 'keyword:wildberries',
          'keyword:ozon', 'keyword:avito', 'keyword:dzen',
          'keyword:mts.ru', 'keyword:megafon', 'keyword:beeline',
          'keyword:rostelecom',
          'domain:apple.com', 'domain:icloud.com', 'domain:cdn-apple.com',
        ],
        outboundTag: 'direct',
      },
    ],
  };
}

/**
 * Build the `routing` HTTP header value appropriate for the detected
 * client. Happ and v2RayTun use INCOMPATIBLE formats so we dispatch
 * by User-Agent. Returns `null` for clients that don't use this
 * mechanism (e.g. sing-box / Hiddify, which receive a sing-box JSON
 * config with rules embedded).
 */
function buildRoutingHeader(ua: string): string | null {
  if (isHappClient(ua)) {
    const profile = buildHappRoutingProfile('Hundler VPN');
    const b64 = Buffer.from(JSON.stringify(profile)).toString('base64');
    return `happ://routing/onadd/${b64}`;
  }
  if (isV2RayTunClient(ua)) {
    const config = buildV2RayTunRoutingConfig('Hundler VPN');
    return Buffer.from(JSON.stringify(config)).toString('base64');
  }
  return null;
}

function detectDeviceType(ua: string, xDeviceOS?: string | null): string {
  // v2rayTun / Remnawave X-Device-OS header (most reliable when present)
  if (xDeviceOS) {
    const os = xDeviceOS.toLowerCase();
    if (os.includes('ios') || os.includes('iphone') || os.includes('ipad')) return 'ios';
    if (os.includes('android')) return 'android';
    if (os.includes('windows')) return 'windows';
    if (os.includes('macos') || os.includes('mac')) return 'macos';
    if (os.includes('linux')) return 'linux';
  }
  // Hiddify format: Happ/ver/Platform/deviceId
  const happMatch = ua.match(/Happ\/[\d.]+\/(\w+)\//i);
  if (happMatch) {
    const plat = happMatch[1].toLowerCase();
    if (plat === 'ios') return 'ios';
    if (plat === 'android') return 'android';
    if (plat === 'windows') return 'windows';
    if (plat === 'macos') return 'macos';
    if (plat === 'linux') return 'linux';
  }
  const lower = ua.toLowerCase();
  // iOS / iPadOS — CFNetwork + Darwin is the iOS system networking stack.
  // v2rayTun on iOS sends "V2RayTun/X.X.X CFNetwork/… Darwin/…".
  if (/iphone|ipad|ipod|darwin|cfnetwork/.test(lower)) return 'ios';
  // macOS Swift/Foundation-based apps
  if (/macintosh|mac os|mac_os_x/.test(lower)) return 'macos';
  // Android — native and okhttp-based clients
  if (/android|okhttp/.test(lower)) return 'android';
  // Windows — includes .NET and WinHTTP variants
  if (/windows|winhttp|dotnet/.test(lower)) return 'windows';
  if (/linux|x11/.test(lower)) return 'linux';
  return 'unknown';
}

function extractDeviceId(ua: string): string | null {
  // Hiddify: Happ/ver/Platform/DEVICE_ID (numeric, UUID, or alphanumeric)
  const m = ua.match(/Happ\/[\d.]+\/\w+\/([^\s/]+)/);
  return m ? m[1] : null;
}

/**
 * Build a stable device_hash. When the client doesn't include a device-unique
 * token (like Happ's deviceId), fall back to `${app}_${os}` so that app
 * version bumps don't create new device sessions.
 */
function buildDeviceHash(ua: string, deviceType: string, xHwid?: string | null): string {
  // v2rayTun X-HWID header — unique hardware ID per device (most stable)
  if (xHwid) return `hwid_${xHwid}`;

  const hiddifyId = extractDeviceId(ua);
  if (hiddifyId) return `${deviceType}_${hiddifyId}`;

  const lower = ua.toLowerCase();
  let app = 'client';
  if (lower.includes('v2raytun')) app = 'v2raytun';
  else if (lower.includes('happ')) app = 'happ';
  else if (lower.includes('v2rayng')) app = 'v2rayng';
  else if (lower.includes('streisand')) app = 'streisand';
  else if (lower.includes('nekobox')) app = 'nekobox';
  else if (lower.includes('nekoray')) app = 'nekoray';
  else if (lower.includes('hiddify')) app = 'hiddify';
  else if (lower.includes('xray')) app = 'xray';
  else if (lower.includes('v2ray')) app = 'v2ray';

  // Fallback hash — include a SHA256 of the full UA to avoid collisions
  // between different physical devices running the same client with similar
  // UAs. v42 fix: previously this returned `${app}_${deviceType}` which
  // collided across ALL of a user's devices of the same OS, so kicking one
  // Happ/Windows device made ALL future Happ/Windows devices look kicked.
  // The uaHash differentiates physical machines at the cost of creating a
  // new session when the client updates (different UA version). That's an
  // acceptable tradeoff — new session just takes a slot, doesn't duplicate.
  const uaHash = createHash('sha256').update(ua).digest('hex').substring(0, 12);
  if (app !== 'client' && deviceType !== 'unknown') return `${app}_${deviceType}_${uaHash}`;
  return `ua_${uaHash}`;
}

function deviceLabel(type: string): string {
  switch (type) {
    case 'ios': return 'iPhone/iPad';
    case 'android': return 'Android';
    case 'windows': return 'Windows';
    case 'macos': return 'macOS';
    case 'linux': return 'Linux';
    default: return 'Device';
  }
}

/**
 * Turn a raw `X-Device-Model` header value into a human-friendly label.
 *
 * v2rayTun on desktop sends the machine hostname with architecture suffix,
 * e.g. `MakuOSV6PC-2722_x86_64` or `DESKTOP-LLENERI_x86_64`. Showing that
 * raw string to users is confusing — they read "MakuOS" and think we
 * fabricated an OS name.
 *
 * Heuristic:
 *   - Strip common architecture suffixes (`_x86_64`, `_arm64`, etc.)
 *   - If the stripped name already looks like a phone/tablet model
 *     (contains a space or starts with a well-known mobile brand), trust
 *     it as-is (e.g. "iPhone 14 Pro", "Pixel 7").
 *   - Otherwise wrap it with the detected OS label for clarity:
 *       "MakuOSV6PC-2722"   →  "Windows (MakuOSV6PC-2722)"
 *       "DESKTOP-LLENERI"   →  "Windows (DESKTOP-LLENERI)"
 *       "laptop-user"       →  "Linux (laptop-user)"
 *   - Fall back to `deviceLabel(deviceType)` if no model was provided.
 */
function formatDeviceName(
  xDeviceModel: string | null | undefined,
  xDeviceOS: string | null | undefined,
  deviceType: string,
): string {
  if (!xDeviceModel || !xDeviceModel.trim()) {
    return deviceLabel(deviceType);
  }

  // Strip architecture suffix (case-insensitive, with leading `_` or `-`).
  const stripped = xDeviceModel
    .trim()
    .replace(/[_-](x86_64|x64|x86|arm64|aarch64|i386|amd64)$/i, '')
    .trim();

  if (!stripped) return deviceLabel(deviceType);

  // Phone / tablet model names usually contain spaces ("iPhone 14 Pro",
  // "Galaxy S23") or start with a well-known mobile brand token.
  const mobileBrandRe = /^(iPhone|iPad|iPod|Pixel|Galaxy|Redmi|Poco|OnePlus|Xiaomi|Mi\s|Huawei|Honor|Samsung|Oppo|Vivo|Realme|Nokia|Motorola|Moto|Sony|Xperia|Asus|ROG|Nothing|Tecno|Infinix|SM-|MI-)/i;
  const looksLikePhone = /\s/.test(stripped) || mobileBrandRe.test(stripped);
  if (looksLikePhone) {
    // Still cap length to protect UI.
    return stripped.length > 40 ? stripped.slice(0, 40) : stripped;
  }

  // Otherwise it's a PC-style hostname. Prepend the OS label.
  const osLower = (xDeviceOS || '').toLowerCase();
  let os: string;
  if (osLower.includes('windows') || deviceType === 'windows') os = 'Windows';
  else if (osLower.includes('mac') || osLower.includes('darwin') || deviceType === 'macos') os = 'macOS';
  else if (osLower.includes('linux') || deviceType === 'linux') os = 'Linux';
  else if (osLower.includes('android') || deviceType === 'android') os = 'Android';
  else if (osLower.includes('ios') || osLower.includes('iphone') || deviceType === 'ios') os = 'iOS';
  else os = deviceLabel(deviceType);

  // Cap hostname to keep the combined label compact in the UI.
  const host = stripped.length > 30 ? stripped.slice(0, 30) + '…' : stripped;
  return `${os} (${host})`;
}

function buildSingboxConfig(
  keys: VpnKeyRow[],
  servers: ServerConfig[],
  hy2AuthToken: string,
): object {
  const outbounds: object[] = [];
  const proxyTags: string[] = [];
  // v68.2 (2026-05-17): per-country DNS plane. NL exit is CDN-fronted via the
  // YC bridge and the DoH-via-proxy chain breaks on that path; see the long
  // comment on the `dns:` block below for the full reasoning. We detect NL
  // membership by country code so the override stays self-contained — no
  // schema change, no env flag, no extra column on `servers`.
  const hasNlExit = servers.some(
    (s) => (s?.country ?? '').toUpperCase() === 'NL',
  );
  // 2026-05-15 (v62): Hy2 outbound emission RE-ENABLED. The Windows/Android
  // native clients now expose a "VLESS / Hysteria" toggle in the location
  // picker; on Hy2 selection the client filters the location list to only
  // Hy2-capable servers and uses the Hy2 outbound directly. We keep both
  // outbounds in the same config — the client patches the proxy selector
  // server-side.
  //
  // Architecture:
  //   • VLESS+Reality + XUDP — primary path, carries TCP+UDP through TCP/443.
  //     Default for all clients. Available on every active server.
  //   • Hysteria2 — secondary path, QUIC over UDP/8443. Only emitted for
  //     servers with all four hysteria2_* columns populated (currently
  //     only DE 213.182.213.183). Strict TLS pin via tls.pin_sha256.
  //
  // Why both: VLESS+XUDP works on most ISPs but a few mobile networks
  // throttle long-lived TCP/443 streams. Hy2's QUIC congestion control
  // (BBR-like) recovers from 5-15% packet loss where TCP would stall.

  for (const key of keys) {
    for (const server of servers) {
      const tag = buildServerTag(server);
      proxyTags.push(tag);

      // v68.4 (2026-05-17): Vision flow and XUDP packet_encoding are
      // mutually exclusive — same rule as the Happ / classic Xray builders
      // below. Sending both produces undefined behaviour in the sing-box
      // protocol layer (TCP-ping never completes, client UI shows "n/a").
      //
      // Decision per server:
      //   server.flow set (NL "Обход Глушилок")  -> Vision XTLS, no XUDP.
      //   server.flow empty (DE / RU)            -> XUDP, no flow.
      //
      // History of comment-block this replaces:
      //   2026-05-09 (XUDP migration, v60): omit flow when server.flow is
      //   empty; sing-box `flow: ""` was plain VLESS for XUDP. v68.4 keeps
      //   that branch but additionally drops packet_encoding when flow is
      //   actually set (NL case) — those two were never legal together.
      const hasFlow = server.flow && server.flow.trim() !== '';
      const vlessOutbound: Record<string, unknown> = {
        type: 'vless',
        tag,
        server: clientHost(server),
        server_port: server.port,
        uuid: key.key_hash,
        tls: {
          enabled: true,
          server_name: server.sni,
          reality: {
            enabled: true,
            public_key: server.public_key,
            short_id: server.short_id,
          },
          utls: {
            enabled: true,
            fingerprint: server.fingerprint || 'chrome',
          },
        },
      };
      if (hasFlow) {
        vlessOutbound.flow = server.flow;
      } else {
        vlessOutbound.packet_encoding = 'xudp';
      }
      outbounds.push(vlessOutbound);

      // Hy2 outbound — emitted only when all four hysteria2_* columns are
      // populated for this server. Tag pattern: "🇩🇪 Германия | Pro (Hy2)".
      // The "(Hy2)" suffix is REQUIRED by the client-side filter
      // (hundlerwindows/lib/services/singbox_config_patch.dart::filterOutboundsByProtocol)
      // which uses outbound.type === "hysteria2" to keep/drop entries — the
      // tag is purely cosmetic for users who eyeball the JSON. Strict TLS
      // pin via lowercase hex sha256 (sing-box accepts hex or base64 here;
      // hex matches what we store in the DB).
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
          // 2026-05-16: password = sub-token юзера (HMAC-подписанная строка
          // из `parseSubTokenV2`). Hy2 server использует `auth.type: http`
          // и зовёт /api/hysteria/auth для проверки. При истечении подписки
          // или kick устройства — backend возвращает 401, юзер отваливается
          // от Hy2 в течение минуты. Старый общий `server.hysteria2_password`
          // больше не используется (но в DB оставляем для backwards-compat
          // на случай отката).
          password: hy2AuthToken,
          tls: {
            enabled: true,
            server_name: server.hysteria2_sni,
            alpn: ['h3'],
            // sing-box 1.12+ removed `tls.pin_sha256` (was a Hysteria-native
            // proprietary field). Until DE Hy2 migrates to Let's Encrypt we
            // skip cert validation here — security is still adequate because:
            //   1) password is a 32-byte secret unique per server (auth);
            //   2) MITM would need to also produce the right password AFTER
            //      stealing the TLS session, which is computationally
            //      equivalent to brute-forcing the password directly;
            //   3) the user-visible SNI (`hysteria2_sni`) is checked even
            //      with `insecure: true` for the ALPN/handshake to proceed.
            // TODO(2026-05-15+): provision a Let's Encrypt cert on DE Hy2
            // server and drop `insecure: true` here so we get full chain
            // validation. Tracked in MINIAPP-AGENTS.md "Hysteria pinning".
            insecure: true,
          },
        });
      }
    }
  }

  return {
    log: { level: 'warn', timestamp: true },
    // DNS configuration. v68.2 (2026-05-17): the NL exit ("Обход Глушилок")
    // is CDN-fronted via the YC bridge (158.160.254.104, Moscow, AS200350),
    // because the ScalaXY NL IP isn't on RU operators' MTProto-style
    // whitelist and direct connections to it get throttled. On that path
    // the DoH chain (HTTPS to 8.8.8.8 via proxy outbound) goes:
    //   client -> YC bridge -> NL VPS -> 8.8.8.8:443
    // and any hop dropping outbound HTTPS to Google IPs silently kills all
    // non-RU resolution -- yielding the classic 'Telegram works (hardcoded
    // MTProto IPs), browser/YouTube don't (ERR_NAME_NOT_RESOLVED)' fault.
    //
    // DE / RU exits don't have the bridge hop and DoH still works there, so
    // we ONLY downgrade the DNS plane when the subscription contains an NL
    // server. Other countries continue to use the proven Hiddify-standard
    // DoH chain. This preserves the per-country tuning the user explicitly
    // requested rather than forcing the simpler config on everyone.
    //
    // sing-box 1.12+ DNS server format. Legacy `address: "scheme://..."`
    // removed in 1.14. New form splits scheme into `type` + `server` + `path`,
    // and renames `address_resolver` → `domain_resolver`.
    // See: https://sing-box.sagernet.org/migration/#migrate-to-new-dns-server-formats
    dns: hasNlExit
      ? {
          // NL-only: plain UDP/53 to 1.1.1.1, no DoH chain, no bootstrap.
          // The DNS query is wrapped inside the same VLESS+Reality+XUDP
          // stream that already carries TG voice / Discord WebRTC, so if
          // those work, this works. Matches the minimal DNS section seen
          // in well-known 'обход глушилок'-class xray-core configs.
          servers: [
            { tag: 'dns-direct', type: 'udp', server: '1.1.1.1', detour: 'direct' },
            { tag: 'dns-proxy',  type: 'udp', server: '1.1.1.1', detour: proxyTags[0] || 'direct' },
          ],
          rules: [
            { domain_suffix: ['ru', 'su', 'рф'], server: 'dns-direct' },
            { domain_keyword: ['yandex', 'mail.ru', 'vk.com', 'ok.ru', 'sber', 'gosuslugi', 'mos.ru'], server: 'dns-direct' },
          ],
          final: 'dns-proxy',
          strategy: 'prefer_ipv4',
          independent_cache: false,
        }
      : {
          // DE / RU and any future foreign exit without a bridge: keep the
          // original DoH-based Hiddify-standard config. Proven working.
          servers: [
            { tag: 'dns-proxy', type: 'https', server: '8.8.8.8', domain_resolver: 'dns-bootstrap', detour: proxyTags[0] || 'direct' },
            { tag: 'dns-direct', type: 'https', server: '77.88.8.8', domain_resolver: 'dns-bootstrap', detour: 'direct' },
            { tag: 'dns-bootstrap', type: 'udp', server: '1.1.1.1', detour: 'direct' },
          ],
          rules: [
            { outbound: 'any', server: 'dns-bootstrap' },
            { domain_suffix: ['ru', 'su', 'рф'], server: 'dns-direct' },
            { domain_keyword: ['yandex', 'mail.ru', 'vk.com', 'ok.ru', 'sber', 'gosuslugi', 'mos.ru'], server: 'dns-direct' },
          ],
          final: 'dns-proxy',
          strategy: 'prefer_ipv4',
          // independent_cache=false: один общий кэш на все DNS-серверы.
          // Экономит ~5-10MB RAM на слабых телефонах (default=true делает
          // кэш на каждый сервер). Промахов кэша от этого не больше — у
          // нас 3 dns-server'а и overlap по доменам минимален.
          independent_cache: false,
        },
    outbounds: [
      ...outbounds,
      ...(proxyTags.length > 1
        ? [{
            type: 'selector',
            tag: 'proxy',
            outbounds: proxyTags,
            default: proxyTags[0],
          }]
        : []),
      { type: 'direct', tag: 'direct' },
      // 2026-05-12: sing-box 1.13+ removed `dns` outbound and `block` outbound.
      // - `dns` outbound -> route.rules `{protocol:"dns", action:"hijack-dns"}`
      // - `block` outbound -> route.rules `{... action:"reject"}` (per-rule)
      // We keep `block` tag here only because routing rules reference it; the
      // new schema needs `action:"reject"` inline in each rule that used to
      // outbound:"block". This is migrated in route.rules below.
    ],
    route: {
      rules: [
        { protocol: 'dns', action: 'hijack-dns' },

        // 2026-05-09 (v61): ALL UDP via proxy. Critical for TG voice on iOS:
        // TG iOS pre-flights P2P UDP to a random peer-IP, not a TG-CIDR
        // reflector; if that P2P UDP goes via local ISP it gets dropped by
        // TSPU on RU operators and TG never falls back to reflector. By
        // sending ALL UDP through the VPN server, both P2P UDP and reflector
        // UDP exit from a single consistent IP → NAT-match works either way.
        // Trade-off: Discord / WhatsApp / games UDP also goes through DE/NL
        // (slightly higher latency than local-ISP) — same trade competing VPN
        // providers make, and what makes their TG voice "just work".
        //
        // Server side: DE/NL Xray now has `network: udp -> direct` (not block);
        // see migrate-server-to-xudp.sh which auto-flips that rule. RU node
        // already had udp → direct.

        // Block QUIC (UDP:443) — force browsers to fall back to TCP/443.
        // We don't want the heavy HTTP/3 streaming over the VPN since it's
        // bandwidth-expensive and browsers' TCP/443 fallback works fine.
        { port: 443, network: ['udp'], action: 'reject' },
        { domain_suffix: ['ru', 'su', 'рф'], outbound: 'direct' },
        { domain_keyword: ['yandex', 'mail.ru', 'vk.com', 'vk.me', 'ok.ru', 'sber', 'gosuslugi', 'mos.ru', 'wildberries', 'ozon', 'avito', 'tinkoff', 'gazprom', 'rostelecom', 'megafon', 'beeline', 'mts.ru', 'rutube', 'dzen'], outbound: 'direct' },
        { ip_cidr: ['77.88.0.0/16', '5.45.192.0/18', '5.255.192.0/18', '87.250.224.0/19', '93.158.128.0/18', '95.108.128.0/17', '100.43.64.0/19', '141.8.128.0/18', '178.154.128.0/17', '185.32.186.0/24', '213.180.192.0/19'], outbound: 'direct' },
      ],
      final: proxyTags.length > 1 ? 'proxy' : (proxyTags[0] || 'direct'),
      auto_detect_interface: true,
    },
  };
}

/**
 * Xray JSON config for Happ / v2rayNG / Streisand / other Xray-core clients.
 *
 * NO geoip:/geosite: references — Happ's bundled geoip.dat lacks RU section
 * (causes "Критическая ошибка XrayCore"). Uses only inline rules.
 *
 * Minimal/safe config — proxy is the DEFAULT outbound (first in list), so
 * we DO NOT need an explicit "everything else → proxy" rule. Xray sends all
 * unmatched traffic through the first outbound automatically.
 *
 *   - DNS: 8.8.8.8 (primary) + 1.1.1.1 fallback for foreign; 77.88.8.8 for RU
 *   - queryStrategy UseIPv4 — prevents IPv6 leaks (critical for Android)
 *   - Routing: RU keywords/IPs → direct; BitTorrent → direct; rest → proxy (default)
 */
function buildXrayConfig(uuid: string, servers: ServerConfig[]): object {
  if (servers.length === 0) return {};
  const primary = servers[0];

  // Major RU service keywords
  const ruKeywords = [
    'yandex', 'sber', 'tinkoff', 'alfabank', 'vtb', 'gazprom', 'rostelecom',
    'gosuslugi', 'nalog', 'wildberries', 'ozon', 'avito', '2gis',
    'kinopoisk', 'rutube', 'dzen', 'rzd', 'megafon', 'beeline',
    'lemanapro', 'domclick', 'dodopizza', 'userapi', 'mycdn', 'okcdn',
    'vkcdn', 'boosty', 'banki', 'mail.ru', 'vk.com', 'vk.me', 'ok.ru',
    'mts.ru', 'tele2.ru', 'mos.ru',
  ];

  // RU IP ranges: Yandex, VK, Mail, OK, major ISPs
  const ruIpRanges = [
    // Yandex
    '77.88.0.0/16', '5.45.192.0/18', '5.255.192.0/18', '87.250.224.0/19',
    '93.158.128.0/18', '95.108.128.0/17', '100.43.64.0/19', '141.8.128.0/18',
    '178.154.128.0/17', '213.180.192.0/19',
    // VK
    '87.240.128.0/18', '93.186.224.0/21', '95.213.0.0/17',
    '185.32.248.0/22', '185.16.244.0/22', '185.16.148.0/22',
    // Mail.ru / OK.ru
    '217.69.128.0/20', '217.20.144.0/20', '5.61.16.0/21',
    // Major ISPs (Rostelecom / MTS / Beeline / Megafon)
    '213.87.0.0/16', '176.114.0.0/16', '185.73.192.0/22',
    '83.220.0.0/15', '85.140.0.0/14',
    // Private networks
    '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
    '127.0.0.0/8', '169.254.0.0/16',
  ];

  const remark = buildServerTag(primary);

  // RU domain suffixes — use domain-list (simpler than regex with unicode)
  const ruDomainSuffixes = [
    'domain:.ru', 'domain:.su', 'domain:.xn--p1ai', // .рф in punycode
  ];

  return {
    log: { loglevel: 'warning' },
    dns: {
      queryStrategy: 'UseIPv4',
      // Single DNS server (8.8.8.8) for simplicity. Routing rules handle the
      // direct-vs-proxy split for RU domains, not the DNS layer.
      servers: ['8.8.8.8', '1.1.1.1'],
    },
    inbounds: [
      {
        listen: '127.0.0.1',
        port: 10808,
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
        sniffing: { destOverride: ['http', 'tls', 'quic'], enabled: true, routeOnly: true },
        tag: 'socks-in',
      },
      {
        listen: '127.0.0.1',
        port: 10809,
        protocol: 'http',
        sniffing: { destOverride: ['http', 'tls', 'quic'], enabled: true, routeOnly: true },
        tag: 'http-in',
      },
    ],
    outbounds: [
      // PROXY IS FIRST → becomes default outbound for unmatched traffic
      {
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: primary.host,
              port: primary.port,
              users: [
                // v68.4 (2026-05-17): Vision flow and XUDP packet encoding
                // are MUTUALLY EXCLUSIVE in a single user block (see the
                // matching comment in buildVlessRealityOutbound below). The
                // v60 XUDP migration comment already noted this: "Vision
                // is TCP-only and silently drops UDP; XUDP wraps UDP packets
                // inside the VLESS+Reality TCP stream". Combining them in
                // one block confuses Xray-core's protocol parser — TCP-ping
                // never completes, client UI shows "n/a" latency.
                //
                // NL ("Обход Глушилок") has server.flow=xtls-rprx-vision
                // in DB after v68.4, so this branch picks Vision-only.
                // DE / RU keep flow="" and stay on pure XUDP.
                {
                  id: uuid,
                  encryption: 'none',
                  ...(primary.flow && primary.flow.trim() !== ''
                    ? { flow: primary.flow }
                    : { packetEncoding: 'xudp' }),
                },
              ],
            },
          ],
        },
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            serverName: primary.sni,
            publicKey: primary.public_key,
            shortId: primary.short_id,
            fingerprint: primary.fingerprint || 'chrome',
          },
        },
        tag: 'proxy',
      },
      {
        protocol: 'freedom',
        settings: {},
        tag: 'direct',
      },
      { protocol: 'blackhole', settings: {}, tag: 'block' },
      // DNS outbound — intercepts UDP/53 queries and resolves via Xray internal
      // DNS config (VLESS over TCP can't carry UDP, so without this DNS fails).
      { protocol: 'dns', tag: 'dns-out' },
    ],
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        // CRITICAL: DNS queries (UDP/53) must go through dns-out, NOT the VLESS
        // proxy — otherwise DNS fails silently because VLESS+Reality is TCP-only.
        { type: 'field', port: 53, outboundTag: 'dns-out' },
        // BitTorrent never through VPN
        { type: 'field', protocol: ['bittorrent'], outboundTag: 'direct' },

        // v54 (2026-05-08): TG CIDR direct rule REMOVED — see
        // TELEGRAM_CIDR_RANGES comment + buildHappRoutingRules header.
        // RU TSPU actively blocks TG, so direct doesn't help; TG via
        // VPN proxy makes at least TG text work.

        // Block QUIC (UDP/443) so HTTP/3 doesn't leak to local ISP via the
        // UDP→direct fallback below. Browsers will fall back to TCP/443.
        { type: 'field', port: 443, network: 'udp', outboundTag: 'block' },

        // 2026-05-09 (v61): ALL UDP via proxy (no udp → direct catch-all).
        // Critical for TG voice on iOS: TG iOS pre-flights P2P UDP to a
        // random peer-IP (NOT a TG-CIDR reflector). Sending P2P UDP via
        // local ISP fails on RU TSPU and TG iOS doesn't always retry via
        // reflector. With ALL UDP via VPN, P2P UDP + reflector UDP + DNS
        // over TG's own endpoints all exit from the VPN server's IP →
        // single consistent source IP → NAT-match works regardless of
        // whether TG chose P2P or reflector. Server side: DE/NL flipped
        // from `udp → block` to `udp → direct` (see migrate-server-to-xudp.sh);
        // RU already on direct. Without the server-side flip, this rule
        // change alone would make UDP silently blackhole.

        // Local/private networks → direct
        {
          type: 'field',
          ip: ruIpRanges,
          outboundTag: 'direct',
        },
        // Push notifications (iOS/Android) — must be direct
        {
          type: 'field',
          domain: [
            'domain:push.apple.com',
            'domain:api.push.apple.com',
            'domain:mtalk.google.com',
          ],
          outboundTag: 'direct',
        },
        // RU domains → direct (suffix match, no unicode regex)
        {
          type: 'field',
          domain: [
            ...ruDomainSuffixes,
            ...ruKeywords.map((k) => `keyword:${k}`),
          ],
          outboundTag: 'direct',
        },
        // Explicit catch-all → proxy (needed for v2rayTun TUN mode)
        { type: 'field', port: '0-65535', outboundTag: 'proxy' },
      ],
    },
    remarks: remark,
  };
}

// =============================================================================
// Happ multi-profile JSON-array subscription (XRAY-JSON Subscription format)
// =============================================================================
//
// Spec: https://github.com/XTLS/Xray-core/discussions/3765
// Live reference: DoodleVPN (RU VPN provider) — verified 2026-05-08 to render
// each array element as a separate selectable profile in Happ's UI with its
// own ping measurement.
//
// Format: response body is a JSON ARRAY where each element is a fully valid,
// self-contained Xray config (with `dns`, `inbounds`, `outbounds`, `routing`,
// etc.) plus a `remarks` field for the GUI display name. Happ iterates the
// array and creates one profile per element.
//
// Profile layout (mirrors DoodleVPN UX):
//   [0] ⚡ Авто (быстрый) — multi-outbound + burstObservatory + leastPing
//                          balancer. Auto-routes new TCP streams through the
//                          lowest-ping server.
//   [1..N] Per-server profiles — flag emoji + Russian country name (e.g.
//                                "🇳🇱 Нидерланды"), single VLESS outbound
//                                directly to that server.
//
// EVERY profile has the FULL `network: udp → direct` rule baked into its
// `routing.rules`, so Discord/Telegram/WhatsApp voice calls work whether the
// user picks the auto profile OR a specific country.
//
// SNI per user: serverRows are loaded with pickSniForServer(server, userId)
// already applied at the DB read site, so server.sni is the user-specific
// pool entry. Each profile uses server.sni directly. Different users get
// different SNIs on the same server, breaking the (server-IP, SNI) DPI
// fingerprint pattern. See AGENTS.md "SNI rotation".

const RU_KEYWORDS = [
  'yandex', 'sber', 'tinkoff', 'alfabank', 'vtb', 'gazprom', 'rostelecom',
  'gosuslugi', 'nalog', 'wildberries', 'ozon', 'avito', '2gis',
  'kinopoisk', 'rutube', 'dzen', 'rzd', 'megafon', 'beeline',
  'lemanapro', 'domclick', 'dodopizza', 'userapi', 'mycdn', 'okcdn',
  'vkcdn', 'boosty', 'banki', 'mail.ru', 'vk.com', 'vk.me', 'ok.ru',
  'mts.ru', 'tele2.ru', 'mos.ru',
];

const RU_IP_RANGES = [
  // Yandex
  '77.88.0.0/16', '5.45.192.0/18', '5.255.192.0/18', '87.250.224.0/19',
  '93.158.128.0/18', '95.108.128.0/17', '100.43.64.0/19', '141.8.128.0/18',
  '178.154.128.0/17', '213.180.192.0/19',
  // VK
  '87.240.128.0/18', '93.186.224.0/21', '95.213.0.0/17',
  '185.32.248.0/22', '185.16.244.0/22', '185.16.148.0/22',
  // Mail.ru / OK.ru
  '217.69.128.0/20', '217.20.144.0/20', '5.61.16.0/21',
  // Major ISPs (Rostelecom / MTS / Beeline / Megafon)
  '213.87.0.0/16', '176.114.0.0/16', '185.73.192.0/22',
  '83.220.0.0/15', '85.140.0.0/14',
  // Private / loopback
  '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
  '127.0.0.0/8', '169.254.0.0/16',
];

const RU_DOMAIN_SUFFIXES = ['domain:.ru', 'domain:.su', 'domain:.xn--p1ai'];

const PUSH_NOTIFICATION_DOMAINS = [
  'domain:push.apple.com',
  'domain:api.push.apple.com',
  'domain:mtalk.google.com',
];

/**
 * Telegram CDN / reflector CIDRs (source: https://core.telegram.org/resources/cidr.txt
 * as of 2026-05-08). IPv4 only.
 *
 * v53 → v54 (2026-05-08): UNUSED in routing rules. v53 added these as a
 * `direct` rule based on the assumption that TG was un-blocked in RU
 * ("officially since 2020"). That assumption is WRONG — TSPU / RKN actively
 * blocks Telegram TCP signaling AND voice calls on most RU operators in
 * 2026. Routing TG → direct via local ISP under those conditions breaks
 * EVEN TG TEXT for users (which previously worked through the VPN proxy).
 *
 * Returning to v50 behaviour (TG falls through to catch-all → VPN proxy)
 * which makes TG TEXT work in RU via the VPN's foreign exit IP.
 *
 * The voice-call fix is OUT OF SCOPE for client-routing alone. VLESS+Reality
 * with `xtls-rprx-vision` flow is strictly TCP — UDP voice can't go through
 * the proxy. Real options for TG voice on RU networks:
 *
 *   1. **Mux UDP-over-TCP**: drop `xtls-rprx-vision` flow, use plain VLESS+
 *      Reality + `mux.xudpConcurrency=8` + `mux.packetEncoding="xudp"`.
 *      UDP gets wrapped inside the same TCP/443 Reality stream. Tradeoff:
 *      slightly less DPI-resistant on TCP (vision adds extra padding/timing).
 *      Requires server-side inbound flow change on DE / NL / RU.
 *
 *   2. **Hysteria2 inbound**: install Hysteria2 on each VPS on a separate
 *      UDP port (e.g. 8443). Client gets a SECOND outbound (Hy2) alongside
 *      VLESS. Routing rule: TG CIDR → Hysteria2 outbound for voice.
 *      Tradeoff: more infra, two transports to manage. Best UDP perf.
 *
 *   3. **Status quo**: TG text via VPN works, TG voice doesn't. Users use
 *      TG without VPN for voice (RKN throttles less than TSPU now in 2026).
 *
 * Constant kept for documentation + potential restore once option 1 or 2
 * is implemented. NOT used by current routing builders.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TELEGRAM_CIDR_RANGES = [
  '91.108.4.0/22',     // dc4 / dc5
  '91.108.8.0/21',     // 91.108.8-15.x
  '91.108.16.0/21',    // 91.108.16-23.x
  '91.108.36.0/23',    // 91.108.36-37.x
  '91.108.38.0/23',    // 91.108.38-39.x
  '91.108.56.0/22',    // dc1 / dc3 (Singapore + Amsterdam reflectors)
  '95.161.64.0/20',    // 95.161.64-79.x
  '149.154.160.0/20',  // legacy DC range
  '185.76.151.0/24',   // CDN
];

/**
 * Common routing rules used by every Happ profile (per-server).
 * The catch-all (port 0-65535) is per-server `outboundTag: 'proxy'`.
 *
 * Rule order matters — first match wins:
 *   1. DNS (UDP/53) → dns-out (Xray-internal resolver)
 *   2. BitTorrent → direct (anti-abuse, prevents server-IP burning)
 *   3. QUIC (UDP/443) → block (force HTTP/3 fallback to TCP/443 via VPN —
 *      otherwise browsers leak HTTP/3 destinations to local ISP via the
 *      UDP→direct catch-all below)
 *   4. ALL UDP → direct (Discord/WhatsApp voice fix; xtls-rprx-vision is
 *      TCP-only. NOTE: Telegram voice ALSO falls into this rule, gets
 *      routed via local ISP, and is then blocked by RU TSPU — voice
 *      calls do NOT work in RU operators currently. Server-side mux or
 *      Hysteria2 needed for voice. See TELEGRAM_CIDR_RANGES comment.)
 *   5. RU IP ranges → direct (Yandex/VK/Mail/RU ISPs + private LAN)
 *   6. Push notifications → direct (some Apple/Google push backends
 *      block VPN/datacenter IPs)
 *   7. RU domains (.ru/.su/.рф + service keywords) → direct
 *   8. Catch-all → outboundTag: 'proxy'
 *
 * v54 (2026-05-08): removed the TG CIDR → direct rule that v53 introduced.
 * In RU networks TG is actively blocked by TSPU; routing TG via local ISP
 * means TG TEXT also breaks (was working via the VPN proxy in v50/v52).
 * Catch-all → proxy restores v52 behaviour where at least TG text works.
 */
function buildHappRoutingRules(
  catchAll: { outboundTag: string }
): object[] {
  // 2026-05-09 (v61): removed `network: udp -> direct` and `port 443 udp -> block`.
  // The udp→direct catch-all was routing TG voice UDP (both reflector and P2P)
  // through the user's local ISP where TSPU drops it on RU operators. With
  // VLESS+Reality+XUDP on the server side (and `udp -> direct` on the server's
  // egress outbound), all UDP including TG voice can now ride the proxy.
  // Dropping the QUIC block too: browsers' HTTP/3 now traverses via proxy
  // successfully over XUDP. Working reference configs from competing VPN
  // providers have neither rule — same pattern here.
  //
  // v68.6 NOTE (2026-05-17): we deliberately DO NOT add `geosite:` /
  // `geoip:` references to the Xray rules array. These rules ship in the
  // Xray JSON config that goes to *every* xray-flavoured client
  // (v2rayNG, Streisand, NekoBox, Hiddify-with-Xray, …) — most of them
  // bundle Loyalsoldier's lower-case `geosite:category-ru` and would
  // throw "section not found" on our upper-case categories. The Happ-
  // specific override goes into `buildHappRoutingProfile.DirectSites`
  // instead — that block only reaches Happ via the `routing` HTTP
  // header.
  return [
    { type: 'field', port: 53, outboundTag: 'dns-out' },
    { type: 'field', protocol: ['bittorrent'], outboundTag: 'direct' },
    { type: 'field', ip: RU_IP_RANGES, outboundTag: 'direct' },
    { type: 'field', domain: PUSH_NOTIFICATION_DOMAINS, outboundTag: 'direct' },
    {
      type: 'field',
      domain: [...RU_DOMAIN_SUFFIXES, ...RU_KEYWORDS.map((k) => `keyword:${k}`)],
      outboundTag: 'direct',
    },
    { type: 'field', port: '0-65535', ...catchAll },
  ];
}

/**
 * Happ DNS block — DoH via Cloudflare with FNS hosts overrides.
 *
 * v68.3 (2026-05-17): per-country DNS plane. The NL exit ("Обход Глушилок")
 * is CDN-fronted via the YC bridge (158.160.254.104, Moscow); on that path
 * the DoH chain `https://1.1.1.1/dns-query` via the proxy outbound has to
 * traverse client → YC bridge → NL VPS → 1.1.1.1:443, and any hop dropping
 * outbound HTTPS to Cloudflare IPs silently kills all non-RU resolution.
 * The classic fingerprint of the symptom is "Telegram works (hardcoded
 * MTProto IPs, no DNS needed) but YouTube / browser don't". DE / RU exits
 * don't have the bridge hop and DoH still works there, so we only downgrade
 * NL profiles. Matches the minimal DNS section seen in well-known "обход
 * глушилок"-class xray-core configs sampled in the wild.
 */
function buildHappDns(server?: ServerConfig): object {
  const isNl = (server?.country ?? '').toUpperCase() === 'NL';
  return {
    queryStrategy: 'UseIPv4',
    // NL: plain UDP/53 to Cloudflare. The DNS query is wrapped inside the
    // same VLESS+Reality+XUDP stream that already carries TG voice and
    // Discord WebRTC — if those work, this works.
    // DE / RU: keep the proven DoH chain (works fine without a bridge hop).
    servers: isNl
      ? ['1.1.1.1', '1.0.0.1']
      : ['https://1.1.1.1/dns-query', 'localhost'],
    hosts: {
      // FNS personal cabinet — hardcoded so users with our VPN can still
      // submit nalog declarations even when DoH is blocked or slow.
      'lkfl2.nalog.ru': '213.24.64.175',
      'lknpd.nalog.ru': '213.24.64.181',
    },
    tag: 'dns-inbound',
  };
}

/** Standard Happ inbounds — socks 10808 + http 10809 on localhost. */
function buildHappInbounds(): object[] {
  return [
    {
      listen: '127.0.0.1',
      port: 10808,
      protocol: 'socks',
      settings: { auth: 'noauth', udp: true, userLevel: 0 },
      sniffing: {
        destOverride: ['http', 'tls', 'quic'],
        enabled: true,
        routeOnly: false,
      },
      tag: 'socks-in',
    },
    {
      listen: '127.0.0.1',
      port: 10809,
      protocol: 'http',
      sniffing: { destOverride: ['http', 'tls', 'quic'], enabled: true },
      tag: 'http-in',
    },
  ];
}

/** Build a single VLESS+Reality outbound for one server. */
function buildVlessRealityOutbound(
  uuid: string,
  server: ServerConfig,
  sni: string,
  tag: string
): object {
  // v68.4 (2026-05-17): Vision flow and XUDP packet encoding are MUTUALLY
  // EXCLUSIVE in a single user block. The v60 XUDP migration comment
  // already stated this: "Vision is TCP-only and silently drops UDP; XUDP
  // wraps UDP packets inside the VLESS+Reality TCP stream". Sending both
  // simultaneously produces undefined behaviour in Xray's protocol parser
  // — observed symptom: TCP-ping to the proxy never completes (Happ UI
  // shows "n/a" latency, all traffic stalls).
  //
  // Decision per user-block:
  //   server.flow set (e.g. NL "Обход Глушилок")  -> Vision XTLS, no XUDP.
  //                                                  UDP rides freedom-direct
  //                                                  (catches push/voice via
  //                                                  the routing rules).
  //   server.flow empty (DE / RU XUDP migration)  -> XUDP, no flow.
  //                                                  UDP rides the Reality
  //                                                  TCP stream as before.
  const hasFlow = server.flow && server.flow.trim() !== '';
  return {
    mux: { enabled: false },
    protocol: 'vless',
    settings: {
      vnext: [
        {
          address: clientHost(server),
          port: server.port,
          users: [
            {
              id: uuid,
              encryption: 'none',
              level: 0,
              ...(hasFlow
                ? { flow: server.flow }
                : { packetEncoding: 'xudp' }),
            },
          ],
        },
      ],
    },
    streamSettings: {
      network: 'tcp',
      security: 'reality',
      realitySettings: {
        fingerprint: server.fingerprint || 'chrome',
        publicKey: server.public_key,
        serverName: sni,
        shortId: server.short_id,
        show: false,
        spiderX: '/',
      },
    },
    tag,
  };
}

/**
 * Happ routing rules tuned for a Hysteria2 profile.
 * Differences vs `buildHappRoutingRules`:
 *  - NO `network: udp -> direct` rule. Hy2 is QUIC/UDP-native, so the user
 *    picking this profile WANTS all UDP (voice, games) through the Hy2
 *    tunnel. Forcing it to direct would defeat the entire point.
 *  - NO `port: 443, network: udp -> block` (QUIC block). Browsers' HTTP/3
 *    traffic is now safe to tunnel via Hy2 since Hy2 handles UDP natively.
 *  - Everything else (DNS, BitTorrent, RU IPs, push, RU domains, catch-all)
 *    stays the same.
 */
function buildHappRoutingRulesForHy2(
  catchAll: { outboundTag: string }
): object[] {
  return [
    { type: 'field', port: 53, outboundTag: 'dns-out' },
    { type: 'field', protocol: ['bittorrent'], outboundTag: 'direct' },
    { type: 'field', ip: RU_IP_RANGES, outboundTag: 'direct' },
    { type: 'field', domain: PUSH_NOTIFICATION_DOMAINS, outboundTag: 'direct' },
    {
      type: 'field',
      domain: [...RU_DOMAIN_SUFFIXES, ...RU_KEYWORDS.map((k) => `keyword:${k}`)],
      outboundTag: 'direct',
    },
    { type: 'field', port: '0-65535', ...catchAll },
  ];
}

/**
 * Build a single-server Happ profile for a Hysteria2-enabled server.
 *
 * Emitted as an ADDITIONAL entry in the multi-profile JSON array, right after
 * the per-country VLESS profile (see `buildHappJsonArray`). Shows up in Happ
 * UI as a separate selectable entry labeled "…country… | Pro Hy2" so users
 * can manually pick it for UDP-heavy workloads (Telegram/Discord/WhatsApp
 * voice, online games, HTTP/3) that wouldn't work through the VLESS profile
 * because of the latter's UDP→direct routing rule.
 *
 * Schema notes (CORRECTED in v57 against Xray-core issue #5712 which has a
 * full working VLESS-in → Hy2-out client config):
 *   - `protocol: "hysteria"` with `settings.version: 2` is correct.
 *   - But `settings.address` and `settings.port` are FLAT fields, NOT
 *     nested under `servers: [{ ... }]` (that's the sing-box layout, not
 *     Xray-JSON — the v56 nested form caused Happ's Xray 26.2.6 to fail
 *     the kernel start with "Ошибка запуска ядра").
 *   - `auth` lives in `streamSettings.hysteriaSettings.auth`, NOT in
 *     `settings.servers[0].users[0].auth`. The `hysteriaSettings` block
 *     also accepts `up` / `down` bandwidth caps which let Hy2's BBR-like
 *     congestion control auto-tune.
 *   - TLS pinning: Xray 26.x supports `pinnedPeerCertSha256` (the
 *     deprecation warning at kernel start mentions PCS as the
 *     replacement for `allowInsecure`). Format pitfalls (took 3 versions):
 *       v57: array of strings  → `cannot unmarshal array into Go struct
 *                                  field ... of type string`
 *       v58: `"sha256/<b64>"`  → `encoding/hex: invalid byte: U+0073 's'`
 *                                  (Xray hex-decodes the value, hits 's')
 *       v59: PLAIN LOWERCASE HEX string (e.g. `"281310e402a92c..."`) — works.
 *     Confirmed by Xray-core issue #5655 which has a working VLESS-in →
 *     Hy2-out client config with this exact format.
 *   - `alpn: ["h3"]` is mandatory — Hy2 runs QUIC which negotiates HTTP/3.
 */
function buildHappSingleServerHy2Profile(
  server: ServerConfig,
  hy2AuthToken: string,
): object | null {
  if (
    !server.hysteria2_port ||
    !server.hysteria2_password ||
    !server.hysteria2_sni ||
    !server.hysteria2_cert_sha256
  ) {
    return null;
  }

  const flag = server.country ? countryCodeToFlag(server.country) : '';
  const countryName = server.country ? countryCodeToName(server.country) : '';
  const suffix = (server.name ?? '').trim();
  // Same dedup as buildServerTag — если имя == страна, не повторяем.
  const isCountryEcho = !!countryName &&
    suffix.toLowerCase() === countryName.toLowerCase();
  const parts: string[] = [];
  if (flag) parts.push(flag);
  if (countryName) parts.push(countryName);
  const head = parts.join(' ');
  // "Hysteria" вместо тех. сокращения "Hy2" — для Happ-UI читабельнее
  // ("🇩🇪 Германия Hysteria" против "🇩🇪 Германия | Германия Hy2").
  const remark = (suffix && !isCountryEcho)
    ? `${head} | ${suffix} Hysteria`
    : `${head} Hysteria`;

  // Cert SHA256 stored in DB as lowercase hex — that's exactly what Xray-core's
  // PCS field wants too (no `sha256/` prefix, no base64 — those are for the
  // hysteria2:// URI scheme, which is a different layer).
  const pcs = server.hysteria2_cert_sha256;

  return {
    remarks: remark,
    log: { loglevel: 'warning' },
    dns: buildHappDns(server),
    inbounds: buildHappInbounds(),
    outbounds: [
      {
        tag: 'proxy',
        protocol: 'hysteria',
        settings: {
          version: 2,
          address: clientHost(server),
          port: server.hysteria2_port,
        },
        streamSettings: {
          network: 'hysteria',
          security: 'tls',
          tlsSettings: {
            serverName: server.hysteria2_sni,
            alpn: ['h3'],
            // Strict cert pin — accepts our self-signed cert by exact SHA256
            // match without trusting the whole chain. Xray 26.x deprecated
            // `allowInsecure` in favour of this; using PCS now means the
            // 2026-06-01 removal won't break us. NOTE: Xray's PCS field is
            // a single STRING of plain lowercase hex (NOT an array — v57
            // had this wrong; NOT `sha256/<base64>` — v58 had THAT wrong).
            pinnedPeerCertSha256: pcs,
          },
          hysteriaSettings: {
            version: 2,
            // 2026-05-16: auth = sub-token юзера. Hy2 server использует
            // `auth.type: http` и зовёт /api/hysteria/auth для проверки.
            auth: hy2AuthToken,
            // Bandwidth hints — Hy2's BBR-style congestion control uses
            // these as a starting point. Numbers conservatively below DE
            // VPS line rate (10 Gbps) so a single client can't saturate.
            up: '50 mbps',
            down: '200 mbps',
          },
        },
      },
      { protocol: 'freedom', settings: {}, tag: 'direct' },
      { protocol: 'blackhole', settings: {}, tag: 'block' },
      { protocol: 'dns', tag: 'dns-out' },
    ],
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: buildHappRoutingRulesForHy2({ outboundTag: 'proxy' }),
    },
  };
}

/**
 * Build a single-server Happ profile. Used for the per-country entries in
 * the array (one entry per row in the `servers` table).
 *
 * v53 (2026-05-08): the auto-balancer profile (formerly first array element
 * with `remarks: "⚡ Авто (быстрый)"`) was removed at user request — they
 * preferred explicit per-country selection. The buildHappAutoProfile +
 * burstObservatory/leastPing balancer code was deleted; if we want it back
 * later, restore from git history (commit b25d4df).
 */
function buildHappSingleServerProfile(
  uuid: string,
  server: ServerConfig
): object {
  // server.sni is ALREADY the per-user SNI (loaded via pickSniForServer
  // at the DB read site in the GET handler).
  const remark = buildServerTag(server);

  return {
    remarks: remark,
    log: { loglevel: 'warning' },
    dns: buildHappDns(server),
    inbounds: buildHappInbounds(),
    outbounds: [
      buildVlessRealityOutbound(uuid, server, server.sni, 'proxy'),
      { protocol: 'freedom', settings: {}, tag: 'direct' },
      { protocol: 'blackhole', settings: {}, tag: 'block' },
      { protocol: 'dns', tag: 'dns-out' },
    ],
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: buildHappRoutingRules({ outboundTag: 'proxy' }),
    },
  };
}

/**
 * Build the full Happ subscription as a JSON array of per-country profiles.
 * Order matches DB (servers.id ASC).
 *
 * v53 (2026-05-08): no auto-balancer profile (removed at user request).
 *
 * Empty array if no servers — the caller MUST handle that (Happ shows
 * "Empty subscription" in its UI which is at least an honest state).
 */
function buildHappJsonArray(
  uuid: string,
  servers: ServerConfig[],
  hy2AuthToken: string,
): object[] {
  if (servers.length === 0) return [];

  const profiles: object[] = [];
  // Order: first the per-country VLESS profile, then the Hy2 profile (if the
  // server has Hy2 columns set) immediately below it. So in the Happ UI users
  // see "🇩🇪 Германия | Pro" followed by "🇩🇪 Германия | Pro Hy2" — the Hy2
  // entry is clearly associated with the same country.
  for (const server of servers) {
    profiles.push(buildHappSingleServerProfile(uuid, server));
    const hy2 = buildHappSingleServerHy2Profile(server, hy2AuthToken);
    if (hy2) profiles.push(hy2);
  }
  return profiles;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const tokenResult = parseSubTokenV2(token);

    if (!tokenResult) {
      return new Response('Invalid subscription token', {
        status: 403,
        headers: { 'X-Code-Version': CODE_VERSION },
      });
    }

    const telegramId = tokenResult.telegramId ?? null;
    const tokenUserId = tokenResult.userId ?? null;

    const ua = _req.headers.get('user-agent') || '';
    const url = new URL(_req.url);
    const formatParam = url.searchParams.get('format')?.toLowerCase();
    const wantSingbox = formatParam === 'singbox' || formatParam === 'sing-box'
      || (!formatParam && isSingboxClient(ua));
    // Happ on iOS / Android / desktop — multi-profile JSON-array subscription
    // (XRAY-JSON Subscription format) so the user sees one entry per server +
    // an "Авто (быстрый)" balancer entry, like DoodleVPN. Each profile carries
    // the UDP→direct routing rule so Discord/TG voice calls work on every
    // server, not only on auto. See `buildHappJsonArray` and AGENTS.md.
    const wantHapp = formatParam === 'happ'
      || (!formatParam && !wantSingbox && isHappClient(ua));
    const wantXray = formatParam === 'xray' || formatParam === 'v2ray'
      || (!formatParam && !wantSingbox && !wantHapp && isXrayClient(ua));
    // v2rayTun / Remnawave device identification headers
    const xHwid = _req.headers.get('x-hwid');
    const xDeviceOS = _req.headers.get('x-device-os');
    const xDeviceModel = _req.headers.get('x-device-model');
    const xAppVersion = _req.headers.get('x-app-version');

    const deviceType = detectDeviceType(ua, xDeviceOS);
    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'hundlervpnbot';

    // Find user + active subscription (including traffic data for subscription-userinfo header)
    type SubRow = {
      user_id: number; sub_id: number; end_date: string; max_devices: number;
      traffic_used_bytes: string; traffic_limit: string | null;
    };
    const userWhereClause = telegramId ? 'u.telegram_id = $1' : 'u.id = $1';
    const userParam = telegramId ?? tokenUserId;

    const subResult = await dbQuery<SubRow>(
      `SELECT u.id AS user_id, s.id AS sub_id, s.end_date::text,
              COALESCE(p.max_devices, 3) AS max_devices,
              COALESCE(s.traffic_used_bytes, 0)::text AS traffic_used_bytes,
              p.traffic_limit::text AS traffic_limit
       FROM users u
       JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active' AND s.end_date > NOW()
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE ${userWhereClause}
       ORDER BY s.end_date DESC LIMIT 1`,
      [userParam]
    );

    if (subResult.rows.length === 0) {
      // v45 change: always show a usable "expired" page for any registered user
      // (even ones who never bought a subscription). Previously we returned 404
      // for users without any vpn_keys, which made the subscription URL look
      // broken before purchase. Now the URL is always imprintable into a VPN
      // client; it just shows two dummy 127.0.0.1 servers with a "buy subscription"
      // call-to-action as server names.
      const userCheck = await dbQuery(
        `SELECT 1 FROM users u WHERE ${userWhereClause} LIMIT 1`,
        [userParam]
      );
      if (userCheck.rows.length === 0) {
        return new Response('User not found', {
          status: 404,
          headers: { 'X-Code-Version': CODE_VERSION },
        });
      }
      const fk = '00000000-0000-0000-0000-000000000000';
      const expiredLinks = [
        `vless://${fk}@127.0.0.1:443?security=none&type=tcp#${encodeURIComponent('⚠️ Подписка не активна')}`,
        `vless://${fk}@127.0.0.1:443?security=none&type=tcp#${encodeURIComponent(`🔄 Оформить: https://t.me/${botUsername}`)}`,
      ];
      return new Response(Buffer.from(expiredLinks.join('\n')).toString('base64'), {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'subscription-userinfo': 'upload=0; download=0; total=0; expire=0',
          'profile-update-interval': '1',
          'profile-title': 'Hundler VPN',
          'support-url': `https://t.me/${botUsername}`,
          'profile-web-page-url': 'https://hundlervpn.xyz',
          'Cache-Control': 'no-store',
          'X-Code-Version': CODE_VERSION,
        },
      });
    }

    const { user_id, sub_id, end_date, max_devices, traffic_used_bytes, traffic_limit } = subResult.rows[0];
    const trafficUsed = parseInt(traffic_used_bytes, 10) || 0;
    const trafficTotal = parseInt(traffic_limit || '0', 10) || 1000000000000; // default 1 TB

    // Find user's active shared key (legacy — kept for browser UA / first-time fallback).
    // May be null if all shared keys have been deactivated by the per-device migration.
    const keysResult = await dbQuery<VpnKeyRow>(
      `SELECT vk.id, vk.key_hash, vk.expires_at::text
       FROM vpn_keys vk
       WHERE vk.user_id = $1 AND vk.key_hash IS NOT NULL
         AND vk.key_uri != 'per-device'
         AND (vk.expires_at IS NULL OR vk.expires_at > NOW())
       ORDER BY vk.is_active DESC, vk.created_at DESC
       LIMIT 1`,
      [user_id]
    );

    const activeKey: VpnKeyRow | null = keysResult.rows[0] ?? null;

    if (activeKey) {
      // Reactivate the shared/legacy vpn_key on every touch and refresh its
      // expires_at to match the current subscription. Without is_active=TRUE
      // here, restoreActivePoolEntries (which filters by is_active=TRUE)
      // can't recover the pool row, AND /api/xray/clients excludes the row
      // via its WHERE-clause join — so the user's cached VLESS configs go
      // stale even though sub endpoint keeps handing out the UUID.
      //
      // v63: idempotent — same conditional pattern as ensureSessionUuid above.
      // Stops sub-endpoint polls from flapping is_active for legacy shared
      // keys when /api/users/state had just deactivated a duplicate.
      await dbQuery(
        `UPDATE vpn_keys SET is_active = TRUE, last_connected_at = NOW(), expires_at = $2
          WHERE id = $1
            AND (is_active IS DISTINCT FROM TRUE OR expires_at IS DISTINCT FROM $2::timestamptz)`,
        [activeKey.id, end_date]
      ).catch(() => {});
      // Mirror the per-device fix from ensureSessionUuid: make sure the
      // pool row for this UUID exists and is bound to this vpn_key id.
      const sharedPoolChanged = await ensurePoolRowForKey(activeKey.id, activeKey.key_hash).catch((err) => {
        console.warn(`[sub] ensurePoolRowForKey (shared) failed:`, err);
        return false;
      });
      if (sharedPoolChanged) {
        console.log(`[sub] pool row healed for shared vpn_key=${activeKey.id}, firing webhook`);
        triggerXraySync('fire-and-forget').catch(() => {});
      }
    }

    // UUID used in VLESS links returned to THIS request. Defaults to the
    // shared key (for browser UA / legacy clients) and is overridden by a
    // per-device key once we have a device_session.
    let activeUuid = activeKey?.key_hash ?? '';
    // Build a human-readable device name.
    //
    // Priority:
    //   1. If v2rayTun / Remnawave sent `X-Device-Model`, normalise it via
    //      `formatDeviceName()` — strips architecture suffix, and wraps
    //      PC-style hostnames with the OS label (so users don't see
    //      "MakuOSV6PC-2722_x86_64" and think we invented an OS).
    //   2. Else if we recognised the VPN client (singbox/xray UA) but couldn't
    //      detect the OS, pull the app name from the UA head so the user sees
    //      e.g. "v2RayTun" instead of a generic "Device".
    //   3. Else fall back to the OS-type label ("Windows", "iPhone/iPad", …).
    let dName: string;
    if (xDeviceModel) {
      dName = formatDeviceName(xDeviceModel, xDeviceOS, deviceType);
    } else if (deviceType === 'unknown' && (wantSingbox || wantXray || wantHapp)) {
      const appMatch = ua.match(/^([A-Za-z0-9_.-]+)/);
      dName = appMatch ? appMatch[1].replace(/[/_].*/, '') : deviceLabel(deviceType);
    } else {
      dName = deviceLabel(deviceType);
    }

    // Device tracking + limit enforcement (rank-based, race-condition-safe).
    //
    // v45 change: only track REAL VPN clients, not browsers. Previously the
    // gate was `deviceType !== 'unknown' || isKnownVpnClient`, which counted
    // every Mozilla/5.0 (Windows|iPhone|…) browser visit as a device session.
    // That caused ghost "Windows" / "macOS" rows to appear when users copied
    // the subscription URL into a browser tab to preview it (or when Telegram
    // Desktop's WebView visited it).
    //
    // New gate requires AT LEAST ONE of:
    //   - isKnownVpnClient (UA matched sing-box / Xray-CLI)
    //   - v2rayTun / Remnawave X-HWID / X-Device-OS / X-Device-Model header
    //   - VPN app name substring in UA (happ, v2raytun, v2rayng, hiddify, …)
    // Plain browser UAs (Mozilla/…, Safari, Chrome) produce no session.
    const isKnownVpnClient = wantSingbox || wantXray || wantHapp;
    const hasVpnClientHeaders = !!(xHwid || xDeviceOS || xDeviceModel);
    const vpnAppInUa = /(happ|v2raytun|v2rayng|hiddify|streisand|nekobox|nekoray|sing-box|singbox|xray\/|v2ray\/)/i.test(ua);
    const isRealVpnClient = isKnownVpnClient || hasVpnClientHeaders || vpnAppInUa;
    // v48: hoist sessionId out of the if-block so the Hy2 password builder
    // below can use it. 0 = not tracked (browser preview / legacy path).
    let trackedSessionId = 0;
    if (isRealVpnClient) {
      const ip = _req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || _req.headers.get('x-real-ip') || '';
      const deviceHash = buildDeviceHash(ua, deviceType, xHwid);
      console.log(
        `[sub ${CODE_VERSION}] tg=${telegramId} ua="${ua.substring(0, 120)}" `
        + `type=${deviceType} hash="${deviceHash}" xray=${wantXray} singbox=${wantSingbox} happ=${wantHapp}`
        + (xHwid ? ` hwid=${xHwid}` : '')
        + (xDeviceOS ? ` os=${xDeviceOS}` : '')
        + (xDeviceModel ? ` model=${xDeviceModel}` : ''),
      );

      let rank = 0;
      let total = 0;
      let isInsert = false;
      let sessionId = 0;
      let wasRekicked = false;
      let trackError: unknown = null;

      try {
        // STEP 1: upsert session.
        // On INSERT: created_at = NOW(). On UPDATE: created_at mostly unchanged,
        // EXCEPT when re-registering a previously-kicked device — see below.
        //
        // v45 change: kicked_at is now PERSISTENT. Previously (v43) the UPSERT
        // cleared kicked_at on every re-registration, which meant VPN clients'
        // auto-refresh (Happ / v2rayTun poll every `profile-update-interval`=1min)
        // effectively un-kicked themselves: user kicks → 60 seconds later the
        // client re-polls → UPSERT clears kicked_at → device is back.
        //
        // New semantics: once kicked, the row stays kicked forever (until an
        // admin explicitly un-kicks it via the admin panel). The subscription
        // refresh from a kicked device still hits the UPSERT, but the row's
        // kicked_at is left untouched. We detect this via `was_kicked_before`
        // in RETURNING and serve the user a clear "device removed" error.
        //
        // NOTE: WHERE clause on ON CONFLICT would SKIP the update entirely
        // (not even touching last_seen_at), but we WANT last_seen_at to reflect
        // the polling attempt — it's useful for detecting active clients.
        // So we keep the update, just exclude kicked_at/created_at from the SET.
        const upsertRes = await dbQuery<{ id: number; is_insert: boolean; is_kicked: boolean }>(
          `INSERT INTO device_sessions (user_id, device_hash, device_name, ip_address, user_agent, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (user_id, device_hash) DO UPDATE
             SET last_seen_at = NOW(),
                 ip_address   = COALESCE(NULLIF(EXCLUDED.ip_address, ''), device_sessions.ip_address),
                 user_agent   = COALESCE(NULLIF(EXCLUDED.user_agent, ''), device_sessions.user_agent),
                 device_name  = COALESCE(NULLIF(EXCLUDED.device_name, ''), device_sessions.device_name)
                 -- kicked_at and created_at are INTENTIONALLY NOT touched (v45).
           RETURNING id,
                     (xmax = 0) AS is_insert,
                     (kicked_at IS NOT NULL) AS is_kicked`,
          [user_id, deviceHash, dName, ip, ua.substring(0, 500)]
        );

        if (upsertRes.rows.length > 0) {
          sessionId = upsertRes.rows[0].id;
          isInsert = upsertRes.rows[0].is_insert === true;
          wasRekicked = upsertRes.rows[0].is_kicked === true;
          // v48: surface this id to the outer-scope Hy2 password builder.
          trackedSessionId = sessionId;
        }

        // STEP 2: compute rank of this session among user's ACTIVE (non-kicked)
        // sessions. Kicked rows are excluded so they don't occupy a slot —
        // otherwise a user could kick all 3 devices and be unable to add new ones.
        // created_at is stable across concurrent retries, so rank is deterministic.
        if (sessionId > 0) {
          const rankRes = await dbQuery<{ rank: number; total: number }>(
            `WITH ranked AS (
               SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rank
               FROM device_sessions
               WHERE user_id = $1
                 AND last_seen_at > NOW() - INTERVAL '30 days'
                 AND kicked_at IS NULL
             )
             SELECT r.rank::int AS rank,
                    (SELECT COUNT(*)::int FROM ranked) AS total
             FROM ranked r
             WHERE r.id = $2`,
            [user_id, sessionId]
          );
          if (rankRes.rows.length > 0) {
            rank = rankRes.rows[0].rank ?? 0;
            total = rankRes.rows[0].total ?? 0;
          }
        }
      } catch (err) {
        trackError = err;
      }

      const errMsg = trackError
        ? ((trackError as Error)?.message ?? String(trackError))
        : '';
      const errCode = trackError ? ((trackError as { code?: string })?.code ?? '') : '';

      console.log(
        `[device-track ${CODE_VERSION}] tg=${telegramId} userId=${user_id} type=${deviceType} `
        + `ip=${ip || '-'} hash="${deviceHash.substring(0, 80)}" `
        + `sessionId=${sessionId} isInsert=${isInsert} wasRekicked=${wasRekicked} `
        + `rank=${rank} total=${total}/${max_devices} `
        + `ua="${ua.substring(0, 160)}"`
        + (trackError ? ` ERROR(${errCode})=${errMsg}` : '')
      );

      // FAIL CLOSED: if tracking query failed, refuse to hand out a config.
      if (trackError) {
        return new Response(`Device tracking unavailable: ${errCode} ${errMsg}`.slice(0, 500), {
          status: 503,
          headers: {
            'X-Code-Version': CODE_VERSION,
            'Cache-Control': 'no-store',
          },
        });
      }

      // v45: Kicked devices auto-refresh every minute (profile-update-interval=1).
      // Reject such refreshes with a clear "device removed" error so the VPN
      // client UI switches from "connected" to "profile removed" state. The
      // kicked row's UUID was already purged from the pool at kick-time, so
      // the client couldn't actually connect anyway — this just makes the
      // reason visible in the client UI instead of showing a silent failure.
      if (wasRekicked) {
        console.log(
          `[device-kicked ${CODE_VERSION}] BLOCKED auto-refresh from kicked device: `
          + `tg=${telegramId} userId=${user_id} sessionId=${sessionId} `
          + `hash="${deviceHash.substring(0, 80)}"`
        );

        const kickHeaders = {
          'X-Code-Version': CODE_VERSION,
          'subscription-userinfo': 'upload=0; download=0; total=0; expire=0',
          'profile-update-interval': '1',
          'profile-title': 'Hundler VPN - Removed',
          'Cache-Control': 'no-store',
        };

        if (wantSingbox) {
          const errorJson = {
            meta: null,
            outbounds: null,
            remarks: '🚫 Устройство удалено владельцем\n📲 Переустановите профиль, чтобы подключить заново',
          };
          return new Response(JSON.stringify(errorJson), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8', ...kickHeaders },
          });
        }

        const fk = '00000000-0000-0000-0000-000000000000';
        const kickLinks = [
          `vless://${fk}@127.0.0.1:443?security=none&type=tcp#${encodeURIComponent('🚫 Устройство удалено')}`,
          `vless://${fk}@127.0.0.1:443?security=none&type=tcp#${encodeURIComponent('📲 Переустановите профиль')}`,
        ];
        return new Response(Buffer.from(kickLinks.join('\n')).toString('base64'), {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', ...kickHeaders },
        });
      }

      // Rank is stable across retries, so blocking is idempotent (no race).
      if (rank > max_devices) {
        // Clean up: if we JUST created this session (INSERT) and it's already
        // over the limit, DELETE it. Otherwise it sticks in DB with rank>max,
        // and gets auto-promoted when the user deletes another device, causing
        // unexpected "zombie" device activation on next refresh.
        if (isInsert && sessionId > 0) {
          await dbQuery(
            `DELETE FROM device_sessions WHERE id = $1`,
            [sessionId],
          ).catch((err) => {
            console.error(`[device-limit ${CODE_VERSION}] failed to delete over-limit session:`, err);
          });
        }

        console.log(
          `[device-limit ${CODE_VERSION}] BLOCKED tg=${telegramId} userId=${user_id} `
          + `type=${deviceType} rank=${rank} total=${total}/${max_devices} hash="${deviceHash.substring(0, 80)}" `
          + `sessionDeleted=${isInsert && sessionId > 0}`
        );

        const limitHeaders = {
          'X-Code-Version': CODE_VERSION,
          'subscription-userinfo': 'upload=0; download=0; total=0; expire=0',
          'profile-update-interval': '1',
          'profile-title': 'Hundler VPN - Device Limit',
          'Cache-Control': 'no-store',
        };

        // Return simplified JSON for sing-box clients (NekoBox/NekoRay).
        // Happ-specific `{ meta, outbounds, remarks }` removed: v2rayTun and
        // other Xray clients can't parse it → they show a raw JSON error.
        // All Xray clients + fallback clients get base64 VLESS URIs below —
        // the limit message shows up as server names, universally supported.
        if (wantSingbox) {
          const errorJson = { meta: null, outbounds: null, remarks: `⛔ Лимит устройств: ${max_devices}/${max_devices}\n🗑 Удалите устройство на hundlervpn.xyz` };
          return new Response(JSON.stringify(errorJson), {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8', ...limitHeaders },
          });
        }

        // Return base64 VLESS error links for Xray / v2ray / other clients
        const fk = '00000000-0000-0000-0000-000000000000';
        const limitLinks = [
          `vless://${fk}@127.0.0.1:443?security=none&type=tcp#${encodeURIComponent(`⛔ Лимит устройств: ${max_devices}/${max_devices}`)}`,
          `vless://${fk}@127.0.0.1:443?security=none&type=tcp#${encodeURIComponent(`🗑 Удалите устройство на hundlervpn.xyz`)}`,
        ];
        return new Response(Buffer.from(limitLinks.join('\n')).toString('base64'), {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', ...limitHeaders },
        });
      }

      // Device is within the per-user limit. Allocate a per-session UUID
      // (each device_session gets its own vpn_key + UUID from the pool so
      // kicks can surgically invalidate ONE device without affecting siblings).
      try {
        const sessionResult = await ensureSessionUuid(sessionId, user_id, sub_id, end_date, dName);
        if (sessionResult) {
          activeUuid = sessionResult.uuid;
        } else {
          console.warn(`[session-uuid ${CODE_VERSION}] ensureSessionUuid returned null userId=${user_id} sessionId=${sessionId}`);
        }
      } catch (uErr) {
        console.error(`[session-uuid ${CODE_VERSION}] error:`, uErr);
      }
    }

    // No UUID at all — neither shared key nor per-device key available
    if (!activeUuid) {
      return new Response('No active keys', {
        status: 404,
        headers: { 'X-Code-Version': CODE_VERSION },
      });
    }

    // Per-server traffic-quota enforcement (2026-05-10):
    // LEFT JOIN LATERAL aggregates the user's `bytes_used` for this server
    // across BOTH protocols (vless + hy2) into a single per-server total.
    // PK of user_server_traffic is (user_id, server_id, protocol) since
    // 2026-05-16, so we MUST SUM here — otherwise a user with both vless
    // and hy2 rows would produce duplicate server rows in this query.
    // A server is marked exceeded when:
    //   • `servers.traffic_limit_bytes IS NOT NULL` (server has a quota), AND
    //   • the user's accumulated total bytes_used for that server within the
    //     current rolling 30-day window has met or exceeded the limit.
    // Servers without a configured limit always show `quota_exceeded=false`.
    const serversResult = await dbQuery<ServerConfig & { quota_exceeded: boolean }>(
      `
      SELECT s.name, s.host, s.display_host, s.port, s.country, s.public_key, s.sni, s.short_id, s.fingerprint, s.flow,
             s.hysteria2_port, s.hysteria2_password, s.hysteria2_sni, s.hysteria2_cert_sha256,
             (s.traffic_limit_bytes IS NOT NULL
              AND ust.bytes_used IS NOT NULL
              AND ust.bytes_used >= s.traffic_limit_bytes) AS quota_exceeded
      FROM servers s
      LEFT JOIN LATERAL (
        SELECT SUM(bytes_used)::bigint AS bytes_used
        FROM user_server_traffic
        WHERE server_id = s.id
          AND user_id = $1
          AND quota_period_start > NOW() - INTERVAL '30 days'
      ) ust ON TRUE
      WHERE s.is_active = TRUE
        AND s.public_key IS NOT NULL
        AND s.sni IS NOT NULL
        AND s.short_id IS NOT NULL
      ORDER BY s.sort_order ASC, s.country ASC, s.name ASC;
      `,
      [user_id]
    );

    // SNI rotation (2026-05-08, see lib/sub-token.ts SNI_POOLS): replace each
    // server's `sni` with one picked deterministically from the per-country
    // pool keyed by (user_id, host). Different users converge to a roughly
    // even distribution across 4 SNIs per node, breaking the DPI fingerprint
    // pattern "this IP always advertises SNI=X". Server-side serverNames
    // arrays must include EVERY SNI in the pool (see patch-reality-sni-pool.sh).
    //
    // Quota-exceeded servers (currently only NL "Обход Глушилок" with 50 GB
    // rolling 30-day cap) are dropped here so they disappear from the user's
    // profile list on next sub-poll (~60 s). Other servers keep working.
    const serverRows: ServerConfig[] = serversResult.rows
      .filter((s) => !s.quota_exceeded)
      .map((s) => ({
        ...s,
        sni: pickSniForServer(s, user_id),
      }));

    const expireTs = end_date
      ? Math.floor(new Date(end_date).getTime() / 1000)
      : 0;

    // Common subscription headers for Happ / Hiddify / v2rayNG — shows traffic,
    // expiry, support link, and web page in the VPN client UI.
    const subHeaders: Record<string, string> = {
      'subscription-userinfo': `upload=0; download=${trafficUsed}; total=0; expire=${expireTs}`,
      'profile-update-interval': '1',
      'profile-title': 'Hundler VPN',
      'support-url': `https://t.me/${botUsername}`,
      'profile-web-page-url': 'https://hundlervpn.xyz',
      'Cache-Control': 'no-store',
      'X-Code-Version': CODE_VERSION,
    };

    // v47: push the appropriate routing config to Happ / v2RayTun via the
    // `routing` HTTP header. Without this, raw-VLESS-list users have NO
    // client-side routing rules → all traffic (including UDP voice) goes
    // through the VLESS proxy outbound → silently dropped because the
    // xtls-rprx-vision flow is TCP-only. v2RayTun's routing config supports
    // `network: udp` so Discord voice fully works there.
    //
    // v62 (2026-05-15): RE-ENABLED routing header for Happ. v52 had removed
    // it on the assumption that per-profile `routing.rules` (inside the
    // multi-profile JSON-array) would be enough — but in practice Happ
    // CACHES per-profile routing.rules at first import and does NOT update
    // them on subsequent subscription refreshes. So when we change rules
    // server-side (e.g. drop the UDP→direct rule after the XUDP migration
    // in v60-v61), existing users keep the OLD routing forever, and break
    // in subtle ways: TG voice fails on RU operators, browser HTTP/3 leaks
    // to local ISP, etc.
    //
    // The Happ-format `routing` header (`happ://routing/onadd/{base64}`)
    // is re-evaluated on every poll — Happ applies it as a global routing
    // context that takes precedence over per-profile rules. This way we
    // can fix routing bugs without forcing every user to re-import the
    // subscription.
    //
    // Per-profile `routing.rules` are KEPT as fallback for old Happ
    // versions that don't honour the header, and for clients that don't
    // poll the subscription URL after import.
    const routingHeader = buildRoutingHeader(ua);
    if (routingHeader) {
      subHeaders['routing'] = routingHeader;
    }

    // Happ multi-profile JSON-array subscription (XRAY-JSON Subscription
    // format per https://github.com/XTLS/Xray-core/discussions/3765). Each
    // array element is a self-contained Xray config; Happ shows each as a
    // separate selectable profile in its server list. See `buildHappJsonArray`
    // function header for full architecture notes.
    // v48 (2026-05-17): Hy2 password is now per-session, not per-user. When
    // we know which device_session this poll belongs to, use the session-
    // scoped HMAC password so that an owner-initiated kick (DELETE row →
    // sessionId disappears) makes /api/hysteria/auth reject this client's
    // next reauth even though the user's subscription is still active.
    //
    // Fall back to the user-level sub-token only when sessionId is unknown
    // (legacy code paths / browser admin previews that bypass device-track).
    // /api/hysteria/auth handles both formats — `s<id>.<sig>` decodes via
    // `parseSessionHy2Password`, anything else through `parseSubTokenV2`.
    const hy2AuthForClient = trackedSessionId > 0
      ? generateSessionHy2Password(trackedSessionId)
      : token;

    if (wantHapp && serverRows.length > 0) {
      const profiles = buildHappJsonArray(activeUuid, serverRows, hy2AuthForClient);
      return new Response(JSON.stringify(profiles, null, 2), {
        status: 200,
        headers: { ...subHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // Sing-box JSON config for Hiddify / NekoBox / sing-box clients
    if (wantSingbox && serverRows.length > 0) {
      const keyForConfig: VpnKeyRow = activeKey
        ? { ...activeKey, key_hash: activeUuid }
        : { id: 0, key_hash: activeUuid, expires_at: end_date };
      const config = buildSingboxConfig([keyForConfig], serverRows, hy2AuthForClient);
      return new Response(JSON.stringify(config, null, 2), {
        status: 200,
        headers: { ...subHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // Xray JSON config for Happ / v2rayNG / Streisand / Xray-core clients —
    // includes split DNS (Yandex for RU, Cloudflare for foreign) + smart routing
    // (RU domains/IPs → direct, foreign → VPN). Fixes "Unable to resolve host"
    // errors on Android caused by clients' default DNS being blocked via VPN.
    if (wantXray && serverRows.length > 0) {
      const config = buildXrayConfig(activeUuid, serverRows);
      return new Response(JSON.stringify(config, null, 2), {
        status: 200,
        headers: { ...subHeaders, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // Base64 VLESS links for v2rayNG / Streisand / other clients
    const allLinks: string[] = [];

    if (serverRows.length > 0) {
      for (const server of serverRows) {
        allLinks.push(buildVlessLinkFromServer(activeUuid, server));
        // 2026-05-09 (XUDP migration, v60): hysteria2:// URI emission
        // removed. VLESS+XUDP carries UDP through the same TCP/443
        // Reality stream so a parallel hysteria2:// URI is no longer
        // needed for TG voice / Discord / WhatsApp UDP. Xray-core
        // clients (v2rayTun, Happ, v2rayN, Streisand) ignored hy2://
        // anyway because Xray-core has no Hy2 client implementation.
      }
    } else {
      const envLink = await buildVlessLink(activeUuid);
      if (envLink) allLinks.push(envLink);
    }

    const uniqueLinks = [...new Set(allLinks)];

    if (uniqueLinks.length === 0) {
      return new Response('Server configuration incomplete', {
        status: 500,
        headers: { 'X-Code-Version': CODE_VERSION },
      });
    }

    const encoded = Buffer.from(uniqueLinks.join('\n')).toString('base64');

    return new Response(encoded, {
      status: 200,
      headers: { ...subHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    console.error('Subscription endpoint error:', error);
    return new Response('Internal server error', {
      status: 500,
      headers: { 'X-Code-Version': CODE_VERSION },
    });
  }
}
