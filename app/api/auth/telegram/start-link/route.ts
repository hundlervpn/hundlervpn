import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

const CLIENT_ID = process.env.TELEGRAM_CLIENT_ID || '8649972278';

/**
 * Initiate Telegram OIDC link flow for email/google-registered users.
 *
 * Query params:
 *   ?link=<session_token>   — email/google user's session token
 *
 * Sets cookies:
 *   tg_link_user  = resolved userId  (httpOnly, 10 min)
 *
 * Then redirects to Telegram OAuth with the same callback as login.
 * The callback detects the link flow via the tg_link_user cookie.
 */
export async function GET(req: Request) {
  const appUrl = process.env.APP_URL || 'https://hundlervpn.xyz';
  const redirectError = (msg: string) =>
    NextResponse.redirect(`${appUrl}/?account_error=${encodeURIComponent(msg)}`);

  try {
    const url = new URL(req.url);
    const sessionToken = url.searchParams.get('link');

    if (!sessionToken) {
      return redirectError('Missing session token');
    }

    // Resolve userId from session token
    const sessionResult = await dbQuery<{ user_id: number }>(
      `SELECT user_id FROM email_sessions
       WHERE token = $1 AND expires_at > NOW()
       LIMIT 1;`,
      [sessionToken]
    );

    if (sessionResult.rows.length === 0) {
      return redirectError('Сессия не найдена или истекла');
    }

    const linkUserId = sessionResult.rows[0].user_id;

    // Check that this user doesn't already have a telegram_id
    const userCheck = await dbQuery<{ telegram_id: number | null }>(
      `SELECT telegram_id FROM users WHERE id = $1 LIMIT 1;`,
      [linkUserId]
    );
    if (userCheck.rows.length > 0 && userCheck.rows[0].telegram_id) {
      return redirectError('Telegram уже привязан');
    }

    // Build Telegram OAuth URL (same redirect_uri as login)
    const redirectUri = `${appUrl}/api/auth/telegram/callback`;
    const state = Math.random().toString(36).slice(2);
    const telegramOAuthUrl = `https://oauth.telegram.org/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('openid profile telegram:bot_access')}&state=${state}`;

    // Set link cookie and redirect
    const res = NextResponse.redirect(telegramOAuthUrl);
    const isSecure = req.url.startsWith('https://');

    res.cookies.set('tg_link_user', String(linkUserId), {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60,
    });

    return res;
  } catch (error) {
    console.error('Telegram start-link error:', error);
    return redirectError('Internal error');
  }
}
