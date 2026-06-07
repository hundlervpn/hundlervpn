import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { getSubscriptionUrl } from '@/lib/sub-token';
import {
  deactivateExpiredAccess,
  grantReferralSignupBonus,
  issueTrialAccess,
  upsertTelegramUser,
  userNeedsInitialTrial,
} from '@/lib/access';

type SyncBody = {
  telegramId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  startParam?: string;
};

function parseReferralCode(startParam?: string | null) {
  const raw = (startParam ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('ref_')) {
    const code = raw.slice(4).trim();
    return code || null;
  }
  return null;
}

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
    const referralCode = parseReferralCode(body.startParam);
    const ownReferralCode = `u${telegramId.toString(36)}`;

    // Guard against self-referral at the source. Without this, a user who
    // taps their OWN ?startapp=ref_<own_code> link (e.g. by testing it on
    // their own account or having it bounce back via TG share) ends up with
    // `users.referred_by_user_id = users.id` — a self-loop that pollutes
    // their referral list (they see themselves as their own invitee in the
    // modal because /api/users/referrals queries `WHERE referred_by_user_id
    // = $callerId` without an `<> $callerId` filter). The bonus grant logic
    // already skips self-pairs (see line ~101 below), but the column write
    // happens BEFORE that check via upsertTelegramUser. Easiest fix is to
    // null-out the referral code when it matches the user's own canonical
    // code, BEFORE the inviter SELECT runs.
    // Incident: user 1388 (fallensai) reported 2026-05-09.
    const effectiveReferralCode = referralCode === ownReferralCode ? null : referralCode;

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const inviterResult = effectiveReferralCode
        ? await client.query<{ id: number }>(
            'SELECT id FROM users WHERE referral_code = $1 LIMIT 1;',
            [effectiveReferralCode]
          )
        : { rows: [] as { id: number }[] };
      const inviterId = inviterResult.rows[0]?.id ?? null;

      const syncedUser = await upsertTelegramUser(client, {
        telegramId,
        username,
        firstName,
        lastName,
        photoUrl,
        referralCode: ownReferralCode,
        referredByUserId: inviterId,
      });

      const userId = syncedUser.userId;

      if (!userId) {
        throw new Error('Failed to sync user');
      }

      const shouldCreateTrial = syncedUser.inserted || await userNeedsInitialTrial(client, userId);
      if (shouldCreateTrial) {
        await issueTrialAccess(client, userId, telegramId);
      }

      // Referral SIGNUP bonus: credit the inviter +5 days the moment a
      // brand-new user lands via their link. Originally gated on
      // `syncedUser.inserted`, which silently dropped the bonus for
      // every user who'd already been upserted by the chat bot's old
      // direct `db.get_or_create_user` path — those rows existed in DB
      // but had never received their trial AND had `referred_by_user_id`
      // = NULL. Incident 2026-05-07: «где мои 5 дней на тот аккаунт с
      // которого я приглашал этого пользователя».
      //
      // Post-fix the gate fires on `shouldCreateTrial` instead — a
      // strictly broader condition that also catches "user exists, has
      // no sub/payment/key, and is NOW arriving with an inviter for
      // the first time". The DB UNIQUE constraint
      // (inviter_id, invitee_id, bonus_type='signup') in
      // referral_bonus_transactions guarantees we never grant the same
      // pair twice, even across multiple /start ref_X bounces.
      // Self-referrals are still skipped explicitly. Wrapped in a
      // SAVEPOINT so a bonus failure (e.g. inviter already deleted)
      // doesn't roll back the new user's own signup + trial.
      if (shouldCreateTrial && inviterId && inviterId !== userId) {
        await client.query('SAVEPOINT referral_signup_bonus');
        try {
          await grantReferralSignupBonus(client, inviterId, userId);
          await client.query('RELEASE SAVEPOINT referral_signup_bonus');
        } catch (bonusErr) {
          await client.query('ROLLBACK TO SAVEPOINT referral_signup_bonus');
          console.error('[users/sync] referral signup bonus failed:', bonusErr);
        }
      }

      await deactivateExpiredAccess(client, userId);

      await client.query('COMMIT');

      const subUrl = getSubscriptionUrl(telegramId);
      return NextResponse.json({ ok: true, userId, referralCode: syncedUser.referralCode ?? ownReferralCode, subscriptionUrl: subUrl });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('User sync error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
