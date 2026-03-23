import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { getSubscriptionUrl } from '@/lib/sub-token';
import {
  deactivateExpiredAccess,
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

    const pool = getDbPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const inviterResult = referralCode
        ? await client.query<{ id: number }>(
            'SELECT id FROM users WHERE referral_code = $1 LIMIT 1;',
            [referralCode]
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
