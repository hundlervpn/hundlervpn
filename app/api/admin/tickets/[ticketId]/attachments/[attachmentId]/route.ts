import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

// GET /api/admin/tickets/[ticketId]/attachments/[attachmentId]?telegramId=<admin>
//
// Streams a support-ticket image to an authenticated admin. Admin can read
// any ticket's attachments, so we only check isAdmin + that the attachment
// belongs to the given ticket.

export const runtime = 'nodejs';

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
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await dbQuery<{ mime_type: string; file_name: string | null; data: Buffer }>(
      `
      SELECT mime_type, file_name, data
      FROM support_ticket_attachments
      WHERE id = $1 AND ticket_id = $2
      LIMIT 1;
      `,
      [attachmentId, ticketId]
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
        'Cache-Control': 'private, max-age=86400, immutable',
        'Content-Disposition': `inline${row.file_name ? `; filename="${encodeURIComponent(row.file_name)}"` : ''}`,
      },
    });
  } catch (error) {
    console.error('Admin ticket attachment fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
