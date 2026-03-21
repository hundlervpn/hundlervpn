import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

type SyncBody = {
  telegramId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  startParam?: string;
};

function buildVlessLink(uuid: string) {
  const host = process.env.XRAY_VLESS_HOST;
  const port = process.env.XRAY_VLESS_PORT ?? '443';
  const publicKey = process.env.XRAY_REALITY_PUBLIC_KEY;
  const serverName = process.env.XRAY_REALITY_SNI;
  const shortId = process.env.XRAY_REALITY_SHORT_ID;
  const fingerprint = process.env.XRAY_REALITY_FINGERPRINT ?? 'chrome';
  const flow = process.env.XRAY_VLESS_FLOW ?? 'xtls-rprx-vision';
  const remark = process.env.XRAY_VLESS_REMARK ?? 'HundlerVPN';

  if (!host || !publicKey || !serverName || !shortId) {
    return null;
  }

  const query = new URLSearchParams({
    encryption: 'none',
    security: 'reality',
    type: 'tcp',
    sni: serverName,
    fp: fingerprint,
    pbk: publicKey,
    sid: shortId,
    flow,
  });

  return `vless://${uuid}@${host}:${port}?${query.toString()}#${encodeURIComponent(remark)}`;
}

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

      const result = await client.query<{ id: number; inserted: boolean; referral_code: string | null; referred_by_user_id: number | null }>(
        `
        INSERT INTO users (
          telegram_id,
          username,
          first_name,
          last_name,
          photo_url,
          status,
          is_banned,
          auto_renew,
          last_seen_at,
          referral_code,
          referred_by_user_id
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'active',
          false,
          false,
          NOW(),
          $6,
          CASE WHEN $7 IS NOT NULL THEN $7 ELSE NULL END
        )
        ON CONFLICT (telegram_id)
        DO UPDATE SET
          username = COALESCE(EXCLUDED.username, users.username),
          first_name = COALESCE(EXCLUDED.first_name, users.first_name),
          last_name = COALESCE(EXCLUDED.last_name, users.last_name),
          photo_url = COALESCE(EXCLUDED.photo_url, users.photo_url),
          last_seen_at = NOW(),
          referral_code = COALESCE(users.referral_code, EXCLUDED.referral_code),
          updated_at = NOW()
        RETURNING id, (xmax = 0) AS inserted, referral_code, referred_by_user_id;
        `,
        [telegramId, username, firstName, lastName, photoUrl, ownReferralCode, inviterId]
      );

      const row = result.rows[0];
      const userId = row?.id ?? null;

      if (!userId) {
        throw new Error('Failed to sync user');
      }

      if (row.inserted) {
        const trialPlanName = 'Free Trial 3d';
        await client.query(
          `
          INSERT INTO plans (name, duration_days, price, max_devices, traffic_limit, is_active)
          VALUES ($1, 3, 0, 1, NULL, TRUE)
          ON CONFLICT DO NOTHING;
          `,
          [trialPlanName]
        );

        const planResult = await client.query<{ id: number }>(
          'SELECT id FROM plans WHERE name = $1 ORDER BY id DESC LIMIT 1;',
          [trialPlanName]
        );
        const trialPlanId = planResult.rows[0]?.id;

        if (trialPlanId) {
          const trialSub = await client.query<{ id: number; end_date: Date }>(
            `
            INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status)
            VALUES ($1, $2, NOW(), NOW() + INTERVAL '3 days', 'active')
            RETURNING id, end_date;
            `,
            [userId, trialPlanId]
          );

          const subId = trialSub.rows[0]?.id;
          const endDate = trialSub.rows[0]?.end_date;
          if (subId && endDate) {
            const clientUuid = randomUUID();
            const vlessKey = buildVlessLink(clientUuid);

            await client.query(
              `
              INSERT INTO vpn_keys (user_id, subscription_id, server_id, key_uri, key_hash, device_name, created_at, expires_at, is_active)
              VALUES ($1, $2, NULL, $3, $4, $5, NOW(), $6, TRUE);
              `,
              [
                userId,
                subId,
                vlessKey ?? `pending://xray-config-required/${clientUuid}`,
                clientUuid,
                'Free Trial Device',
                endDate,
              ]
            );
          }
        }
      }

      await client.query(
        `
        UPDATE vpn_keys
        SET is_active = FALSE
        WHERE user_id = $1
          AND expires_at IS NOT NULL
          AND expires_at <= NOW();
        `,
        [userId]
      );

      await client.query('COMMIT');

      return NextResponse.json({ ok: true, userId, referralCode: row.referral_code ?? ownReferralCode });
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
