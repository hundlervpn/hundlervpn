import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { dbQuery } from '@/lib/db';
import { isAllowedNativeReturn } from '@/lib/native-return';

// Initiates Google OAuth 2.0 Authorization Code flow.
// Stores CSRF `state` in httpOnly cookie, redirects the user to Google's consent screen.
//
// Modes:
//  - Login:  GET /api/auth/google/start
//  - Link (email/google session): GET /api/auth/google/start?link=<hvpn_session_token>
//  - Link (Telegram Mini App):    GET /api/auth/google/start?linkTg=<telegram_id>
//            When link/linkTg resolves to an existing user, the callback will attach
//            google_id to that user instead of creating a new one.
//  - Native client return:        GET /api/auth/google/start?nativeReturn=hundler%3A%2F%2Fauth%2Fcallback
//            When set, /callback redirects to `{nativeReturn}?token=<sessionToken>` instead
//            of the default `${appUrl}/login?tg_session=...`. Used by Android/iOS/Windows
//            native clients that open the OAuth flow in a Custom Tab and intercept the
//            final redirect via deep link. Scheme is restricted (see below) to prevent
//            an attacker tricking us into redirecting a freshly minted session token to
//            an arbitrary URL.
export async function GET(req: Request) {
  const appUrl = process.env.APP_URL || 'https://hundlervpn.xyz';
  const clientId = process.env.GOOGLE_CLIENT_ID || '';

  if (!clientId) {
    return NextResponse.redirect(`${appUrl}/login?tg_error=${encodeURIComponent('Google OAuth не настроен')}`);
  }

  const url = new URL(req.url);
  const linkToken = url.searchParams.get('link') || '';
  const linkTgRaw = url.searchParams.get('linkTg') || '';
  const nativeReturnRaw = url.searchParams.get('nativeReturn') || '';

  // Whitelist of allowed schemes/hosts for nativeReturn — see
  // lib/native-return.ts for the rationale and exact rules. Custom URL
  // schemes for Android/iOS/Windows, plus http://127.0.0.1:<port>/... for
  // Windows desktop flow (Flutter spins up a temporary HttpServer there).
  let nativeReturn = '';
  if (nativeReturnRaw) {
    if (isAllowedNativeReturn(nativeReturnRaw)) {
      nativeReturn = nativeReturnRaw;
    } else {
      console.warn('[google/start] nativeReturn rejected:', nativeReturnRaw);
      return NextResponse.redirect(
        `${appUrl}/login?tg_error=${encodeURIComponent('Недопустимый nativeReturn')}`,
      );
    }
  }

  // If link mode — resolve to an existing userId from either session token or telegram_id.
  let linkUserId: number | null = null;
  if (linkToken) {
    try {
      const r = await dbQuery<{ user_id: number }>(
        `SELECT user_id FROM email_sessions WHERE token = $1 AND expires_at > NOW() LIMIT 1;`,
        [linkToken]
      );
      if (r.rows.length > 0) {
        linkUserId = Number(r.rows[0].user_id);
      }
    } catch {
      /* ignore — fall through to error below */
    }
    if (!linkUserId) {
      return NextResponse.redirect(`${appUrl}/?account_error=${encodeURIComponent('Сессия истекла, войдите заново')}`);
    }
  } else if (linkTgRaw) {
    const tgId = Number(linkTgRaw);
    if (Number.isFinite(tgId) && tgId > 0) {
      try {
        const r = await dbQuery<{ id: number }>(
          `SELECT id FROM users WHERE telegram_id = $1 LIMIT 1;`,
          [tgId]
        );
        if (r.rows.length > 0) {
          linkUserId = Number(r.rows[0].id);
        }
      } catch {
        /* ignore */
      }
    }
    if (!linkUserId) {
      return NextResponse.redirect(`${appUrl}/?account_error=${encodeURIComponent('Пользователь не найден')}`);
    }
  }

  const redirectUri = `${appUrl}/api/auth/google/callback`;
  const csrfNonce = randomBytes(16).toString('hex');

  // State packs both the CSRF nonce (verified against `g_oauth_state` cookie)
  // and an optional native-return URL — encoded as `<csrf>.<base64url(uri)>`.
  // The state param is bounced back through accounts.google.com untouched, so
  // it always reaches /callback regardless of whether the Custom Tab managed
  // to persist our `g_oauth_native_return` cookie across the Google round-trip.
  //
  // Why this matters: Chrome Custom Tab sessions on Android sometimes drop
  // cookies set in the initial /start response when navigating through Google
  // (observed on MIUI + Chrome v148). Without state-based encoding, /callback
  // sees the cookie as missing and falls back to the web flow redirect
  // (`/login?tg_session=...`), the deep-link `hundler://...` is never emitted,
  // and the native client times out with PlatformException(CANCELED).
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
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const res = NextResponse.redirect(authUrl);
  // CSRF protection: verify state in callback against this cookie.
  res.cookies.set('g_oauth_state', state, {
    httpOnly: true,
    secure: req.url.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60, // 10 minutes to complete the flow
  });

  if (linkUserId) {
    res.cookies.set('g_oauth_link_user', String(linkUserId), {
      httpOnly: true,
      secure: req.url.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60,
    });
    // Remember origin so callback knows where to send the user back:
    //  - 'tg'  → Telegram Mini App deep-link (t.me/<bot>/app?startapp=gl_success)
    //  - 'web' → our own /?account_success=... banner
    res.cookies.set('g_oauth_link_origin', linkTgRaw ? 'tg' : 'web', {
      httpOnly: true,
      secure: req.url.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60,
    });
  }

  if (nativeReturn) {
    // Cookie remembered until /callback redirects to it. Once redirect
    // is performed the cookie is cleared (see callback route).
    res.cookies.set('g_oauth_native_return', nativeReturn, {
      httpOnly: true,
      secure: req.url.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60,
    });
  }

  return res;
}
