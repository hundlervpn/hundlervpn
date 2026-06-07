import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { randomUUID } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { buildReferralCodeForTelegramUser } from '@/lib/referral-code';

const TELEGRAM_JWKS_URL = 'https://oauth.telegram.org/.well-known/jwks.json';
const TELEGRAM_ISSUER = 'https://oauth.telegram.org';
const CLIENT_ID = process.env.TELEGRAM_CLIENT_ID || '8649972278';

const jwks = createRemoteJWKSet(new URL(TELEGRAM_JWKS_URL));

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id_token } = body;

    if (!id_token) {
      return NextResponse.json({ error: 'Missing id_token' }, { status: 400 });
    }

    // Verify Telegram OIDC id_token JWT
    const { payload } = await jwtVerify(id_token, jwks, {
      issuer: TELEGRAM_ISSUER,
      audience: CLIENT_ID,
    });

    const telegramId = Number(payload.id || payload.sub);
    if (!telegramId) {
      return NextResponse.json({ error: 'Invalid token: no user id' }, { status: 400 });
    }

    const name = (payload.name as string) || null;
    const username = (payload.preferred_username as string) || null;
    const picture = (payload.picture as string) || null;
    const phone = (payload.phone_number as string) || null;

    // Split name into first/last
    const nameParts = name ? name.split(' ') : [];
    const firstName = nameParts[0] || null;
    const lastName = nameParts.slice(1).join(' ') || null;

    // Find or create user
    let userResult = await dbQuery(
      `SELECT id, email, first_name, telegram_id FROM users WHERE telegram_id = $1 LIMIT 1;`,
      [telegramId]
    );

    let userId: number;
    let isNew = false;

    const referralCode = buildReferralCodeForTelegramUser(telegramId);

    if (userResult.rows.length === 0) {
      const insertResult = await dbQuery(
        `INSERT INTO users (telegram_id, username, first_name, last_name, photo_url, auth_type, referral_code)
         VALUES ($1, $2, $3, $4, $5, 'telegram', $6)
         RETURNING id;`,
        [telegramId, username, firstName, lastName, picture, referralCode]
      );
      userId = insertResult.rows[0].id;
      isNew = true;
    } else {
      userId = userResult.rows[0].id;
      await dbQuery(
        `UPDATE users SET first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name), 
         username = COALESCE($4, username), photo_url = COALESCE($5, photo_url), last_seen_at = NOW(),
         referral_code = COALESCE(referral_code, $6)
         WHERE id = $1;`,
        [userId, firstName, lastName, username, picture, referralCode]
      );
    }

    // Generate session token
    const sessionToken = randomUUID();
    await dbQuery(
      `INSERT INTO email_sessions (user_id, token) VALUES ($1, $2);`,
      [userId, sessionToken]
    );

    // Get full user
    userResult = await dbQuery(
      `SELECT id, email, first_name, telegram_id FROM users WHERE id = $1;`,
      [userId]
    );
    const user = userResult.rows[0];

    return NextResponse.json({
      ok: true,
      isNew,
      sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.first_name || username || 'User',
        telegramId: user.telegram_id,
      },
    });
  } catch (error: any) {
    console.error('Telegram login error:', error);
    if (error?.code === 'ERR_JWT_EXPIRED') {
      return NextResponse.json({ error: 'Token expired' }, { status: 403 });
    }
    if (error?.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      return NextResponse.json({ error: 'Invalid token signature' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
