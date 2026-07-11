import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { syncRemnawaveUser } from '@/lib/remnawave-sync';
import {
  activateSubscriptionForDays,
  deactivateExpiredAccess,
  ensureNamedPlan,
  ensureVpnKey,
} from '@/lib/access';

export const dynamic = 'force-dynamic';

/**
 * Admin-only: manually add (or remove) subscription days for a target user.
 *
 *   POST /api/admin/users/[id]/grant-days
 *   body: { telegramId: <admin tg id>, days: <int>, reason?: string }
 *
 * `days > 0` extends the user's newest subscription in place (or creates a
 * fresh `days`-long one if they have no active sub) — exactly the same path a
 * paid crypto renewal takes, so all the downstream side effects (vpn_key
 * reactivation, uuid-pool re-point, xray sync, reminder reset) fire for free.
 * `days < 0` shortens an active subscription (min end_date = NOW, i.e. it can
 * expire the user but never pushes end_date into the past). `days == 0` is a
 * no-op error.
 *
 * We create/reuse a dedicated "Admin Grant" plan (price 0) so these manual
 * grants are distinguishable from paid plans in the `plans` table and never
 * pollute revenue math. Remnawave is reconciled post-COMMIT (best effort) so
 * the VPN panel picks up the new expiry.
 */

type Body = { telegramId?: number | string; days?: number | string; reason?: string };

const MAX_DAYS = 3650; // 10 years — sane upper bound to stop fat-finger grants.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const adminTgId = body.telegramId;
    if (!isAdmin(adminTgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const userId = Number(id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }

    const days = Math.trunc(Number(body.days));
    if (!Number.isFinite(days) || days === 0) {
      return NextResponse.json({ error: 'days must be a non-zero integer' }, { status: 400 });
    }
    if (Math.abs(days) > MAX_DAYS) {
      return NextResponse.json({ error: `days must be within \u00b1${MAX_DAYS}` }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const userResult = await client.query<{ id: number }>(
        `SELECT id FROM users WHERE id = $1 LIMIT 1 FOR UPDATE;`,
        [userId],
      );
      if (!userResult.rows[0]?.id) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Sweep expired access first so a lapsed user gets a clean, fresh
      // subscription rather than an extension of an already-expired row.
      // Mirrors the payment callbacks.
      await deactivateExpiredAccess(client, userId);

      if (days > 0) {
        // Reuse a single dedicated admin plan (price 0) for all manual grants.
        const planId = await ensureNamedPlan(client, {
          name: 'Admin Grant',
          durationDays: days,
          price: 0,
          maxDevices: 3,
          trafficLimit: null,
        });
        if (!planId) {
          throw new Error('Failed to resolve admin grant plan');
        }

        const active = await activateSubscriptionForDays(client, {
          userId,
          planId,
          days,
        });

        if (!active.subscriptionId || !active.endDate) {
          throw new Error('Active subscription not found after grant');
        }

        await ensureVpnKey(client, {
          userId,
          subscriptionId: active.subscriptionId,
          expiresAt: active.endDate,
          deviceName: 'Admin Grant',
        });

        await client.query('COMMIT');

        // Reconcile Remnawave with the freshly-extended subscription
        // (best-effort, post-COMMIT — must not fail an already-granted extension).
        await syncRemnawaveUser(userId, 'admin-grant-days');

        return NextResponse.json({
          ok: true,
          days,
          extendedExisting: active.extendedExisting,
          subscriptionId: active.subscriptionId,
          endDate: active.endDate,
        });
      }

      // days < 0 — shorten the newest active subscription. Clamp end_date so
      // it never goes below NOW() (the worst case is "expire the user now",
      // which desiredStatus() then maps to DISABLED in Remnawave).
      const shortened = await client.query<{ id: number; end_date: string; status: string }>(
        `
        UPDATE subscriptions
        SET end_date = GREATEST(NOW(), end_date + ($2::int * INTERVAL '1 day')),
            updated_at = NOW()
        WHERE id = (
          SELECT id FROM subscriptions
          WHERE user_id = $1 AND status = 'active' AND end_date IS NOT NULL
          ORDER BY end_date DESC NULLS LAST
          LIMIT 1
          FOR UPDATE
        )
        RETURNING id, end_date, status;
        `,
        [userId, days],
      );

      if (!shortened.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'No active subscription to shorten' }, { status: 400 });
      }

      // Reset reminders so the expiring-soon cron re-evaluates against the new date.
      await client.query(
        `DELETE FROM subscription_reminders WHERE subscription_id = $1`,
        [shortened.rows[0].id],
      );

      // If we clamped the sub to NOW() this expires the user — sweep + rotate
      // uuid pool (fires xray sync internally) inside the same transaction.
      await deactivateExpiredAccess(client, userId);

      await client.query('COMMIT');

      await syncRemnawaveUser(userId, 'admin-remove-days');

      return NextResponse.json({
        ok: true,
        days,
        extendedExisting: true,
        subscriptionId: shortened.rows[0].id,
        endDate: shortened.rows[0].end_date,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[admin grant-days] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
