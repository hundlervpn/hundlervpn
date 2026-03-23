import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { banUserAccess, reactivatePaidAccessIfEligible } from '@/lib/access';

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

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const userResult = await client.query<{ id: number }>(
        `
        SELECT id
        FROM users
        WHERE id = $1
        LIMIT 1
        FOR UPDATE;
        `,
        [targetUserId]
      );

      if (!userResult.rows[0]?.id) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      await client.query(
        `
        UPDATE users
        SET is_banned = $2,
            ban_reason = $3,
            status = CASE WHEN $2 THEN 'banned' ELSE 'active' END,
            updated_at = NOW()
        WHERE id = $1;
        `,
        [targetUserId, shouldBan, shouldBan ? (reason?.trim() || 'Banned by admin') : null]
      );

      let restored = null;

      if (shouldBan) {
        await banUserAccess(client, targetUserId);
      } else {
        restored = await reactivatePaidAccessIfEligible(client, targetUserId);
      }

      await client.query('COMMIT');

      return NextResponse.json({
        ok: true,
        banned: shouldBan,
        restored: Boolean(restored),
        restoredUntil: restored?.endDate ?? null,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Admin ban error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
