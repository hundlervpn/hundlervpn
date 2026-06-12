import { NextResponse } from 'next/server';
import { dbQuery, getDbPool } from '@/lib/db';
import { randomUUID } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { buildReferralCodeForUser } from '@/lib/referral-code';
import { attachSiteReferral, issueTrialAccess, userNeedsInitialTrial } from '@/lib/access';
import { isAllowedNativeReturn } from '@/lib/native-return';

const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export async function GET(req: Request) {
  const appUrl = process.env.APP_URL || 'https://hundlervpn.xyz';
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  const redirectError = (msg: string) =>
    NextResponse.redirect(`${appUrl}/login?tg_error=${encodeURIComponent(msg)}`);

  if (!clientId || !clientSecret) {
    return redirectError('Google OAuth не настроен');
  }

  // Clear all OAuth cookies on any flow return.
  const clearLinkCookies = (res: NextResponse) => {
    res.cookies.set('g_oauth_state', '', { path: '/', maxAge: 0 });
    res.cookies.set('g_oauth_link_user', '', { path: '/', maxAge: 0 });
    res.cookies.set('g_oauth_link_origin', '', { path: '/', maxAge: 0 });
    res.cookies.set('g_oauth_native_return', '', { path: '/', maxAge: 0 });
    res.cookies.set('g_oauth_ref', '', { path: '/', maxAge: 0 });
    return res;
  };

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');

    // Parse cookies
    const cookieHeader = req.headers.get('cookie') || '';
    const cookies = new Map<string, string>();
    for (const c of cookieHeader.split(';')) {
      const [k, ...v] = c.trim().split('=');
      if (k) cookies.set(k, v.join('='));
    }
    const stateCookie = cookies.get('g_oauth_state');
    const linkUserIdStr = cookies.get('g_oauth_link_user');
    const linkUserId = linkUserIdStr ? Number(linkUserIdStr) : null;
    const isLinkFlow = !!(linkUserId && Number.isFinite(linkUserId) && linkUserId > 0);
    const linkOrigin = cookies.get('g_oauth_link_origin') || 'web';

    // Try to recover nativeReturn from state first (most reliable on
    // Chrome Custom Tab where cookies may drop), then fall back to the
    // cookie set by /start (legacy path). The state format is:
    //   <csrf-hex>.<base64url(nativeReturn)>
    // If there's no dot — there's no nativeReturn, plain web flow.
    let nativeReturn = '';
    if (stateParam && stateParam.includes('.')) {
      const dotIdx = stateParam.indexOf('.');
      const encoded = stateParam.slice(dotIdx + 1);
      if (encoded) {
        try {
          nativeReturn = Buffer.from(encoded, 'base64url').toString('utf8');
        } catch {
          /* malformed — fall through to cookie */
        }
      }
    }
    if (!nativeReturn) {
      nativeReturn = cookies.get('g_oauth_native_return') || '';
    }
    // Re-validate — defense in depth. The `start` route already filtered
    // it, but state/cookies could in principle be mutated between start
    // and callback. See lib/native-return.ts for the rules.
    const NATIVE_RETURN_OK = isAllowedNativeReturn(nativeReturn);

    // Origin-aware redirect back to wherever the link flow was initiated from.
    //  - tg  → Telegram deep-link (t.me/<bot>/app?startapp=<code>).
    //          Mini App reads start_param and maps the code to a localized message.
    //          Codes: gl_ok, gl_err_email, gl_err_google, gl_err_cancel, gl_err_token,
    //                 gl_err_state, gl_err_unverified, gl_err_other.
    //  - web → plain /?account_success=<msg> | /?account_error=<msg>.
    const redirectLinkResult = (
      status: 'success' | 'error',
      message: string,
      errorCode?: 'email' | 'google' | 'cancel' | 'token' | 'state' | 'unverified' | 'other',
    ) => {
      let target: string;
      if (linkOrigin === 'tg') {
        const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'hundlervpnbot';
        const tag = status === 'success' ? 'gl_ok' : `gl_err_${errorCode || 'other'}`;
        target = `https://t.me/${botUsername}/app?startapp=${tag}`;
      } else {
        const key = status === 'success' ? 'account_success' : 'account_error';
        target = `${appUrl}/?${key}=${encodeURIComponent(message)}`;
      }
      return clearLinkCookies(NextResponse.redirect(target));
    };

    if (oauthError) {
      const msg = oauthError === 'access_denied' ? 'Вход отменён' : oauthError;
      const errCode: 'cancel' | 'other' = oauthError === 'access_denied' ? 'cancel' : 'other';
      return isLinkFlow ? redirectLinkResult('error', msg, errCode) : redirectError(msg);
    }
    if (!code) {
      return isLinkFlow ? redirectLinkResult('error', 'No authorization code', 'other') : redirectError('No authorization code');
    }

    if (!stateParam || !stateCookie || stateParam !== stateCookie) {
      return isLinkFlow ? redirectLinkResult('error', 'Invalid state', 'state') : redirectError('Invalid state');
    }

    const redirectUri = `${appUrl}/api/auth/google/callback`;

    // Exchange authorization code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Google token exchange failed:', errText);
      return redirectError('Token exchange failed');
    }

    const tokenData = (await tokenRes.json()) as { id_token?: string };
    const idToken = tokenData.id_token;
    if (!idToken) {
      return redirectError('No id_token received');
    }

    // Verify id_token signature + claims
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: GOOGLE_ISSUER,
      audience: clientId,
    });

    const googleId = String(payload.sub || '');
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    const emailVerified = payload.email_verified === true;
    const name = typeof payload.name === 'string' ? payload.name : '';
    const givenName = typeof payload.given_name === 'string' ? payload.given_name : '';
    const familyName = typeof payload.family_name === 'string' ? payload.family_name : '';
    const picture = typeof payload.picture === 'string' ? payload.picture : null;

    if (!googleId) {
      return isLinkFlow ? redirectLinkResult('error', 'Invalid Google token', 'token') : redirectError('Invalid Google token');
    }
    if (!email || !emailVerified) {
      const msg = 'Email не подтверждён в Google';
      return isLinkFlow ? redirectLinkResult('error', msg, 'unverified') : redirectError(msg);
    }

    const firstName = givenName || name.split(' ')[0] || email.split('@')[0];
    const lastName = familyName || name.split(' ').slice(1).join(' ') || null;

    // ───────────────────────────────────────────────────────────────────────
    // LINK FLOW: attach Google to the currently logged-in user.
    // ───────────────────────────────────────────────────────────────────────
    if (isLinkFlow && linkUserId) {
      // Block if this google_id is already bound to a different user.
      // Google's sub is globally unique and unforgeable — nothing to reclaim.
      const googleConflict = await dbQuery<{ id: number }>(
        `SELECT id FROM users WHERE google_id = $1 AND id != $2 LIMIT 1;`,
        [googleId, linkUserId]
      );
      if (googleConflict.rows.length > 0) {
        return redirectLinkResult('error', 'Этот Google-аккаунт уже привязан к другому пользователю', 'google');
      }

      // Email conflict: treat verified email as authoritative; reclaim unverified ones.
      // Rationale (per user feedback): if some other user merely typed this email but
      // never verified it, it's effectively a claim without proof. Google *did* verify
      // the email (we already required payload.email_verified === true above), so we
      // can trust Google and release the unverified claim elsewhere.
      const emailConflict = await dbQuery<{ id: number; email_verified: boolean }>(
        `SELECT id, email_verified FROM users WHERE email = $1 AND id != $2 LIMIT 1;`,
        [email, linkUserId]
      );
      if (emailConflict.rows.length > 0) {
        const other = emailConflict.rows[0];
        if (other.email_verified) {
          return redirectLinkResult(
            'error',
            'Email этого Google-аккаунта уже привязан и подтверждён в другом аккаунте',
            'email',
          );
        }
        // Release the unverified email from the other user so we can assign it here.
        await dbQuery(
          `UPDATE users SET email = NULL, email_verified = FALSE WHERE id = $1;`,
          [other.id]
        );
      }

      await dbQuery(
        `UPDATE users SET
           google_id  = $2,
           email      = $3,
           email_verified = TRUE,
           first_name = COALESCE(first_name, $4),
           last_name  = COALESCE(last_name, $5),
           photo_url  = COALESCE(photo_url, $6),
           last_seen_at = NOW()
         WHERE id = $1;`,
        [linkUserId, googleId, email, firstName, lastName, picture]
      );

      return redirectLinkResult('success', 'Google-аккаунт привязан');
    }

    // ───────────────────────────────────────────────────────────────────────
    // LOGIN FLOW: find user by google_id, then by email, else create new.
    // ───────────────────────────────────────────────────────────────────────
    let userId: number | null = null;
    let createdNewUser = false;
    const byGoogle = await dbQuery<{ id: number }>(
      `SELECT id FROM users WHERE google_id = $1 LIMIT 1;`,
      [googleId]
    );

    if (byGoogle.rows.length > 0) {
      userId = byGoogle.rows[0].id;
      await dbQuery(
        `UPDATE users SET
           first_name = COALESCE($2, first_name),
           last_name  = COALESCE($3, last_name),
           photo_url  = COALESCE($4, photo_url),
           email      = COALESCE(email, $5),
           email_verified = TRUE,
           last_seen_at = NOW()
         WHERE id = $1;`,
        [userId, firstName, lastName, picture, email]
      );
    } else {
      const byEmail = await dbQuery<{ id: number }>(
        `SELECT id FROM users WHERE email = $1 LIMIT 1;`,
        [email]
      );
      if (byEmail.rows.length > 0) {
        userId = byEmail.rows[0].id;
        // Link existing email account to Google
        await dbQuery(
          `UPDATE users SET
             google_id  = $2,
             first_name = COALESCE(first_name, $3),
             last_name  = COALESCE(last_name, $4),
             photo_url  = COALESCE(photo_url, $5),
             email_verified = TRUE,
             last_seen_at = NOW()
           WHERE id = $1;`,
          [userId, googleId, firstName, lastName, picture]
        );
      } else {
        const insertResult = await dbQuery<{ id: number }>(
          `INSERT INTO users (google_id, email, email_verified, first_name, last_name, photo_url, auth_type)
           VALUES ($1, $2, TRUE, $3, $4, $5, 'google')
           RETURNING id;`,
          [googleId, email, firstName, lastName, picture]
        );
        userId = insertResult.rows[0].id;
        createdNewUser = true;
      }
    }

    if (!userId) {
      return redirectError('User upsert failed');
    }

    // Ensure the Google user has a `referral_code` so they can share their
    // invite link from ProfileView. Idempotent — only writes when NULL,
    // so existing telegram-linked codes are never overwritten.
    try {
      await dbQuery(
        `UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL;`,
        [userId, buildReferralCodeForUser(userId)]
      );
    } catch (refErr) {
      console.error('[google/callback] referral_code backfill failed:', refErr);
    }

    // Issue initial 1-day trial to brand-new Google users (parity with
    // /api/auth/verify-code email signup). Google logins go through the
    // same "verified email, no Telegram" tier as email-code logins, so we
    // give them the same trial length. `userNeedsInitialTrial` ensures
    // idempotency — existing users with prior subscriptions/payments/keys
    // never get a duplicate trial when they log back in.
    try {
      const pool = getDbPool();
      const client = await pool.connect();
      try {
        // Site referral attribution — ONLY for brand-new Google signups
        // (LOGIN flow, not account-linking). Sets referred_by_user_id
        // (never overwrites) so the inviter earns the 10% CASH reward on
        // this user's future RUB subscription payments. No bonus DAYS for
        // Google/email signups by design.
        const refCode = cookies.get('g_oauth_ref') || '';
        if (createdNewUser && !isLinkFlow && refCode) {
          try {
            const { attached, inviterUserId } = await attachSiteReferral(client, userId, refCode);
            if (attached) {
              console.log(`[google/callback] site referral attached: invitee=${userId} inviter=${inviterUserId} (cash-only)`);
            }
          } catch (refAttachErr) {
            console.error('[google/callback] site referral attach failed:', refAttachErr);
          }
        }

        if (await userNeedsInitialTrial(client, userId)) {
          await issueTrialAccess(client, userId, 0, 1);
          console.log(`[google/callback] issued 1-day trial for user_id=${userId} (${email})`);
        }
      } finally {
        client.release();
      }
    } catch (trialErr) {
      // Non-fatal: user still authenticates even if trial allocation fails.
      console.error('[google/callback] trial issuance failed:', trialErr);
    }

    // Issue session token (same table as Telegram/email sessions)
    const sessionToken = randomUUID();
    await dbQuery(
      `INSERT INTO email_sessions (user_id, token) VALUES ($1, $2);`,
      [userId, sessionToken]
    );

    // Native client return — open the deep-link `hundler://auth/callback?token=...`.
    // Native client intercepts the deep link via flutter_web_auth_2 /
    // ASWebAuthenticationSession and calls /api/auth/session to fetch user info.
    //
    // Why HTML + JS instead of `NextResponse.redirect(deep-link)`:
    // Chrome Custom Tab (and some WebView-based OAuth controllers on iOS)
    // block server-side 302 redirects to `custom://` schemes — they only
    // honor a navigation triggered by user gesture or by an active page
    // running JS. With a 302 the Tab tries to open `hundler://...` in its
    // own webview, fails silently, and stays on the response page. The user
    // sees "logged in on the web" because no redirect happens, eventually
    // closes the Tab manually, and the native client raises
    // PlatformException(CANCELED) instead of receiving the deep link.
    //
    // The HTML below performs the deep-link navigation from JS context (a
    // navigation the Tab is happy to forward), with a `<meta refresh>`
    // fallback if JS is disabled and a clickable link as the very last
    // fallback in case both navigation paths are blocked.
    if (NATIVE_RETURN_OK) {
      const sep = nativeReturn.includes('?') ? '&' : '?';
      const target = `${nativeReturn}${sep}token=${encodeURIComponent(sessionToken)}`;
      // Escape for HTML attribute context. nativeReturn is whitelisted to
      // hundler:// or hundlervpn:// schemes, but we still HTML-escape to
      // be safe against accidental quotes/angle brackets in the URL.
      const safeTarget = target
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${safeTarget}">
<title>Hundler VPN — открываем приложение</title>
<style>
  html, body { margin: 0; padding: 0; background: #020202; color: #fff;
    font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .box { text-align: center; padding: 24px; max-width: 360px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px; letter-spacing: 0.5px; }
  p { font-size: 14px; color: #a3a3a3; margin: 8px 0 20px; }
  a.btn { display: inline-block; background: #ef4444; color: #fff;
    padding: 12px 20px; border-radius: 12px; text-decoration: none;
    font-weight: 600; font-size: 15px; }
  .spin { width: 22px; height: 22px; border: 2px solid #333;
    border-top-color: #ef4444; border-radius: 50%;
    animation: spin .8s linear infinite; margin: 8px auto 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="box">
  <div class="spin"></div>
  <h1>Открываем Hundler VPN…</h1>
  <p>Если приложение не открылось автоматически, нажмите кнопку.</p>
  <a class="btn" href="${safeTarget}">Открыть приложение</a>
</div>
<script>
  // Defer the navigation by one tick so the page has a chance to render
  // (some browsers refuse a navigation issued during initial parse).
  setTimeout(function () {
    try { window.location.replace(${JSON.stringify(target)}); }
    catch (e) { window.location.href = ${JSON.stringify(target)}; }
  }, 50);
</script>
</body>
</html>`;
      const response = new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
      return clearLinkCookies(response);
    }

    const res = NextResponse.redirect(`${appUrl}/login?tg_session=${sessionToken}`);
    // Clear state cookie
    res.cookies.set('g_oauth_state', '', { path: '/', maxAge: 0 });
    return res;
  } catch (error: any) {
    console.error('Google OIDC callback error:', error?.message || error);
    const msg =
      error?.code === 'ERR_JWT_EXPIRED'
        ? 'Token expired, try again'
        : error?.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'
          ? 'Invalid signature'
          : 'Internal error';
    return redirectError(msg);
  }
}
