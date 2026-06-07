import { NextResponse } from 'next/server';
import { getDbPool, dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

// POST /api/admin/tickets/start
// Body: {
//   telegramId: <admin tg id>,                      // auth
//   target: { telegramId? | userId? | username? },  // recipient
//   subject?: string,
//   message: string,
// }
//
// Creates a new support ticket on behalf of the recipient and adds the first
// message as if it was sent by an admin. The recipient sees this as a fresh
// thread in their support tab and gets the red unread badge until they open
// it.

type Target = {
  telegramId?: number | string | null;
  userId?: number | string | null;
  username?: string | null;
};

type StartTicketBody = {
  telegramId?: number | string;
  target?: Target;
  subject?: string;
  message?: string;
};

type ResolvedUser = { id: number; telegram_id: string | null; username: string | null; first_name: string | null; last_name: string | null };

async function resolveTargetUser(target: Target): Promise<ResolvedUser | null> {
  if (target.telegramId !== undefined && target.telegramId !== null && String(target.telegramId).trim() !== '') {
    const tid = Number(target.telegramId);
    if (Number.isFinite(tid)) {
      const r = await dbQuery<ResolvedUser>(
        `SELECT id, telegram_id::text AS telegram_id, username, first_name, last_name
         FROM users WHERE telegram_id = $1 LIMIT 1;`,
        [tid],
      );
      if (r.rows[0]) return r.rows[0];
    }
  }

  if (target.userId !== undefined && target.userId !== null && String(target.userId).trim() !== '') {
    const uid = Number(target.userId);
    if (Number.isFinite(uid)) {
      const r = await dbQuery<ResolvedUser>(
        `SELECT id, telegram_id::text AS telegram_id, username, first_name, last_name
         FROM users WHERE id = $1 LIMIT 1;`,
        [uid],
      );
      if (r.rows[0]) return r.rows[0];
    }
  }

  if (typeof target.username === 'string' && target.username.trim() !== '') {
    const uname = target.username.trim().replace(/^@/, '');
    const r = await dbQuery<ResolvedUser>(
      `SELECT id, telegram_id::text AS telegram_id, username, first_name, last_name
       FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1;`,
      [uname],
    );
    if (r.rows[0]) return r.rows[0];
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StartTicketBody;

    if (!isAdmin(body.telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const subject = body.subject?.trim() ?? '';
    const message = body.message?.trim() ?? '';

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }
    if (subject.length > 120) {
      return NextResponse.json({ error: 'subject is too long' }, { status: 400 });
    }
    if (message.length > 4000) {
      return NextResponse.json({ error: 'message is too long' }, { status: 400 });
    }

    if (!body.target) {
      return NextResponse.json({ error: 'target is required' }, { status: 400 });
    }

    const recipient = await resolveTargetUser(body.target);
    if (!recipient) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Insert ticket. last_user_read_at = NULL so the recipient sees it as
      // unread (their state.unreadSupportCount > 0). last_admin_read_at =
      // NOW() because the admin just authored the message.
      const ticketResult = await client.query<{ id: string; subject: string | null; status: 'open' | 'closed'; created_at: string; updated_at: string }>(
        `
        INSERT INTO support_tickets (user_id, subject, last_admin_read_at)
        VALUES ($1, $2, NOW())
        RETURNING
          id::text AS id,
          subject,
          status,
          created_at,
          updated_at;
        `,
        [recipient.id, subject || null],
      );

      const ticket = ticketResult.rows[0];

      const messageResult = await client.query<{ id: string; sender_type: string; message: string; created_at: string }>(
        `
        INSERT INTO support_ticket_messages (ticket_id, sender_type, message)
        VALUES ($1, 'admin', $2)
        RETURNING id::text AS id, sender_type, message, created_at;
        `,
        [ticket.id, message],
      );

      await client.query(
        `UPDATE support_tickets SET updated_at = NOW() WHERE id = $1;`,
        [ticket.id],
      );

      await client.query('COMMIT');

      return NextResponse.json({
        ok: true,
        ticket: {
          ...ticket,
          last_message: message,
          last_message_at: messageResult.rows[0].created_at,
          messages_count: 1,
          recipient: {
            id: String(recipient.id),
            telegram_id: recipient.telegram_id,
            username: recipient.username,
            first_name: recipient.first_name,
            last_name: recipient.last_name,
          },
        },
        message: messageResult.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Admin ticket start error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
