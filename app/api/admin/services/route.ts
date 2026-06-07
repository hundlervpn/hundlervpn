import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

const ADMIN_TELEGRAM_IDS = [2029065770, 1483598839];

function isAdmin(telegramId: number | string) {
  return ADMIN_TELEGRAM_IDS.includes(Number(telegramId));
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const telegramId = searchParams.get('telegramId');
    if (!telegramId || !isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pool = getDbPool();
    const result = await pool.query(
      `SELECT sr.*,
        u.telegram_id, u.username, u.first_name, u.last_name,
        (SELECT COUNT(*) FROM service_request_messages WHERE request_id = sr.id) as message_count
       FROM service_requests sr
       JOIN users u ON u.id = sr.user_id
       ORDER BY
         CASE sr.status
           WHEN 'paid' THEN 0
           WHEN 'new' THEN 1
           WHEN 'awaiting_payment' THEN 2
           WHEN 'processing' THEN 3
           WHEN 'completed' THEN 4
           WHEN 'cancelled' THEN 5
         END,
         sr.updated_at DESC`
    );

    return NextResponse.json({ requests: result.rows });
  } catch (error) {
    console.error('Admin services list error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, requestId, action, message, amount } = body;
    if (!telegramId || !isAdmin(telegramId) || !requestId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pool = getDbPool();

    if (action === 'reply' && message?.trim()) {
      await pool.query(
        `INSERT INTO service_request_messages (request_id, sender_type, message) VALUES ($1, 'admin', $2)`,
        [requestId, message.trim()]
      );
      await pool.query('UPDATE service_requests SET updated_at = NOW() WHERE id = $1', [requestId]);
      return NextResponse.json({ ok: true });
    }

    if (action === 'set_amount' && amount) {
      await pool.query(
        `UPDATE service_requests SET amount = $1, status = 'awaiting_payment' WHERE id = $2`,
        [Number(amount), requestId]
      );
      await pool.query(
        `INSERT INTO service_request_messages (request_id, sender_type, message)
         VALUES ($1, 'admin', $2)`,
        [requestId, `Стоимость услуги: ${Number(amount)} ₽. Нажмите кнопку "Оплатить" для продолжения.`]
      );
      return NextResponse.json({ ok: true });
    }

    if (action === 'set_status') {
      const newStatus = body.status;
      const validStatuses = ['new', 'awaiting_payment', 'paid', 'processing', 'completed', 'cancelled'];
      if (!validStatuses.includes(newStatus)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      await pool.query('UPDATE service_requests SET status = $1 WHERE id = $2', [newStatus, requestId]);

      const statusMessages: Record<string, string> = {
        processing: 'Заявка принята в обработку.',
        completed: 'Услуга выполнена. Спасибо!',
        cancelled: 'Заявка отменена.',
      };
      if (statusMessages[newStatus]) {
        await pool.query(
          `INSERT INTO service_request_messages (request_id, sender_type, message) VALUES ($1, 'admin', $2)`,
          [requestId, statusMessages[newStatus]]
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'messages') {
      const messages = await pool.query(
        'SELECT * FROM service_request_messages WHERE request_id = $1 ORDER BY created_at ASC',
        [requestId]
      );
      return NextResponse.json({ messages: messages.rows });
    }

    if (action === 'delete') {
      await pool.query('DELETE FROM service_requests WHERE id = $1', [requestId]);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Admin services action error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
