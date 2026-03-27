import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { banUserAccess, banUserSubscription, reactivatePaidAccessIfEligible } from '@/lib/access';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, targetUserId, ban, reason, banType } = body as {
      telegramId?: number | string;
      targetUserId?: number | string;
      ban?: boolean;
      reason?: string;
      banType?: 'login' | 'subscription';
    };
    const normalizedTargetUserId = typeof targetUserId === 'string' ? Number(targetUserId) : targetUserId;

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!normalizedTargetUserId || !Number.isFinite(normalizedTargetUserId)) {
      return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 });
    }

    const shouldBan = ban !== false;
    const effectiveBanType = shouldBan ? (banType || 'login') : null;

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
        [normalizedTargetUserId]
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
            ban_type = $4,
            status = CASE WHEN $2 THEN 'banned' ELSE 'active' END,
            updated_at = NOW()
        WHERE id = $1;
        `,
        [
          normalizedTargetUserId,
          shouldBan,
          shouldBan ? (reason?.trim() || 'Banned by admin') : null,
          effectiveBanType,
        ]
      );

      let restored = null;

      if (shouldBan) {
        if (effectiveBanType === 'subscription') {
          await banUserSubscription(client, normalizedTargetUserId);
        } else {
          await banUserAccess(client, normalizedTargetUserId);
        }
      } else {
        restored = await reactivatePaidAccessIfEligible(client, normalizedTargetUserId);
      }

      await client.query('COMMIT');

      return NextResponse.json({
        ok: true,
        banned: shouldBan,
        banType: effectiveBanType,
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
