import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { randomUUID } from 'crypto';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = (body.email || '').trim().toLowerCase();
    const code = (body.code || '').trim();

    if (!email || !code) {
      return NextResponse.json({ error: 'Email и код обязательны' }, { status: 400 });
    }

    // Find valid code
    const codeRow = await dbQuery(
      `SELECT id, attempts FROM email_codes
       WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1;`,
      [email, code]
    );

    if (codeRow.rows.length === 0) {
      // Increment attempts on latest unused code for this email
      await dbQuery(
        `UPDATE email_codes SET attempts = attempts + 1
         WHERE email = $1 AND used = FALSE AND expires_at > NOW();`,
        [email]
      );
      return NextResponse.json({ error: 'Неверный или истёкший код' }, { status: 400 });
    }

    const row = codeRow.rows[0];
    if (row.attempts >= 5) {
      return NextResponse.json({ error: 'Слишком много попыток. Запросите новый код.' }, { status: 429 });
    }

    // Mark code as used
    await dbQuery(`UPDATE email_codes SET used = TRUE WHERE id = $1;`, [row.id]);

    // Find or create user by email
    let userResult = await dbQuery(
      `SELECT id, email, telegram_id, first_name FROM users WHERE email = $1 LIMIT 1;`,
      [email]
    );

    let userId: number;
    let isNew = false;

    if (userResult.rows.length === 0) {
      // Create new user
      const referralCode = `e${Date.now().toString(36)}`;
      const insertResult = await dbQuery(
        `INSERT INTO users (email, email_verified, referral_code, first_name)
         VALUES ($1, TRUE, $2, $3)
         RETURNING id;`,
        [email, referralCode, email.split('@')[0]]
      );
      userId = insertResult.rows[0].id;
      isNew = true;
    } else {
      userId = userResult.rows[0].id;
      // Update email_verified if not already
      await dbQuery(
        `UPDATE users SET email_verified = TRUE WHERE id = $1 AND email_verified = FALSE;`,
        [userId]
      );
    }

    // Generate session token
    const sessionToken = randomUUID();

    await dbQuery(
      `INSERT INTO email_sessions (user_id, token) VALUES ($1, $2);`,
      [userId, sessionToken]
    );

    // Get full user profile
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
        name: user.first_name || email.split('@')[0],
        telegramId: user.telegram_id,
      },
    });
  } catch (error) {
    console.error('Verify code error:', error);
    return NextResponse.json({ error: 'Ошибка верификации' }, { status: 500 });
  }
}
