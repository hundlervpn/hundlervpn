/**
 * Subscription endpoint — Remnawave proxy (Phase B).
 *
 * Replaces the legacy 2200-line manual VLESS/sing-box/Happ builder
 * (kept as route.legacy.ts.bak). The token scheme is UNCHANGED, so every
 * subscription link already saved in users' clients keeps working.
 *
 * Flow:  token -> local users.id -> ensureRemnawaveUser() -> proxy to
 * sub.hundlervpn.xyz/{shortUuid}. Remnawave's subscription page renders the
 * correct per-client format (Xray / sing-box / Happ / Clash) from User-Agent,
 * so we just forward the request and stream the response back under our domain.
 */

import { dbQuery } from '@/lib/db';
import { parseSubTokenV2 } from '@/lib/sub-token';
import { ensureRemnawaveUser } from '@/lib/remnawave-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CODE_VERSION = 'rw-proxy-1';

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

    // Provision / reconcile the Remnawave user (idempotent) and get its sub URL.
    const ensured = await ensureRemnawaveUser(localUserId);

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response('Subscription temporarily unavailable: ' + msg, {
      status: 502,
      headers: { 'X-Code-Version': CODE_VERSION },
    });
  }
}
