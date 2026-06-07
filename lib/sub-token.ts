import { createHmac } from 'crypto';
import { dbQuery } from '@/lib/db';

export function generateSubToken(telegramId: number): string {
  const secret = process.env.XRAY_SYNC_TOKEN ?? '';
  const idPart = Buffer.from(String(telegramId)).toString('base64url');
  const sig = createHmac('sha256', secret)
    .update(`sub:${telegramId}`)
    .digest('base64url')
    .slice(0, 12);
  return `${idPart}${sig}`;
}

export function generateSubTokenForUser(userId: number): string {
  const secret = process.env.XRAY_SYNC_TOKEN ?? '';
  const idPart = Buffer.from(String(userId)).toString('base64url');
  const sig = createHmac('sha256', secret)
    .update(`usub:${userId}`)
    .digest('base64url')
    .slice(0, 12);
  return `u${idPart}${sig}`;
}

export type SubTokenResult = { telegramId: number; userId?: undefined } | { userId: number; telegramId?: undefined } | null;

export function parseSubToken(token: string): number | null {
  const result = parseSubTokenV2(token);
  return result?.telegramId ?? null;
}

export function parseSubTokenV2(token: string): SubTokenResult {
  const secret = process.env.XRAY_SYNC_TOKEN ?? '';
  if (!secret || token.length < 13) return null;

  // User-ID-based token: starts with "u"
  if (token.startsWith('u')) {
    const inner = token.slice(1); // strip "u" prefix
    if (inner.length < 13) return null;
    const sig = inner.slice(-12);
    const idPart = inner.slice(0, -12);
    let userIdStr: string;
    try {
      userIdStr = Buffer.from(idPart, 'base64url').toString();
    } catch {
      return null;
    }
    const num = Number(userIdStr);
    if (!Number.isFinite(num) || num <= 0) return null;
    const expectedSig = createHmac('sha256', secret)
      .update(`usub:${num}`)
      .digest('base64url')
      .slice(0, 12);
    if (sig !== expectedSig) return null;
    return { userId: num };
  }

  // Legacy telegramId-based token
  const sig = token.slice(-12);
  const idPart = token.slice(0, -12);

  let telegramIdStr: string;
  try {
    telegramIdStr = Buffer.from(idPart, 'base64url').toString();
  } catch {
    return null;
  }

  const num = Number(telegramIdStr);
  if (!Number.isFinite(num) || num <= 0) return null;

  const expectedSig = createHmac('sha256', secret)
    .update(`sub:${num}`)
    .digest('base64url')
    .slice(0, 12);

  if (sig !== expectedSig) return null;
  return { telegramId: num };
}

export function countryCodeToFlag(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return '';
  const base = 0x1f1e6;
  return (
    String.fromCodePoint(base + upper.charCodeAt(0) - 65) +
    String.fromCodePoint(base + upper.charCodeAt(1) - 65)
  );
}

const COUNTRY_NAMES_RU: Record<string, string> = {
  NL: 'Нидерланды',
  DE: 'Германия',
  FR: 'Франция',
  GB: 'Великобритания',
  UK: 'Великобритания',
  US: 'США',
  CA: 'Канада',
  FI: 'Финляндия',
  SE: 'Швеция',
  NO: 'Норвегия',
  CH: 'Швейцария',
  AT: 'Австрия',
  PL: 'Польша',
  CZ: 'Чехия',
  TR: 'Турция',
  JP: 'Япония',
  SG: 'Сингапур',
  HK: 'Гонконг',
  KR: 'Южная Корея',
  RU: 'Россия',
  BY: 'Беларусь',
  KZ: 'Казахстан',
  UA: 'Украина',
};

export function countryCodeToName(code: string): string {
  const upper = code.toUpperCase();
  return COUNTRY_NAMES_RU[upper] || upper;
}

