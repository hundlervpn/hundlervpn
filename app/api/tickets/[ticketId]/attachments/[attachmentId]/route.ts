import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

// GET /api/tickets/[ticketId]/attachments/[attachmentId]?telegramId=...|userId=...
//
// Streams a support-ticket image back to its owner. Ownership is enforced in
// the SQL JOIN: the attachment must belong to a ticket owned by the
// identified user, otherwise 404 (don't leak existence).

export const runtime = 'nodejs';

type IdentityResolution =
  | { ok: true; field: 'telegram_id' | 'id'; value: number }
  | { ok: false; error: string };

function hasValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function resolveIdentity(telegramIdRaw: unknown, userIdRaw: unknown): IdentityResolution {
  const hasTelegramId = hasValue(telegramIdRaw);
  const hasUserId = hasValue(userIdRaw);

  if (!hasTelegramId && !hasUserId) {
    return { ok: false, error: 'telegramId or userId is required' };
  }

  if (hasTelegramId) {
    const telegramId = Number(telegramIdRaw);
    if (!Number.isFinite(telegramId)) return { ok: false, error: 'Invalid telegramId' };
    return { ok: true, field: 'telegram_id', value: telegramId };
  }

  const userId = Number(userIdRaw);
  if (!Number.isFinite(userId)) return { ok: false, error: 'Invalid userId' };
  return { ok: true, field: 'id', value: userId };
}

function parsePositiveNumber(raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return null;
  return value;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticketId: string; attachmentId: string }> }
) {
  try {
    const { ticketId: ticketIdRaw, attachmentId: attachmentIdRaw } = await params;
    const ticketId = parsePositiveNumber(ticketIdRaw);
    const attachmentId = parsePositiveNumber(attachmentIdRaw);

    if (!ticketId || !attachmentId) {
      return NextResponse.json({ error: 'Invalid ticketId or attachmentId' }, { status: 400 });
    }

    const url = new URL(req.url);
    const identity = resolveIdentity(url.searchParams.get('telegramId'), url.searchParams.get('userId'));
    if (!identity.ok) {
      return NextResponse.json({ error: identity.error }, { status: 400 });
    }

    const result = await dbQuery<{ mime_type: string; file_name: string | null; data: Buffer }>(
      `
      SELECT sta.mime_type, sta.file_name, sta.data
      FROM support_ticket_attachments sta
      JOIN support_tickets st ON st.id = sta.ticket_id
      JOIN users u ON u.id = st.user_id
      WHERE sta.id = $1
        AND sta.ticket_id = $2
        AND u.${identity.field} = $3
      LIMIT 1;
      `,
      [attachmentId, ticketId, identity.value]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const row = result.rows[0];
    const body = new Uint8Array(row.data);

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': row.mime_type,
        'Content-Length': String(body.byteLength),
        // Private + immutable: image bytes never change for a given id.
        'Cache-Control': 'private, max-age=86400, immutable',
        'Content-Disposition': `inline${row.file_name ? `; filename="${encodeURIComponent(row.file_name)}"` : ''}`,
      },
    });
  } catch (error) {
    console.error('Ticket attachment fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
