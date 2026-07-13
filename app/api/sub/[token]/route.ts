/**
 * Subscription endpoint.
 *
 * The token scheme is UNCHANGED across backends, so every subscription link
 * already saved in users' clients keeps working.
 *
 * VPN_BACKEND=remnawave (default): proxy to the Remnawave subscription page
 *   (sub.hundlervpn.xyz/{shortUuid}) — original Phase B behaviour, untouched.
 *
 * VPN_BACKEND=3xui: build the subscription OURSELVES as a base64 list of
 *   `vless://` URIs. The single production endpoint (VLESS / XHTTP / TLS on
 *   pl.hundlervpn.xyz:443) is rendered with the user's own UUID, reproducing
 *   the exact config Remnawave used to serve — cached client configs stay
 *   valid. Standard subscription headers (profile-title,
 *   subscription-userinfo, ...) are set for client apps.
 */

import { dbQuery } from '@/lib/db';
import { parseSubTokenV2 } from '@/lib/sub-token';
import { ensureRemnawaveUser } from '@/lib/remnawave-sync';
import { vpnBackend } from '@/lib/vpn-access';
import { clientEmailFor } from '@/lib/threexui-sync';
import { getClientTraffic } from '@/lib/threexui';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CODE_VERSION = 'vpn-sub-2';

// ---------------------------------------------------------------------------
// 3xui: self-built VLESS subscription
// ---------------------------------------------------------------------------

// Production endpoint parameters. Defaults reproduce the live Remnawave host
// config 1-in-1 (verified against the panel DB before migration); env
// overrides allow future endpoint changes without a code deploy.
const VLESS = {
  address: process.env.THREEXUI_VLESS_ADDRESS || 'pl.hundlervpn.xyz',
  port: Number(process.env.THREEXUI_VLESS_PORT || '443'),
  path: process.env.THREEXUI_VLESS_PATH || '/assets/immutable/chunks/',
  sni: process.env.THREEXUI_VLESS_SNI || 'pl.hundlervpn.xyz',
  host: process.env.THREEXUI_VLESS_HOST || 'pl.hundlervpn.xyz',
  alpn: process.env.THREEXUI_VLESS_ALPN || 'h2,http/1.1',
  fingerprint: process.env.THREEXUI_VLESS_FP || 'chrome',
  remark: process.env.THREEXUI_VLESS_REMARK || '🇵🇱 Hundler VPN | Польша',
  // Transport security: 'tls' (default) or 'reality'. Reality nodes also need
  // pbk/sid (public key + shortId); `sni` is used as the Reality serverName.
  security: process.env.THREEXUI_VLESS_SECURITY || 'tls',
  pbk: process.env.THREEXUI_VLESS_PBK || '',
  sid: process.env.THREEXUI_VLESS_SID || '',
  spx: process.env.THREEXUI_VLESS_SPX || '/',
};

type VlessEndpoint = typeof VLESS;

/**
 * Multi-node: THREEXUI_NODES is a JSON array of endpoints; each entry needs
 * at least {"address","remark"} — everything else falls back to the defaults
 * above (all nodes share the XHTTP path/TLS shape by design).
 * Example:
 *   THREEXUI_NODES='[{"address":"pl.hundlervpn.xyz","remark":"🇵🇱 Hundler VPN | Польша"},
 *                    {"address":"nl.hundlervpn.xyz","remark":"🇳🇱 Hundler VPN | Нидерланды"}]'
 * Unset / invalid → single default endpoint (pre-multi-node behaviour).
 */
function vlessEndpoints(): VlessEndpoint[] {
  const raw = process.env.THREEXUI_NODES;
  if (raw) {
    try {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const nodes = arr
          .filter((n): n is Record<string, unknown> => !!n && typeof n === 'object')
          .map((n) => ({
            address: String(n.address || ''),
            port: Number(n.port || VLESS.port),
            path: String(n.path || VLESS.path),
            sni: String(n.sni || n.address || ''),
            host: String(n.host || n.address || ''),
            alpn: String(n.alpn || VLESS.alpn),
            fingerprint: String(n.fp || n.fingerprint || VLESS.fingerprint),
            remark: String(n.remark || n.address || ''),
            security: String(n.security || VLESS.security),
            pbk: String(n.pbk || VLESS.pbk),
            sid: String(n.sid || VLESS.sid),
            spx: String(n.spx || VLESS.spx),
          }))
          .filter((n) => n.address);
        if (nodes.length > 0) return nodes;
      }
      console.error('[sub] THREEXUI_NODES is set but yielded no valid nodes; using default endpoint');
    } catch (err) {
      console.error('[sub] THREEXUI_NODES JSON parse failed; using default endpoint:', err);
    }
  }
  return [VLESS];
}

const PROFILE_TITLE = process.env.SUB_PROFILE_TITLE || 'Hundler VPN';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