/**
 * Build display tag for a server: "🇳🇱 Нидерланды | Обход Глушилок" format.
 * - flag from country code (always shown if country is set)
 * - Russian country name (e.g. "Нидерланды" for NL)
 * - server.name appended after " | " if set, not generic, AND not just a
 *   duplicate of the country name (e.g. server.name="Германия" + country=DE
 *   would give "🇩🇪 Германия | Германия" which is ugly — dedup to "🇩🇪 Германия").
 */
export function buildServerTag(server: ServerConfig): string {
  const flag = server.country ? countryCodeToFlag(server.country) : '';
  const countryName = server.country ? countryCodeToName(server.country) : '';
  const suffix = (server.name ?? '').trim();
  const isGenericSuffix = !suffix || /^(hundler\s*vpn|vpn|server)$/i.test(suffix.replace(/\s+/g, ' '));
  // Dedup "Country | Country" → just "Country". Case-insensitive compare so
  // "Россия" / "россия" / "РОССИЯ" all match.
  const isCountryEcho = !!countryName &&
    suffix.toLowerCase() === countryName.toLowerCase();

  const parts: string[] = [];
  if (flag) parts.push(flag);
  if (countryName) parts.push(countryName);
  const head = parts.join(' ');

  if (isGenericSuffix || isCountryEcho) return head || suffix || 'Hundler VPN';
  return head ? `${head} | ${suffix}` : suffix;
}

export type ServerConfig = {
  name: string;
  host: string;
  port: number;
  country: string;
  public_key: string;
  sni: string;
  short_id: string;
  fingerprint: string;
  flow: string;
  // 2026-05-11: optional client-facing hostname. When set, this is what
  // gets baked into VLESS / Hy2 URIs and sing-box / Xray configs handed
  // to the user, so the raw VPS IP never leaks. The `host` column stays
  // the IP because:
  //   - server-side ping (app/api/servers/ping) needs an IP to skip DNS
  //   - per-server traffic accounting (app/api/xray/traffic) matches
  //     incoming `server_host` against `servers.host`, and the on-VPS
  //     `/opt/xray-traffic.sh` collector uses `hostname -I` (= IP)
  //   - SNI rotation (`pickSniForServer`) salts the deterministic hash
  //     with `server.host`; rotating it would re-shuffle every user's
  //     SNI on next sub-poll for no security gain
  // Use `clientHost(server)` whenever you need the address that goes
  // into a config the user can see.
  display_host?: string | null;
  // Optional Hysteria2 inbound (sing-box-only — Xray-core has no Hy2 client
  // support, so Happ-Xray subscriptions ignore these). All four columns must
  // be NON-NULL together for the server to advertise a Hy2 outbound; if any
  // is NULL we fall back to VLESS-only for that server.
  // Phase-2 rollout: 2026-05-08 — initially populated for the Germany pilot
  // row only. NL / RU stay NULL until tested. See AGENTS.md
  // > "Hysteria2 inbound on Germany (PILOT)".
  hysteria2_port?: number | null;
  hysteria2_password?: string | null;
  hysteria2_sni?: string | null;
  hysteria2_cert_sha256?: string | null;
};

/**
 * Client-facing address for a server. Returns `display_host` when set
 * (e.g. `de.hundlervpn.xyz`), falling back to the raw `host` (IP) for
 * servers that don't yet have a domain configured. Use this — and ONLY
 * this — when emitting addresses into client configs (VLESS / Hy2 URIs,
 * sing-box / Xray JSON outbounds). For server-side operations (ping,
 * traffic-stats matching, SNI hash) keep using `server.host`.
 */
export function clientHost(server: Pick<ServerConfig, 'host' | 'display_host'>): string {
  const dh = server.display_host?.trim();
  return dh && dh.length > 0 ? dh : server.host;
}

