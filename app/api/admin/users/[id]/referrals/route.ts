import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import { isReferralPartner, referralCashPercentForInviter } from '@/lib/referral-cash';

/**
 * Admin-only: list everyone a given user invited, plus that inviter's
 * referral KPIs. Powers the "кого пригласил" expander on the admin user
 * card (used mainly for managed partners, but works for any inviter).
 *
 * GET /api/admin/users/<id>/referrals?telegramId=<admin_tg_id>
 *
 * Response:
 *   - inviter: { id, referral_code, balance_rub, is_partner, cash_percent,
 *                invitee_count, total_cash_earned_rub }
 *   - invitees[]: per referred-user row with how much they paid and how much
 *                 cash they generated for the inviter.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type InviteeRow = {
  id: string;
  telegram_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  auth_type: string | null;
  created_at: string;
  last_seen_at: string | null;
  total_paid_rub: string;
  cash_generated_rub: string;
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(req.url);
    const adminTgId = url.searchParams.get('telegramId');
    if (!isAdmin(adminTgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const inviterId = Number(id);
    if (!Number.isFinite(inviterId)) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }

    // Inviter identity + balance.
    const inviterResult = await dbQuery<{
      id: string;
      referral_code: string | null;
      referral_balance_rub: string;
    }>(
      `SELECT id::text AS id,
              referral_code,
              COALESCE(referral_balance_rub, 0)::text AS referral_balance_rub
       FROM users WHERE id = $1;`,
      [inviterId]
    );
    if (inviterResult.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const inviter = inviterResult.rows[0];

    // Invitees + their paid total + the cash they generated for THIS inviter.
    // Self-loops filtered defensively (matches the main referrals endpoint).
    const inviteesResult = await dbQuery<InviteeRow>(
      `
      SELECT
        inv.id::text                                  AS id,
        inv.telegram_id::text                         AS telegram_id,
        inv.username,
        inv.first_name,
        inv.last_name,
        inv.email,
        inv.auth_type,
        inv.created_at::text                          AS created_at,
        inv.last_seen_at::text                        AS last_seen_at,
        COALESCE((
          SELECT SUM(p.amount) FILTER (WHERE p.status = 'paid')
          FROM payments p WHERE p.user_id = inv.id
        ), 0)::text                                   AS total_paid_rub,
        COALESCE((
          SELECT SUM(rbt.amount_rub)
          FROM referral_balance_transactions rbt
          WHERE rbt.inviter_user_id = $1 AND rbt.invitee_user_id = inv.id
        ), 0)::text                                   AS cash_generated_rub
      FROM users inv
      WHERE inv.referred_by_user_id = $1
        AND inv.id <> $1
      ORDER BY inv.created_at DESC;
      `,
      [inviterId]
    );

    const totalCashEarned = await dbQuery<{ total: string }>(
      `SELECT COALESCE(SUM(amount_rub), 0)::text AS total
       FROM referral_balance_transactions WHERE inviter_user_id = $1;`,
      [inviterId]
    );

    const partner = isReferralPartner(inviterId);

    return NextResponse.json({
      ok: true,
      inviter: {
        id: inviter.id,
        referral_code: inviter.referral_code,
        balance_rub: inviter.referral_balance_rub,
        is_partner: partner,
        cash_percent: partner ? referralCashPercentForInviter(inviterId) : 10,
        invitee_count: inviteesResult.rows.length,
        total_cash_earned_rub: totalCashEarned.rows[0]?.total ?? '0',
      },
      invitees: inviteesResult.rows,
    });
  } catch (error) {
    console.error('Admin user referrals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