function buildVlessUri(node: VlessEndpoint, uuid: string): string {
  const base: Record<string, string> = {
    type: 'xhttp',
    path: node.path,
    sni: node.sni,
    fp: node.fingerprint,
    mode: 'auto',
    encryption: 'none',
  };
  // Reality nodes carry pbk/sid/spx and drop the TLS-only host/alpn fields;
  // TLS nodes keep the original shape (host + alpn) for 1-in-1 compatibility.
  const params: Record<string, string> =
    node.security === 'reality'
      ? { ...base, security: 'reality', pbk: node.pbk, sid: node.sid, spx: node.spx }
      : { ...base, security: 'tls', host: node.host, alpn: node.alpn };
  const q = new URLSearchParams(params);
  return 'vless://' + uuid + '@' + node.address + ':' + node.port + '?' + q.toString()
    + '#' + encodeURIComponent(node.remark);
}

/** Informational "rows" clients render when there is no active subscription. */
function inactiveLines(): string[] {
  const appHost = (process.env.APP_URL || 'https://hundlervpn.xyz').replace(/^https?:\/\//, '');
  return [
    'vless://' + FAKE_UUID + '@127.0.0.1:443?security=none&type=tcp#' + encodeURIComponent('⚠️ Подписка не активна'),
    'vless://' + FAKE_UUID + '@127.0.0.1:443?security=none&type=tcp#' + encodeURIComponent('🔄 Оформить: ' + appHost),
  ];
}

async function serve3xuiSub(localUserId: number, ensured: Awaited<ReturnType<typeof ensureRemnawaveUser>>): Promise<Response> {
  const active = ensured.rwUser.status === 'ACTIVE';
  const lines = active
    ? vlessEndpoints().map((node) => buildVlessUri(node, ensured.rwUser.uuid))
    : inactiveLines();
  const body = Buffer.from(lines.join('\n'), 'utf8').toString('base64');

  const headers = new Headers({
    'content-type': 'text/plain; charset=utf-8',
    'profile-title': 'base64:' + Buffer.from(PROFILE_TITLE, 'utf8').toString('base64'),
    'profile-update-interval': '12',
    'X-Code-Version': CODE_VERSION,
  });
  if (process.env.APP_URL) headers.set('profile-web-page-url', process.env.APP_URL);

  // subscription-userinfo: best-effort traffic counters from the panel.
  const traffic = await getClientTraffic(clientEmailFor(localUserId));
  const expireSec = active ? Math.floor(new Date(ensured.rwUser.expireAt).getTime() / 1000) : 0;
  headers.set('subscription-userinfo',
    'upload=' + (traffic?.up ?? 0) +
    '; download=' + (traffic?.down ?? 0) +
    '; total=' + (ensured.rwUser.trafficLimitBytes || 0) +
    '; expire=' + expireSec);

  return new Response(body, { status: 200, headers });
}

// ---------------------------------------------------------------------------
// remnawave: proxy to the panel subscription page (original behaviour)
// ---------------------------------------------------------------------------

// Request headers worth forwarding so Remnawave can pick format + count devices.
const FORWARD_REQ_HEADERS = [
  'user-agent', 'accept', 'accept-language',
  'x-hwid', 'x-device-os', 'x-device-model', 'x-app-version', 'x-ver-os',
];

// Response headers the subscription clients rely on.
const PASS_RESP_HEADERS = [
  'content-type', 'content-disposition',
  'profile-update-interval', 'subscription-userinfo',
  'profile-title', 'profile-web-page-url', 'support-url', 'announce',
];

function resp(message: string, status: number): Response {
  return new Response(message, { status, headers: { 'X-Code-Version': CODE_VERSION } });
}

async function serveRemnawaveProxy(req: Request, ensured: Awaited<ReturnType<typeof ensureRemnawaveUser>>): Promise<Response> {
  // Build upstream URL, forwarding the original query string.
  const target = new URL(ensured.subscriptionUrl);
  const incoming = new URL(req.url);
  incoming.searchParams.forEach((v, k) => target.searchParams.set(k, v));

  const fwd: Record<string, string> = {};
  for (const h of FORWARD_REQ_HEADERS) {
    const val = req.headers.get(h);
    if (val) fwd[h] = val;
  }

  const upstream = await fetch(target.toString(), {
    method: 'GET',
    headers: fwd,
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });

  const buf = await upstream.arrayBuffer();
  const headers = new Headers();
  for (const h of PASS_RESP_HEADERS) {
    const val = upstream.headers.get(h);
    if (val) headers.set(h, val);
  }
  headers.set('X-Code-Version', CODE_VERSION);
  if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8');

  return new Response(buf, { status: upstream.status, headers });
}

// ---------------------------------------------------------------------------

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const parsed = parseSubTokenV2(token);
    if (!parsed) return resp('Invalid subscription token', 403);

    // Resolve token -> local users.id (token carries telegramId or userId).
    let localUserId: number | null = parsed.userId ?? null;
    if (localUserId == null && parsed.telegramId != null) {
      const r = await dbQuery<{ id: string | number }>(
        'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1',
        [parsed.telegramId],
      );
      localUserId = r.rows[0] ? Number(r.rows[0].id) : null;
    }
    if (localUserId == null) return resp('User not found', 404);

    // Provision / reconcile the panel user (idempotent, backend-dispatched).
    const ensured = await ensureRemnawaveUser(localUserId);

    if (vpnBackend() === '3xui') {
      return await serve3xuiSub(localUserId, ensured);
    }
    return await serveRemnawaveProxy(req, ensured);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response('Subscription temporarily unavailable: ' + msg, {
      status: 502,
      headers: { 'X-Code-Version': CODE_VERSION },
    });
  }
}