/**
 * SNI rotation pool — Reality-side `serverNames` AND client-side `sni` value.
 *
 * Why rotate SNIs:
 *   DPI (TSPU, ISP-level) increasingly fingerprints by the (server-IP, SNI)
 *   pair: "all connections to 158.160.254.104 advertise SNI=www.microsoft.com"
 *   is a recognisable pattern even though each individual TLS handshake looks
 *   legit. Spreading users across 4 SNIs per node breaks the pattern.
 *
 * What the server-side `serverNames` array does:
 *   Reality (Xray-core) only accepts incoming TLS handshakes whose ClientHello
 *   SNI is in the `serverNames` list — anything else gets fallback-proxied to
 *   the donor `dest` site. So the server-side array MUST be the union of every
 *   SNI any client could send, plus the legacy default for backward compat.
 *   Live NL/DE/RU were originally provisioned with `serverNames=["www.microsoft.com"]`
 *   so we keep that as one of the entries during rollout.
 *
 * Per-country pools:
 *   - 'DE' / 'NL' (foreign exits): foreign CDN domains so the (foreign IP, SNI)
 *     pair stays plausible (a Russian user reaching microsoft.com from a German
 *     IP is normal). Order: keep `www.microsoft.com` first for backward compat.
 *   - 'RU' (Russian exit, Moscow): Russian CDN domains so the (RU IP, SNI) pair
 *     stays plausible (RU IP reaching yastatic.net is normal CDN). Foreign SNIs
 *     on a RU IP are slightly weird because Microsoft has no CDN edge in RU.
 *
 * Client-side picking is DETERMINISTIC by (userId, serverHost) — same user
 * always gets the same SNI on the same server, so cached subscriptions don't
 * mysteriously re-key themselves on every poll. Different users converge to
 * a roughly even ~25 % split per SNI.
 *
 * Source of truth — keep these in sync with the `serverNames` array baked
 * into `scripts/setup-germany-server.sh` / `setup-rf-server.sh` and the
 * `scripts/patch-reality-sni-pool.sh` patch for live nodes.
 */
export const SNI_POOLS: Record<string, readonly string[]> = {
  // Foreign exits — DE, NL (and any future foreign country code falls through
  // to `default` below). www.microsoft.com is FIRST so live nodes provisioned
  // before 2026-05-08 (which only accepted that one SNI) keep working until
  // they're patched to accept the full pool.
  //
  // 2026-05-26: REMOVED `www.tiktok.com`. TikTok is RKN-blocked in RU —
  // RU TSPU/DPI drops the TLS Client Hello before it reaches the exit. Users
  // whose hash bucket landed on tiktok saw `failed to read client hello` /
  // `handshake did not complete successfully` in xray logs and ping=N/A in
  // Happ. The Reality fallback dest is still www.microsoft.com:443 server-
  // side so even cached pre-2026-05-26 subscriptions that still send tiktok
  // SNI will fail closed (no security regression), they just won't connect
  // until they refresh the subscription.
  default: [
    'www.microsoft.com',
    'www.cloudflare.com',
    'www.apple.com',
  ],
  // Russia exit — Moscow IP block is more plausible accessing RU CDN edges
  // than foreign CDNs. www.microsoft.com kept first for the same backward-
  // compat reason as above (live RU node was provisioned with that SNI).
  // RU exit. ВАЖНО: проверяй TLS-handshake (probe-sni.js) каждый раз
  // когда добавляешь сюда новый SNI. `storage.yandex.net` (был тут до
  // 2026-05-24) выдавал ECONNRESET при попытке Reality fall-back —
  // upstream сервер отверг хост, что для пользователей с этим SNI
  // в hash-bucket = тихое падение VLESS. Заменён на `www.cloudflare.com`,
  // он отвечает 200 OK c обычным cloudflare cert.
  RU: [
    'www.microsoft.com',
    'yastatic.net',
    'www.cloudflare.com',
    'vk.com',
  ],
};

/**
 * Stable 32-bit hash of a string. djb2-derived, plenty of mixing for our
 * "spread users across 4 buckets" use case. NOT a cryptographic hash — and
 * doesn't need to be: the SNI pool is public, the picking only needs to
 * look uniform per-user.
 */
