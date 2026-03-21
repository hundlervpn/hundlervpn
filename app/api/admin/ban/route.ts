import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, targetUserId, ban, reason } = body as {
      telegramId?: number;
      targetUserId?: number;
      ban?: boolean;
      reason?: string;
    };

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!targetUserId || !Number.isFinite(targetUserId)) {
      return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 });
    }

    const shouldBan = ban !== false;

    await dbQuery(
      `
      UPDATE users
      SET is_banned = $2,
          ban_reason = $3,
          status = CASE WHEN $2 THEN 'banned' ELSE 'active' END
      WHERE id = $1;
      `,
      [targetUserId, shouldBan, shouldBan ? (reason?.trim() || 'Banned by admin') : null]
    );

    if (shouldBan) {
      await dbQuery(
        `UPDATE vpn_keys SET is_active = FALSE WHERE user_id = $1;`,
        [targetUserId]
      );
    }

    return NextResponse.json({ ok: true, banned: shouldBan });
  } catch (error) {
    console.error('Admin ban error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
