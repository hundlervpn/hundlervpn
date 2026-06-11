import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

// GET /api/broadcasts/[id]/image
//
// Streams an uploaded broadcast image (stored as BYTEA in `broadcasts`).
//
// This route is intentionally PUBLIC (no telegramId/auth): the bot sends the
// broadcast photo via Telegram's sendPhoto with URLInputFile(image_url), and
// Telegram's servers fetch the image from this URL. They can't pass an admin
// token, so the endpoint must be reachable anonymously. The only thing it
// exposes is the marketing image an admin chose to blast to all users — not
// sensitive. We still scope strictly to one broadcast id and only return the
// bytes if image_data is present.

export const runtime = 'nodejs';

function parsePositiveNumber(raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return null;
  return value;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idRaw } = await params;
    const id = parsePositiveNumber(idRaw);
    if (!id) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const result = await dbQuery<{ image_mime: string | null; image_data: Buffer | null }>(
      `SELECT image_mime, image_data
         FROM broadcasts
        WHERE id = $1
        LIMIT 1`,
      [id]
    );

    const row = result.rows[0];
    if (!row || !row.image_data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = new Uint8Array(row.image_data);

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': row.image_mime || 'application/octet-stream',
        'Content-Length': String(body.byteLength),
        // Image bytes never change for a given broadcast id, so cache hard.
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': 'inline',
      },
    });
  } catch (error) {
    console.error('Broadcast image fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
