import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 400 });
    }

    const result = await dbQuery(
      `SELECT u.id, u.email, u.first_name, u.telegram_id
       FROM email_sessions es
       JOIN users u ON u.id = es.user_id
       WHERE es.token = $1 AND es.expires_at > NOW()
       LIMIT 1;`,
      [token]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const user = result.rows[0];
    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.first_name || (user.email ? user.email.split('@')[0] : 'User'),
        telegramId: user.telegram_id,
      },
    });
  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
