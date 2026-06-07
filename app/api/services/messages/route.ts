import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const telegramId = searchParams.get('telegramId');
    const requestId = searchParams.get('requestId');
    if (!telegramId || !requestId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

    const pool = getDbPool();
    const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1 LIMIT 1', [telegramId]);
    const user = userRes.rows[0];
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const reqRes = await pool.query(
      'SELECT * FROM service_requests WHERE id = $1 AND user_id = $2 LIMIT 1',
      [requestId, user.id]
    );
    if (reqRes.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const messages = await pool.query(
      'SELECT * FROM service_request_messages WHERE request_id = $1 ORDER BY created_at ASC',
      [requestId]
    );

    return NextResponse.json({ request: reqRes.rows[0], messages: messages.rows });
  } catch (error) {
    console.error('Service messages error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, requestId, message } = body;
    if (!telegramId || !requestId || !message?.trim()) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const pool = getDbPool();
    const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1 LIMIT 1', [telegramId]);
    const user = userRes.rows[0];
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const reqRes = await pool.query(
      'SELECT id, status FROM service_requests WHERE id = $1 AND user_id = $2 LIMIT 1',
      [requestId, user.id]
    );
    if (reqRes.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await pool.query(
      `INSERT INTO service_request_messages (request_id, sender_type, message)
       VALUES ($1, 'user', $2)`,
      [requestId, message.trim()]
    );

    await pool.query('UPDATE service_requests SET updated_at = NOW() WHERE id = $1', [requestId]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Service message send error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
