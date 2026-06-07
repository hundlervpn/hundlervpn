import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const telegramId = searchParams.get('telegramId');
    if (!telegramId) return NextResponse.json({ error: 'Missing telegramId' }, { status: 400 });

    const pool = getDbPool();
    const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1 LIMIT 1', [telegramId]);
    const user = userRes.rows[0];
    if (!user) return NextResponse.json({ requests: [] });

    const result = await pool.query(
      `SELECT sr.*, 
        (SELECT COUNT(*) FROM service_request_messages WHERE request_id = sr.id) as message_count
       FROM service_requests sr
       WHERE sr.user_id = $1
       ORDER BY sr.updated_at DESC`,
      [user.id]
    );

    return NextResponse.json({ requests: result.rows });
  } catch (error) {
    console.error('Services list error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, serviceName, description } = body;
    if (!telegramId || !serviceName?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const pool = getDbPool();
    const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1 LIMIT 1', [telegramId]);
    const user = userRes.rows[0];
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const result = await pool.query(
      `INSERT INTO service_requests (user_id, service_name, description)
       VALUES ($1, $2, $3) RETURNING id`,
      [user.id, serviceName.trim(), description?.trim() || null]
    );

    const requestId = result.rows[0].id;

    if (description?.trim()) {
      await pool.query(
        `INSERT INTO service_request_messages (request_id, sender_type, message)
         VALUES ($1, 'user', $2)`,
        [requestId, description.trim()]
      );
    }

    return NextResponse.json({ ok: true, requestId });
  } catch (error) {
    console.error('Service request create error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
