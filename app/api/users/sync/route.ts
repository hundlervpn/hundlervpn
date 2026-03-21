import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

type SyncBody = {
  telegramId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SyncBody;
    const telegramId = body.telegramId;

    if (!telegramId || !Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }

    const username = body.username?.trim() || null;
    const firstName = body.firstName?.trim() || null;
    const lastName = body.lastName?.trim() || null;
    const photoUrl = body.photoUrl?.trim() || null;

    const result = await dbQuery<{ id: number }>(
      `
      INSERT INTO users (telegram_id, username, first_name, last_name, photo_url, status, is_banned, auto_renew, last_seen_at)
      VALUES ($1, $2, $3, $4, $5, 'active', false, false, NOW())
      ON CONFLICT (telegram_id)
      DO UPDATE SET
        username = COALESCE(EXCLUDED.username, users.username),
        first_name = COALESCE(EXCLUDED.first_name, users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, users.last_name),
        photo_url = COALESCE(EXCLUDED.photo_url, users.photo_url),
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING id;
      `,
      [telegramId, username, firstName, lastName, photoUrl]
    );

    return NextResponse.json({ ok: true, userId: result.rows[0]?.id ?? null });
  } catch (error) {
    console.error('User sync error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