function hashStringStable(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // (h * 33) XOR charCode — classic djb2-XOR. `| 0` keeps it int32.
    h = ((h * 33) ^ s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Deterministically pick an SNI from the per-country pool for a given user
 * + server pair. Same (userId, serverHost) → same SNI across all calls so
 * a user's cached subscription doesn't keep flipping between SNIs on every
 * `/api/sub/[token]` poll.
 *
 * Falls back to `server.sni` (the DB value) if the country has no pool or
 * the pool is empty — preserves existing behaviour for any future server
 * country we haven't curated a pool for yet.
 */
export function pickSniForServer(server: ServerConfig, userId: number): string {
  const pool = SNI_POOLS[server.country?.toUpperCase()] ?? SNI_POOLS.default;
  if (!pool || pool.length === 0) return server.sni;
  // Salt with serverHost so different servers for the same user don't all
  // collide on the same SNI index — gives more (user, server)-pair entropy.
  const seed = hashStringStable(`u${userId}@${server.host}`);
  return pool[seed % pool.length];
}

/**
 * Anonymous-fallback SNI picker — used when the subscription endpoint is
 * called without a logged-in user (legacy path / first-time fetch). Rotates
 * across the pool by `serverHost` alone so different servers spread out,
 * but every anonymous request to the same server gets the same SNI.
 */
export function pickSniForServerAnon(server: ServerConfig): string {
  const pool = SNI_POOLS[server.country?.toUpperCase()] ?? SNI_POOLS.default;
  if (!pool || pool.length === 0) return server.sni;
  const seed = hashStringStable(`anon@${server.host}`);
  return pool[seed % pool.length];
}

function normalizeRemarkName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'Hundler VPN';

  const compact = trimmed.replace(/\s+/g, '').toLowerCase();
  if (compact === 'hundlervpn') {
    return 'Hundler VPN';
  }

  return trimmed;
}

/**
 * Build a Hysteria2 URI (hy2 URL scheme — https://v2.hysteria.network/docs/developers/URI-Scheme/).
 *
 * Returns null if the server does not have all four `hysteria2_*` columns set
 * (caller MUST filter before building a subscription line).
 *
 * Scheme:
 *   hysteria2://<urlencoded-password>@<host>:<port>/?sni=<sni>&pinSHA256=sha256/<base64>&insecure=0#<tag>
 *
 * The pinSHA256 param is the self-signed cert fingerprint — clients (Hiddify,
 * NekoBox, v2rayTun, Happ, modern sing-box / Xray builds) verify the server
 * cert against this pin even though it is not CA-signed. Format per v2rayNG
 * issue #4107 is `sha256/<base64>` where <base64> is the 32-byte SHA256 hash
 * base64-encoded. Our DB column stores it as lowercase hex (64 chars) so we
 * convert to base64 at build time.
 *
 * `insecure=0` means "strict cert verify" — the pinSHA256 substitutes for CA
 * trust. If we ever drop pinning (e.g. after migrating DE cert to Let's
 * Encrypt), leave insecure=0 and rely on the CA chain.
 */
export function buildHysteria2Uri(server: ServerConfig): string | null {
  const { hysteria2_port, hysteria2_password, hysteria2_sni, hysteria2_cert_sha256 } = server;
  if (!hysteria2_port || !hysteria2_password || !hysteria2_sni || !hysteria2_cert_sha256) {
    return null;
  }

  // hex → base64 for the pinSHA256 param (v2rayNG / sing-box compatible form).
  const hashB64 = Buffer.from(hysteria2_cert_sha256, 'hex').toString('base64');
  const pin = `sha256/${hashB64}`;

  const flag = server.country ? countryCodeToFlag(server.country) : '';
  const countryName = server.country ? countryCodeToName(server.country) : '';
  const suffix = (server.name ?? '').trim();
  const parts: string[] = [];
  if (flag) parts.push(flag);
  if (countryName) parts.push(countryName);
  // Distinct tag so the Hy2 entry is obvious in the client's profile list
  // next to the standard VLESS entry with the same flag+country.
  const head = parts.join(' ');
  const tag = suffix
    ? `${head} | ${suffix} Hy2`
    : `${head} Hy2`;

  const query = new URLSearchParams({
    sni: hysteria2_sni,
    alpn: 'h3',
    insecure: '0',
    pinSHA256: pin,
  });

  return `hysteria2://${encodeURIComponent(hysteria2_password)}@${clientHost(server)}:${hysteria2_port}/?${query.toString()}#${encodeURIComponent(tag)}`;
}

export function buildVlessLinkFromServer(uuid: string, server: ServerConfig): string {
  const remark = buildServerTag(server);

  // Minimal standard VLESS URI params — maximum compatibility with all
  // VLESS clients (v2rayNG, Happ, Streisand). Avoid emitting extra fields
  // (xudp, alpn, sni-types) — Streisand on iOS is the lowest common denominator,
  // its parser is strict and rejects unexpected params.
  //
  // v68.4 (2026-05-17): Vision flow and XUDP packetEncoding are MUTUALLY
  // EXCLUSIVE — sending both confuses the Xray-core protocol parser on
  // the client side (observed: TCP-ping never completes, "n/a" latency).
  // Per server.flow:
  //   - Set (NL "Обход Глушилок" after v68.4) -> flow=xtls-rprx-vision,
  //     NO packetEncoding. Vision is TCP-only, UDP rides direct.
  //   - Empty (DE / RU, v60 XUDP migration)   -> packetEncoding=xudp,
  //     NO flow. XUDP wraps UDP packets inside the VLESS+Reality TCP
  //     stream so TG voice / Discord / WhatsApp UDP work through proxy.
  //   - Old clients that don't recognise `packetEncoding` ignore the param
  //     (URLSearchParams keeps them backward-compatible).
  const hasFlow = server.flow && server.flow.trim() !== '';
  const queryObj: Record<string, string> = {
    encryption: 'none',
    security: 'reality',
    type: 'tcp',
    sni: server.sni,
    fp: server.fingerprint,
    pbk: server.public_key,
    sid: server.short_id,
  };
  if (hasFlow) {
    queryObj.flow = server.flow;
  } else {
    queryObj.packetEncoding = 'xudp';
  }
  const query = new URLSearchParams(queryObj);

  return `vless://${uuid}@${clientHost(server)}:${server.port}?${query.toString()}#${encodeURIComponent(remark)}`;
}

export async function buildVlessLink(uuid: string): Promise<string | null> {
  const host = process.env.XRAY_VLESS_HOST;
  const port = process.env.XRAY_VLESS_PORT ?? '443';
  const publicKey = process.env.XRAY_REALITY_PUBLIC_KEY;
  const serverName = process.env.XRAY_REALITY_SNI;
  const shortId = process.env.XRAY_REALITY_SHORT_ID;
  const fingerprint = process.env.XRAY_REALITY_FINGERPRINT ?? 'chrome';
  // 2026-05-09: XUDP migration. Default flow is now empty (XUDP carries UDP);
  // Vision is opt-in via XRAY_VLESS_FLOW env override for legacy single-node
  // setups. See buildVlessLinkFromServer() above for the full rationale.
  const flow = process.env.XRAY_VLESS_FLOW ?? '';

  if (host && publicKey && serverName && shortId) {
    const country = process.env.XRAY_VLESS_COUNTRY ?? '';
    const flag = country ? countryCodeToFlag(country) : '';
    const baseRemark = normalizeRemarkName(process.env.XRAY_VLESS_REMARK ?? 'Hundler VPN');
    const remark = flag ? `${flag} ${baseRemark}` : baseRemark;
    // v68.4: Vision flow and XUDP are mutually exclusive — see
    // buildVlessLinkFromServer above for full rationale.
    const hasFlow = flow && flow.trim() !== '';
    const queryObj: Record<string, string> = {
      encryption: 'none', security: 'reality', type: 'tcp',
      sni: serverName, fp: fingerprint, pbk: publicKey, sid: shortId,
    };
    if (hasFlow) {
      queryObj.flow = flow;
    } else {
      queryObj.packetEncoding = 'xudp';
    }
    const query = new URLSearchParams(queryObj);
    return `vless://${uuid}@${host}:${port}?${query.toString()}#${encodeURIComponent(remark)}`;
  }

  // Fallback: fetch active server from DB
  try {
    const result = await dbQuery<ServerConfig>(
      `SELECT name, host, display_host, port, country, public_key, sni, short_id, fingerprint, flow
       FROM servers WHERE is_active = TRUE AND public_key IS NOT NULL AND sni IS NOT NULL
       ORDER BY id ASC LIMIT 1`
    );
    if (result.rows[0]) {
      return buildVlessLinkFromServer(uuid, result.rows[0]);
    }
  } catch (e) {
    console.error('buildVlessLink DB fallback error:', e);
  }
  return null;
}

export function getSubscriptionUrl(telegramId: number): string | null {
  const appUrl = process.env.APP_URL;
  const secret = process.env.XRAY_SYNC_TOKEN;
  if (!appUrl || !secret) return null;
  const token = generateSubToken(telegramId);
  return `${appUrl}/api/sub/${token}`;
}

export function getSubscriptionUrlForUser(userId: number): string | null {
  const appUrl = process.env.APP_URL;
  const secret = process.env.XRAY_SYNC_TOKEN;
  if (!appUrl || !secret) return null;
  const token = generateSubTokenForUser(userId);
  return `${appUrl}/api/sub/${token}`;
}

/**
 * Per-session Hy2 password (v48, 2026-05-17).
 *
 * Format: `s<sessionId>.<sig12>` where `<sig12>` is the first 12 chars of
 * `HMAC-SHA256(XRAY_SYNC_TOKEN, "hy2-sess:" + sessionId).digest('base64url')`.
 *
 * Why session-scoped instead of user-scoped:
 *   Earlier (v62-v47) the Hy2 outbound used the user's sub-token as the
 *   password, so `/api/hysteria/auth` accepted any reconnect from that user
 *   regardless of which device was reconnecting. That defeated owner-initiated
 *   device kicks: VLESS dropped via Xray restart, but Hy2 kept working until
 *   the user manually removed the profile. v48 binds the password to a
 *   specific `device_sessions.id` so a kicked session's Hy2 path also dies
 *   on the next reauth (Hy2 server forces clients to reauth on idle / IP
 *   change / connection migration — usually within ~1 min).
 *
 * The HMAC keeps the password unforgeable without a DB hit when generating
 * the sing-box config (we already know sessionId at that point); on the
 * /api/hysteria/auth side we do verify the HMAC AND look up the session row
 * to make sure it hasn't been deleted (= kicked).
 */
export function generateSessionHy2Password(sessionId: number): string {
  const secret = process.env.XRAY_SYNC_TOKEN ?? '';
  const sig = createHmac('sha256', secret)
    .update(`hy2-sess:${sessionId}`)
    .digest('base64url')
    .slice(0, 12);
  return `s${sessionId}.${sig}`;
}

/**
 * Parse a per-session Hy2 password produced by `generateSessionHy2Password`.
 *
 * Returns the embedded sessionId on success or null on:
 *   - missing leading 's'
 *   - missing dot separator
 *   - non-numeric session id
 *   - HMAC mismatch
 *
 * NB: the HMAC alone only proves the password was issued by us. The caller
 * MUST also verify that `device_sessions WHERE id = sessionId` still exists
 * (a deleted row → device was kicked → reject the auth).
 */
export function parseSessionHy2Password(token: string): number | null {
  if (!token || token.length < 4) return null;
  if (!token.startsWith('s')) return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx < 2) return null;
  const idPart = token.slice(1, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (sig.length !== 12) return null;
  const sessionId = Number(idPart);
  if (!Number.isFinite(sessionId) || sessionId <= 0 || !Number.isInteger(sessionId)) return null;
  const secret = process.env.XRAY_SYNC_TOKEN ?? '';
  if (!secret) return null;
  const expected = createHmac('sha256', secret)
    .update(`hy2-sess:${sessionId}`)
    .digest('base64url')
    .slice(0, 12);
  if (sig !== expected) return null;
  return sessionId;
}

