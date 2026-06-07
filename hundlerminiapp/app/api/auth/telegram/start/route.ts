import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { isAllowedNativeReturn } from '@/lib/native-return';

// Initiates Telegram OAuth 2.0 (OIDC) Authorization Code flow.
//
// Mirrors the structure of /api/auth/google/start so native clients
// (Android / iOS / Windows) can reuse the same nativeReturn pattern:
//
//   GET /api/auth/telegram/start?nativeReturn=hundler%3A%2F%2Fauth%2Fcallback
//
// The nativeReturn URI is base64url-encoded into the OAuth `state` param.
// The callback decodes it back, mints a session token, and serves an
// HTML page that hops to `hundler://auth/callback?token=...` via a JS
// navigation (server-side 302 → custom scheme is blocked by Chrome
// Custom Tab, hence the HTML bounce — same workaround as Google flow).
//
// CSRF protection: random nonce stored in httpOnly cookie + state.
//
// Without nativeReturn — falls through to the historical web flow that
// redirects back to /login?tg_session=... and the Mini App reads the
// session from the URL.
export async function GET(req: Request) {
  const appUrl = process.env.APP_URL || 'https://hundlervpn.xyz';
  const clientId = process.env.TELEGRAM_CLIENT_ID || '8649972278';

  if (!clientId) {
    return NextResponse.redirect(
      `${appUrl}/login?tg_error=${encodeURIComponent('Telegram OAuth не настроен')}`,
    );
  }

  const url = new URL(req.url);
  const nativeReturnRaw = url.searchParams.get('nativeReturn') || '';

  // See lib/native-return.ts for the full whitelist rationale. Accepts
  // hundler:// / hundlervpn:// custom schemes and http://127.0.0.1:<port>/...
  // for Windows desktop loopback callback.
  let nativeReturn = '';
  if (nativeReturnRaw) {
    if (isAllowedNativeReturn(nativeReturnRaw)) {
      nativeReturn = nativeReturnRaw;
    } else {
      console.warn('[telegram/start] nativeReturn rejected:', nativeReturnRaw);
      return NextResponse.redirect(
        `${appUrl}/login?tg_error=${encodeURIComponent('Недопустимый nativeReturn')}`,
      );
    }
  }

  const redirectUri = `${appUrl}/api/auth/telegram/callback`;
  const csrfNonce = randomBytes(16).toString('hex');

  // state = <csrf>.<base64url(nativeReturn)> — see google/start for the
  // rationale on why we encode nativeReturn into state in addition to
  // the cookie (Custom Tab sometimes drops cookies through the OIDC
  // round-trip on MIUI / Xiaomi Chrome builds).
  const nativeReturnEncoded = nativeReturn
    ? Buffer.from(nativeReturn).toString('base64url')
    : '';
  const state = nativeReturnEncoded
    ? `${csrfNonce}.${nativeReturnEncoded}`
    : csrfNonce;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile telegram:bot_access',
    state,
  });

  const authUrl = `https://oauth.telegram.org/auth?${params.toString()}`;

  const res = NextResponse.redirect(authUrl);
  res.cookies.set('tg_oauth_state', state, {
    httpOnly: true,
    secure: req.url.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });

  if (nativeReturn) {
    res.cookies.set('tg_oauth_native_return', nativeReturn, {
      httpOnly: true,
      secure: req.url.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60,
    });
  }

  return res;
}
