import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

type SyncBody = {
  telegramId?: number;
  username?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SyncBody;
    const telegramId = body.telegramId;

    if (!telegramId || !Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }

    const username = body.username?.trim() || null;

    const result = await dbQuery<{ id: number }>(
      `
      INSERT INTO users (telegram_id, username, status, is_banned, auto_renew)
      VALUES ($1, $2, 'active', false, false)
      ON CONFLICT (telegram_id)
      DO UPDATE SET
        username = COALESCE(EXCLUDED.username, users.username),
        updated_at = NOW()
      RETURNING id;
      `,
      [telegramId, username]
    );

    return NextResponse.json({ ok: true, userId: result.rows[0]?.id ?? null });
  } catch (error) {
    console.error('User sync error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
