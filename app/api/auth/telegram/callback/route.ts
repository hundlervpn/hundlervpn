import { NextResponse } from 'next/server';
import { dbQuery, getDbPool } from '@/lib/db';
import { randomUUID } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  deactivateExpiredAccess,
  issueTrialAccess,
  upsertTelegramUser,
  userNeedsInitialTrial,
} from '@/lib/access';
import { isAllowedNativeReturn } from '@/lib/native-return';

const TELEGRAM_JWKS_URL = 'https://oauth.telegram.org/.well-known/jwks.json';
const TELEGRAM_ISSUER = 'https://oauth.telegram.org';
const CLIENT_ID = process.env.TELEGRAM_CLIENT_ID || '8649972278';
const CLIENT_SECRET = process.env.TELEGRAM_CLIENT_SECRET || '';
const jwks = createRemoteJWKSet(new URL(TELEGRAM_JWKS_URL));

// OIDC Authorization Code callback
export async function GET(req: Request) {
  const appUrl = process.env.APP_URL || 'https://hundlervpn.xyz';

  // Parse cookies once — used to recover nativeReturn / link state.
  const cookieHeader0 = req.headers.get('cookie') || '';
  const cookieMap = new Map<string, string>();
  for (const c of cookieHeader0.split(';')) {
    const [k, ...v] = c.trim().split('=');
    if (k) cookieMap.set(k, v.join('='));
  }

  // Recover nativeReturn from `state` first (most reliable through the
  // OIDC round-trip on Chrome Custom Tab — same reason Google/start does it).
  // Falls back to cookie set by /api/auth/telegram/start.
  const stateParam0 = new URL(req.url).searchParams.get('state') || '';
  let nativeReturn = '';
  if (stateParam0.includes('.')) {
    const dotIdx = stateParam0.indexOf('.');
    const encoded = stateParam0.slice(dotIdx + 1);
    if (encoded) {
      try {
        nativeReturn = Buffer.from(encoded, 'base64url').toString('utf8');
      } catch {
        /* malformed — fall through */
      }
    }
  }
  if (!nativeReturn) {
    nativeReturn = cookieMap.get('tg_oauth_native_return') || '';
  }
  // Re-validate — see lib/native-return.ts. Same rules as in /start.
  const NATIVE_RETURN_OK = isAllowedNativeReturn(nativeReturn);

  const clearAllCookies = (res: NextResponse) => {
    res.cookies.set('tg_oauth_state', '', { path: '/', maxAge: 0 });
    res.cookies.set('tg_oauth_native_return', '', { path: '/', maxAge: 0 });
    res.cookies.set('tg_link_user', '', { path: '/', maxAge: 0 });
    return res;
  };

  // Helper that, for native-client flows, returns an HTML page which
  // performs the deep-link navigation via JS (server-side 302 to
  // custom:// is blocked by Chrome Custom Tab — same workaround as
  // /api/auth/google/callback).
  const nativeReturnResponse = (sessionToken: string) => {
    const sep = nativeReturn.includes('?') ? '&' : '?';
    const target = `${nativeReturn}${sep}token=${encodeURIComponent(sessionToken)}`;
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
    return clearAllCookies(response);
  };

  const errorRedirect = (msg: string) => {
    if (NATIVE_RETURN_OK) {
      // For native clients we still bounce back to the app via deep-link
      // with `?error=...` so the Flutter side can show the error instead
      // of staring at a Custom Tab that never closes.
      const sep = nativeReturn.includes('?') ? '&' : '?';
      const target = `${nativeReturn}${sep}error=${encodeURIComponent(msg)}`;
      const res = NextResponse.redirect(target);
      return clearAllCookies(res);
    }
    return clearAllCookies(
      NextResponse.redirect(`${appUrl}/login?tg_error=${encodeURIComponent(msg)}`),
    );
  };

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code) {
      const error = url.searchParams.get('error') || 'No authorization code';
      return errorRedirect(error);
    }

    // Exchange authorization code for tokens
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const redirectUri = `${appUrl}/api/auth/telegram/callback`;

    const tokenRes = await fetch('https://oauth.telegram.org/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: CLIENT_ID,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Token exchange failed:', err);
      return errorRedirect('Token exchange failed');
    }

    const tokenData = await tokenRes.json();
    const idToken = tokenData.id_token;

    if (!idToken) {
      return errorRedirect('No id_token received');
    }

    // Verify JWT
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: TELEGRAM_ISSUER,
      audience: CLIENT_ID,
    });

    const telegramId = Number(payload.id || payload.sub);
    if (!telegramId) {
      return errorRedirect('Invalid token');
    }

    const name = (payload.name as string) || null;
    const username = (payload.preferred_username as string) || null;
    const picture = (payload.picture as string) || null;
    const nameParts = name ? name.split(' ') : [];
    const firstName = nameParts[0] || null;
    const lastName = nameParts.slice(1).join(' ') || null;

    // ───────────────────────────────────────────────────────────────────────
    // LINK FLOW: attach Telegram to an existing (email/google) account.
    // Detected by the tg_link_user cookie set by /api/auth/telegram/start-link.
    // ───────────────────────────────────────────────────────────────────────
    const linkUserIdStr = cookieMap.get('tg_link_user');
    const linkUserId = linkUserIdStr ? Number(linkUserIdStr) : null;
    const isLinkFlow = !!(linkUserId && Number.isFinite(linkUserId) && linkUserId > 0);

    const clearLinkCookie = (res: NextResponse) => {
      res.cookies.set('tg_link_user', '', { path: '/', maxAge: 0 });
      return res;
    };

    if (isLinkFlow && linkUserId) {
      // Check that this telegram_id isn't already bound to a different user.
      const conflict = await dbQuery<{ id: number }>(
        `SELECT id FROM users WHERE telegram_id = $1 AND id != $2 LIMIT 1;`,
        [telegramId, linkUserId]
      );
      if (conflict.rows.length > 0) {
        const res = NextResponse.redirect(
          `${appUrl}/?account_error=${encodeURIComponent('Этот Telegram-аккаунт уже привязан к другому пользователю')}`
        );
        return clearLinkCookie(res);
      }

      // Update name / photo from Telegram and set telegram_id.
      await dbQuery(
        `UPDATE users SET
           telegram_id = $2,
           username    = COALESCE($3, username),
           first_name  = COALESCE($4, first_name),
           last_name   = COALESCE($5, last_name),
           photo_url   = COALESCE($6, photo_url),
           last_seen_at = NOW()
         WHERE id = $1;`,
        [linkUserId, telegramId, username, firstName, lastName, picture]
      );

      const res = NextResponse.redirect(
        `${appUrl}/?account_success=${encodeURIComponent('Telegram привязан')}`
      );
      return clearLinkCookie(res);
    }

    // ───────────────────────────────────────────────────────────────────────
    // LOGIN FLOW: upsert via the shared helper so web OIDC users get the
    // same treatment as Mini App users — referral_code, trial access, VPN
    // key, and subscription URL. Previously the callback issued a raw
    // INSERT without a trial, leaving web-registered users stuck without
    // a subscription / subscription URL on their first visit.
    // ───────────────────────────────────────────────────────────────────────
    const ownReferralCode = `u${telegramId.toString(36)}`;
    const pool = getDbPool();
    const client = await pool.connect();
    let userId: number;
    try {
      await client.query('BEGIN');

      const synced = await upsertTelegramUser(client, {
        telegramId,
        username,
        firstName,
        lastName,
        photoUrl: picture,
        referralCode: ownReferralCode,
      });
      userId = synced.userId;

      const shouldCreateTrial = synced.inserted || (await userNeedsInitialTrial(client, userId));
      if (shouldCreateTrial) {
        // Wrap in SAVEPOINT so a trial failure (e.g. UUID pool exhausted)
        // doesn't abort the enclosing transaction — the upserted user
        // should still be persisted so the session can be issued below.
        await client.query('SAVEPOINT trial_issue');
        try {
          await issueTrialAccess(client, userId, telegramId);
          await client.query('RELEASE SAVEPOINT trial_issue');
        } catch (trialErr) {
          await client.query('ROLLBACK TO SAVEPOINT trial_issue');
          console.error('Telegram OIDC: trial issuance failed, continuing login:', trialErr);
        }
      }

      await deactivateExpiredAccess(client, userId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Generate session token
    const sessionToken = randomUUID();
    await dbQuery(
      `INSERT INTO email_sessions (user_id, token) VALUES ($1, $2);`,
      [userId, sessionToken]
    );

    if (NATIVE_RETURN_OK) {
      return nativeReturnResponse(sessionToken);
    }
    return clearAllCookies(
      NextResponse.redirect(`${appUrl}/login?tg_session=${sessionToken}`),
    );
  } catch (error: any) {
    console.error('Telegram OIDC callback error:', error?.message || error);
    const msg = error?.code === 'ERR_JWT_EXPIRED' ? 'Token expired, try again'
      : error?.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ? 'Invalid signature'
      : 'Internal error';
    return errorRedirect(msg);
  }
}
