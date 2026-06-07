import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { buildVlessLink, getSubscriptionUrl, getSubscriptionUrlForUser } from '@/lib/sub-token';
import { claimUuid } from '@/lib/uuid-pool';
import { triggerXraySync } from '@/lib/xray-webhook';

type UpsertTelegramUserInput = {
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
  referralCode?: string | null;
  referredByUserId?: number | null;
};

type SubscriptionRow = {
  id: number;
  end_date: Date;
  status: string;
};

type VpnKeyRow = {
  id: number;
  key_hash: string | null;
  device_name: string | null;
};

type PromoRow = {
  id: number;
  code: string;
  days: number;
  discount_percent: number | null;
  max_uses: number;
  used_count: number;
  expires_at: Date | null;
};

export async function upsertTelegramUser(client: PoolClient, input: UpsertTelegramUserInput) {
  const result = await client.query<{
    id: number;
    inserted: boolean;
    referral_code: string | null;
    referred_by_user_id: number | null;
  }>(
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
      referred_by_user_id,
      auth_type
    )
    VALUES (
      $1::bigint,
      $2,
      $3,
      $4,
      $5,
      'active',
      FALSE,
      FALSE,
      NOW(),
      $6,
      $7::bigint,
      'telegram'
    )
    ON CONFLICT (telegram_id)
    DO UPDATE SET
      username = COALESCE(EXCLUDED.username, users.username),
      first_name = COALESCE(EXCLUDED.first_name, users.first_name),
      last_name = COALESCE(EXCLUDED.last_name, users.last_name),
      photo_url = COALESCE(EXCLUDED.photo_url, users.photo_url),
      last_seen_at = NOW(),
      referral_code = COALESCE(users.referral_code, EXCLUDED.referral_code),
      -- Backfill the referrer when the existing row has NULL and the
      -- caller is now passing one. Necessary for the chat-bot retro
      -- case (incident 2026-05-07): users created via the old direct
      -- db.get_or_create_user path never had referred_by_user_id
      -- populated, so applyReferralReward could not credit the inviter
      -- on subsequent paid plans even though the user originally
      -- signed up via a ?start=ref_<code> deep-link. COALESCE order
      -- (users first, EXCLUDED second) means a row with an existing
      -- referrer is never re-pointed at a different inviter, which
      -- would be open to "referral hijack" by anyone who happens to
      -- know the victim's username.
      referred_by_user_id = COALESCE(users.referred_by_user_id, EXCLUDED.referred_by_user_id),
      updated_at = NOW()
    RETURNING id, (xmax = 0) AS inserted, referral_code, referred_by_user_id;
    `,
    [
      input.telegramId,
      input.username?.trim() || null,
      input.firstName?.trim() || null,
      input.lastName?.trim() || null,
      input.photoUrl?.trim() || null,
      input.referralCode?.trim() || null,
      input.referredByUserId ?? null,
    ]
  );

  const row = result.rows[0];
  if (!row?.id) {
    throw new Error('Failed to upsert telegram user');
  }

  return {
    userId: row.id,
    inserted: row.inserted,
    referralCode: row.referral_code,
    referredByUserId: row.referred_by_user_id,
  };
}

export async function ensureNamedPlan(
  client: PoolClient,
  input: {
    name: string;
    durationDays: number;
    price: number;
    maxDevices: number;
    trafficLimit?: number | null;
  }
) {
  const existing = await client.query<{ id: number }>(
    `
    SELECT id
    FROM plans
    WHERE name = $1
    ORDER BY id ASC
    LIMIT 1;
    `,
    [input.name]
  );

  const existingId = existing.rows[0]?.id;
  if (existingId) {
    return existingId;
  }

  const inserted = await client.query<{ id: number }>(
    `
    INSERT INTO plans (name, duration_days, price, max_devices, traffic_limit, is_active)
    VALUES ($1, $2, $3, $4, $5, TRUE)
    RETURNING id;
    `,
    [input.name, input.durationDays, input.price, input.maxDevices, input.trafficLimit ?? null]
  );

  const planId = inserted.rows[0]?.id;
  if (!planId) {
    throw new Error(`Failed to create plan ${input.name}`);
  }

  return planId;
}

/**
 * Sweep through expired subscriptions and freshly-deactivated keys, then
 * ROTATE the pool UUIDs that those keys were holding. The rotation is what
 * actually kicks the user off Xray: the old UUID value disappears from the
 * pool, the next `/api/xray/clients` snapshot doesn't contain it, the sync
 * script restarts Xray with the new client list, and the user's cached
 * VLESS config gets "user not found" within seconds.
 *
 * Without rotation, the existing GC merely cleared `assigned_to_key_id` and
 * left the same UUID value in the pool under a `pool-N` label — Xray
 * accepts ANY UUID present in its config regardless of email, so the
 * expired user kept connecting until that exact UUID happened to be
 * re-claimed by some other user (could be hours/days/never).
 *
 * Returns the number of pool slots rotated. The caller can ignore this
 * value — we already fire `triggerXraySync('fire-and-forget')` from inside
 * this function when rotated > 0, so propagation to Xray is automatic.
 */
export async function deactivateExpiredAccess(
  client: PoolClient,
  userId?: number,
): Promise<number> {
  const userFilter = userId ? 'AND user_id = $1' : '';
  const params = userId ? [userId] : [];

  // Capture row counts so we ONLY fire the xray-sync webhook when something
  // ACTUALLY expired in this call. Previously the webhook fired UNCONDITIONALLY
  // on every call to `deactivateExpiredAccess`, which runs on EVERY user-touch
  // path:
  //
  //   - `/api/users/sync`             (every Mini App / web app open)
  //   - `/api/auth/telegram/callback` (every login)
  //   - `/api/cron/sweep-expired`     (every 1 minute)
  //   - admin pages, payments, promos, bot webhooks
  //
  // Each webhook invokes `xray-sync.sh` on every VPN VPS. The script does a
  // diff against the live config, but the diff *very often* differs from the
  // previous snapshot — other users sign up between syncs (pool refill),
  // email labels flip from `pool-N` to `tg-X-sY`, expired keys leave the
  // snapshot. When the diff differs the script calls `systemctl restart
  // xray`, which drops EVERY active VPN connection on that server for 5-15s.
  // Stacked restarts (admin open + cron tick + payment callback within
  // seconds) break VLESS+Reality handshakes mid-stream, leaving clients stuck
  // retrying for minutes — exact symptom: "after opening admin, VPN dies on
  // both servers, recovers a few minutes later".
  const subsRes = await client.query(
    `
    UPDATE subscriptions
    SET status = 'expired',
        updated_at = NOW()
    WHERE status = 'active'
      AND end_date <= NOW()
      ${userFilter};
    `,
    params
  );

  // The `is_active = TRUE` guard on the vpn_keys UPDATE is required so we
  // don't count rows that were already deactivated as "changed" — otherwise
  // rowCount would still be > 0 every call and we'd be back to the
  // unconditional fire.
  const keysRes = await client.query(
    `
    UPDATE vpn_keys
    SET is_active = FALSE
    WHERE is_active = TRUE
    AND (
      (expires_at IS NOT NULL AND expires_at <= NOW())
      OR subscription_id IN (
        SELECT id
        FROM subscriptions
        WHERE (status <> 'active' OR end_date <= NOW())
        ${userFilter}
      )
    )
    ${userId ? 'AND user_id = $1' : ''};
    `,
    params
  );

  const totalChanged = (subsRes.rowCount ?? 0) + (keysRes.rowCount ?? 0);

  // v60-debug: log EVERY call so we can see in Hostman logs whether the
  // webhook actually fires for this user/path. Critical for diagnosing
  // residual restart-storm reports after the conditional-fire fix landed.
  console.log(
    `[deactivateExpiredAccess] userId=${userId ?? 'ALL'} `
    + `subsExpired=${subsRes.rowCount ?? 0} `
    + `keysDeactivated=${keysRes.rowCount ?? 0} `
    + `totalChanged=${totalChanged} `
    + `webhookFired=${totalChanged > 0}`
  );

  // Soft kick (v48): we DO NOT delete pool rows here. The vpn_keys row
  // is `is_active = FALSE` now, which causes `/api/xray/clients` to
  // EXCLUDE the linked pool UUID from its snapshot via a WHERE clause
  // (orphan filter). Xray restart drops it from the accepted-clients
  // list, and the user's cached VLESS config stops working — same end
  // user effect as a hard kick.
  //
  // We keep the pool row alive so that when the user buys a fresh
  // subscription, `ensureSessionUuid` flips the same vpn_key back to
  // `is_active = TRUE` and the SAME UUID re-enters the snapshot
  // automatically — no re-import required on the client side.
  //
  // Fire the webhook ONLY when something actually expired, so propagation
  // is ~1s instead of 5-min cron, but no restart-storm on idle calls.
  if (totalChanged > 0) {
    void triggerXraySync('fire-and-forget').catch((err) => {
      console.warn('[deactivateExpiredAccess] xray sync trigger failed:', err);
    });
  }

  return totalChanged;
}

/**
 * v66 (2026-05-17): Mass-reactivate every vpn_key the user owns and re-point
 * them at the freshly-activated subscription. Critical for the
 * "ban → admin unban / promo / payment" flow:
 *
 *   - Ban set ALL vpn_keys.is_active=FALSE (including per-device session
 *     keys created by ensureSessionUuid in /api/sub/[token]).
 *   - ensureVpnKey only resurrects the SHARED legacy key, never per-device.
 *   - Without this helper, per-device keys stayed dead until the user's
 *     Happ / v2rayTun did its next sub-poll (~60 s) and ensureSessionUuid
 *     flipped is_active back. User-visible symptom: "Hy2 came back instantly,
 *     all VLESS servers stayed N/A for a minute".
 *
 * Idempotent — only writes rows that actually need a change. Leaves
 * `pending-*` rows untouched (they'll be claimed properly later) and
 * `key_hash IS NULL` rows untouched (they shouldn't exist but the guard is
 * cheap insurance).
 *
 * Returns the number of rows actually mutated. Caller decides whether to
 * fire the xray-sync webhook (we don't fire it here because both call sites
 * — `activateSubscriptionForDays` / `*ForMonths` — are followed by
 * `ensureVpnKey` which already fires `triggerXraySync('wait')` and so the
 * resurrected per-device UUIDs propagate within the same fan-out).
 */
async function reactivateUserKeysAfterRenewal(
  client: PoolClient,
  userId: number,
  subscriptionId: number,
  expiresAt: Date,
): Promise<number> {
  const result = await client.query(
    `UPDATE vpn_keys
        SET is_active = TRUE,
            expires_at = $3,
            subscription_id = $2
      WHERE user_id = $1
        AND key_hash IS NOT NULL
        AND key_hash NOT LIKE 'pending-%'
        AND (
          is_active IS DISTINCT FROM TRUE
          OR expires_at IS DISTINCT FROM $3::timestamptz
          OR subscription_id IS DISTINCT FROM $2::int
        )`,
    [userId, subscriptionId, expiresAt],
  );
  const changed = result.rowCount ?? 0;
  if (changed > 0) {
    console.log(
      `[reactivateUserKeysAfterRenewal] userId=${userId} subId=${subscriptionId} reactivated=${changed}`,
    );
  }
  return changed;
}

export async function activateSubscriptionForDays(
  client: PoolClient,
  input: { userId: number; planId: number; days: number }
) {
  const currentSub = await client.query<SubscriptionRow>(
    `
    SELECT id, end_date, status
    FROM subscriptions
    WHERE user_id = $1
    ORDER BY end_date DESC NULLS LAST
    LIMIT 1
    FOR UPDATE;
    `,
    [input.userId]
  );

  if (currentSub.rows[0] && new Date(currentSub.rows[0].end_date) > new Date()) {
    const updated = await client.query<SubscriptionRow>(
      `
      UPDATE subscriptions
      SET end_date = end_date + ($2::int * INTERVAL '1 day'),
          updated_at = NOW(),
          status = 'active',
          plan_id = $3
      WHERE id = $1
      RETURNING id, end_date, status;
      `,
      [currentSub.rows[0].id, input.days, input.planId]
    );

    // 2026-05-05: subscription was extended in-place (same row id) so the
    // `expiring_1d` reminder we may have already sent for the OLD end_date
    // would block the cron from sending a fresh one when the NEW end_date
    // approaches. Clear all reminders for this subscription so the cycle
    // restarts. Idempotent: 0 rows deleted is fine.
    await client.query(
      `DELETE FROM subscription_reminders WHERE subscription_id = $1`,
      [currentSub.rows[0].id]
    );

    // v66 (2026-05-17): mass-reactivate ALL the user's vpn_keys (shared +
    // per-device) and re-point them at this subscription. Without this,
    // per-device session keys stayed `is_active=FALSE` after a ban, so the
    // user's Happ kept its cached UUID but xray on every VPS excluded it
    // from the snapshot — VPN looked dead until the next ~60 s sub-poll
    // ran ensureSessionUuid. ensureVpnKey only resurrects the SHARED legacy
    // key, never per-device, so it can't fix this on its own.
    await reactivateUserKeysAfterRenewal(
      client,
      input.userId,
      updated.rows[0].id,
      updated.rows[0].end_date,
    );

    return {
      subscriptionId: updated.rows[0].id,
      endDate: updated.rows[0].end_date,
      status: updated.rows[0].status,
      extendedExisting: true,
    };
  }

  const inserted = await client.query<SubscriptionRow>(
    `
    INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status)
    VALUES ($1, $2, NOW(), NOW() + ($3::int * INTERVAL '1 day'), 'active')
    RETURNING id, end_date, status;
    `,
    [input.userId, input.planId, input.days]
  );

  // v66: see UPDATE branch above. INSERT branch fires too because a fresh
  // subscription row after a ban means the user's existing per-device keys
  // still point at the OLD canceled subscription — moving them onto the
  // new sub_id (and flipping is_active back to TRUE) is what makes the
  // user's cached Happ UUIDs valid again on the next /api/xray/clients
  // snapshot fetch. Webhook is fired downstream by ensureVpnKey('wait').
  await reactivateUserKeysAfterRenewal(
    client,
    input.userId,
    inserted.rows[0].id,
    inserted.rows[0].end_date,
  );

  return {
    subscriptionId: inserted.rows[0].id,
    endDate: inserted.rows[0].end_date,
    status: inserted.rows[0].status,
    extendedExisting: false,
  };
}

// 2026-05-21: hours-granularity sibling of activateSubscriptionForDays.
// Added for the daily-boxes mini-game whose common rewards are sub-day
// (2h/4h/6h discount-shaped drops). Otherwise structurally identical to
// the days version — extends existing active subscription in-place,
// wipes stale reminders, and reactivates ALL the user's vpn_keys so per-
// device sessions keep working after a ban or expiry. Keep this in sync
// with activateSubscriptionForDays if either is touched.
export async function activateSubscriptionForHours(
  client: PoolClient,
  input: { userId: number; planId: number; hours: number }
) {
  const currentSub = await client.query<SubscriptionRow>(
    `
    SELECT id, end_date, status
    FROM subscriptions
    WHERE user_id = $1
    ORDER BY end_date DESC NULLS LAST
    LIMIT 1
    FOR UPDATE;
    `,
    [input.userId]
  );

  if (currentSub.rows[0] && new Date(currentSub.rows[0].end_date) > new Date()) {
    const updated = await client.query<SubscriptionRow>(
      `
      UPDATE subscriptions
      SET end_date = end_date + ($2::int * INTERVAL '1 hour'),
          updated_at = NOW(),
          status = 'active',
          plan_id = $3
      WHERE id = $1
      RETURNING id, end_date, status;
      `,
      [currentSub.rows[0].id, input.hours, input.planId]
    );

    await client.query(
      `DELETE FROM subscription_reminders WHERE subscription_id = $1`,
      [currentSub.rows[0].id]
    );

    await reactivateUserKeysAfterRenewal(
      client,
      input.userId,
      updated.rows[0].id,
      updated.rows[0].end_date,
    );

    return {
      subscriptionId: updated.rows[0].id,
      endDate: updated.rows[0].end_date,
      status: updated.rows[0].status,
      extendedExisting: true,
    };
  }

  const inserted = await client.query<SubscriptionRow>(
    `
    INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status)
    VALUES ($1, $2, NOW(), NOW() + ($3::int * INTERVAL '1 hour'), 'active')
    RETURNING id, end_date, status;
    `,
    [input.userId, input.planId, input.hours]
  );

  await reactivateUserKeysAfterRenewal(
    client,
    input.userId,
    inserted.rows[0].id,
    inserted.rows[0].end_date,
  );

  return {
    subscriptionId: inserted.rows[0].id,
    endDate: inserted.rows[0].end_date,
    status: inserted.rows[0].status,
    extendedExisting: false,
  };
}

export async function activateSubscriptionForMonths(
  client: PoolClient,
  input: { userId: number; planId: number; months: number }
) {
  const currentSub = await client.query<SubscriptionRow>(
    `
    SELECT id, end_date, status
    FROM subscriptions
    WHERE user_id = $1 AND status = 'active'
    ORDER BY end_date DESC NULLS LAST
    LIMIT 1
    FOR UPDATE;
    `,
    [input.userId]
  );

  if (currentSub.rows[0] && new Date(currentSub.rows[0].end_date) > new Date()) {
    const updated = await client.query<SubscriptionRow>(
      `
      UPDATE subscriptions
      SET end_date = end_date + ($2::int * INTERVAL '1 month'),
          updated_at = NOW(),
          status = 'active',
          plan_id = $3
      WHERE id = $1
      RETURNING id, end_date, status;
      `,
      [currentSub.rows[0].id, input.months, input.planId]
    );

    // 2026-05-05: see activateSubscriptionForDays — same reasoning. We
    // extended the existing subscription row in place, so wipe any
    // previously-sent reminder rows so the cron will send a fresh one
    // when the NEW end_date enters the 24h window.
    await client.query(
      `DELETE FROM subscription_reminders WHERE subscription_id = $1`,
      [currentSub.rows[0].id]
    );

    // v66 (2026-05-17): see activateSubscriptionForDays — mass-reactivate
    // every vpn_key the user owns so per-device session keys come back
    // online instantly after a ban → unban / payment / promo flow.
    await reactivateUserKeysAfterRenewal(
      client,
      input.userId,
      updated.rows[0].id,
      updated.rows[0].end_date,
    );

    return {
      subscriptionId: updated.rows[0].id,
      endDate: updated.rows[0].end_date,
      status: updated.rows[0].status,
      extendedExisting: true,
    };
  }

  const inserted = await client.query<SubscriptionRow>(
    `
    INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status)
    VALUES ($1, $2, NOW(), NOW() + ($3::int * INTERVAL '1 month'), 'active')
    RETURNING id, end_date, status;
    `,
    [input.userId, input.planId, input.months]
  );

  // v66: see UPDATE branch above and activateSubscriptionForDays.
  await reactivateUserKeysAfterRenewal(
    client,
    input.userId,
    inserted.rows[0].id,
    inserted.rows[0].end_date,
  );

  return {
    subscriptionId: inserted.rows[0].id,
    endDate: inserted.rows[0].end_date,
    status: inserted.rows[0].status,
    extendedExisting: false,
  };
}

export async function ensureVpnKey(
  client: PoolClient,
  input: {
    userId: number;
    subscriptionId: number;
    expiresAt: Date;
    deviceName: string;
    forceNew?: boolean;
    // v4 (2026-05-21 late): box rewards land on already-subscribed users
    // who don't need 1-second-fresh xray propagation — they're already
    // connected to a VPS and the next ~minute-cron poll will pick up the
    // new subscription_id. We let those callers pass `awaitSync: false`
    // so the box-open API responds in <100 ms instead of >1 s.
    // Defaults to true to preserve the post-payment guarantee.
    awaitSync?: boolean;
  }
) {
  // v69 (2026-05-11): the prior `WHERE user_id=$1 AND subscription_id=$2`
  // scope was the root cause of "Happ shows servers but no internet after
  // I paid for renewal" zombie reports. Every subscription renewal creates
  // a NEW `subscriptions` row (new id), so this SELECT never matched on
  // renewal → fell through to INSERT → at the bottom of the function the
  // cleanup statement `UPDATE vpn_keys SET is_active=FALSE WHERE id != $2
  // AND key_uri != 'per-device'` then deactivated the OLD shared key. The
  // user's Happ cache, populated weeks ago, still pointed at the now-dead
  // UUID, so Xray rejected it and the user had to either delete a device
  // or hit "Update subscription" in Happ to refresh the cache.
  //
  // Audit (2026-05-11 prod snapshot): 38 active users carried 109 inactive
  // legacy vpn_keys (~2.9 per user) — every one a UUID some Happ install
  // could still be sending to Xray.
  //
  // New scope: ANY existing shared (`key_uri != 'per-device'`) row for the
  // user, preferring `is_active=TRUE` then most recently created. The
  // UPDATE branch below still bumps `subscription_id = $4` so the FK
  // migrates to the new subscription seamlessly.
  const existing = !input.forceNew
    ? await client.query<VpnKeyRow>(
        `
        SELECT id, key_hash, device_name
        FROM vpn_keys
        WHERE user_id = $1
          AND key_uri != 'per-device'
          AND key_hash IS NOT NULL
          AND key_hash NOT LIKE 'pending-%'
        ORDER BY is_active DESC, created_at DESC
        LIMIT 1
        FOR UPDATE;
        `,
        [input.userId]
      )
    : { rows: [] as VpnKeyRow[] };

  let existingKey = existing.rows[0];

  // Check device limit: if no key for this subscription, check total keys vs plan max_devices
  if (!existingKey) {
    const limitCheck = await client.query<{ key_count: number; max_devices: number }>(
      `
      SELECT
        (SELECT COUNT(*)::int FROM vpn_keys WHERE user_id = $1) AS key_count,
        COALESCE(
          (SELECT p.max_devices FROM subscriptions s JOIN plans p ON p.id = s.plan_id
           WHERE s.id = $2 LIMIT 1),
          3
        ) AS max_devices
      `,
      [input.userId, input.subscriptionId]
    );
    const { key_count, max_devices } = limitCheck.rows[0] ?? { key_count: 0, max_devices: 3 };

    if (key_count >= max_devices) {
      // Reuse oldest key instead of creating a new one
      const reuse = await client.query<VpnKeyRow>(
        `SELECT id, key_hash, device_name FROM vpn_keys
         WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
        [input.userId]
      );
      existingKey = reuse.rows[0];
    }
  }

  let keyId: number;
  let keyHash = existingKey?.key_hash;

  if (existingKey) {
    // Existing key — keep UUID as-is (already in pool, already on Xray).
    // v43.1: drop unused $2/$3 NULL params — they caused Postgres to raise
    // "could not determine data type of parameter $2" because they weren't
    // referenced in the SQL body and had no explicit type cast.
    const updated = await client.query<{ id: number }>(
      `
      UPDATE vpn_keys
      SET device_name = COALESCE(device_name, $2),
          expires_at = $3,
          is_active = TRUE,
          subscription_id = $4
      WHERE id = $1
      RETURNING id;
      `,
      [existingKey.id, input.deviceName, input.expiresAt, input.subscriptionId]
    );
    keyId = updated.rows[0].id;
  } else {
    // New shared key: insert with placeholder hash, claim UUID from pool,
    // then update the row. Pool UUID is already on Xray → instant validity.
    const inserted = await client.query<{ id: number }>(
      `
      INSERT INTO vpn_keys (user_id, subscription_id, server_id, key_uri, key_hash, device_name, created_at, expires_at, is_active)
      VALUES ($1, $2, NULL, $3, $4, $5, NOW(), $6, TRUE)
      RETURNING id;
      `,
      [
        input.userId,
        input.subscriptionId,
        `pending://pool/`,
        `pending-${randomUUID()}`,
        input.deviceName,
        input.expiresAt,
      ]
    );
    keyId = inserted.rows[0].id;

    const pooled = await claimUuid(keyId, client);
    if (!pooled) {
      throw new Error('uuid_pool_exhausted');
    }
    keyHash = pooled;
  }

  const keyUri = keyHash
    ? (await buildVlessLink(keyHash)) ?? `pending://xray-config-required/${keyHash}`
    : `pending://pool/`;

  // Persist the final key_hash + key_uri for NEW keys (existing keys already
  // kept their previous hash).
  if (!existingKey) {
    await client.query(
      `UPDATE vpn_keys SET key_hash = $2, key_uri = $3 WHERE id = $1`,
      [keyId, keyHash, keyUri]
    );
  } else if (keyHash) {
    // For existing keys refresh only the URI (host may have changed).
    await client.query(
      `UPDATE vpn_keys SET key_uri = $2 WHERE id = $1`,
      [keyId, keyUri]
    );
  }

  // Only deactivate OTHER shared keys (not per-device keys).
  // Per-device keys are managed by ensurePerDeviceUuid in /api/sub/[token]
  // and must NOT be deactivated here — otherwise all devices lose connection.
  await client.query(
    `
    UPDATE vpn_keys
    SET is_active = FALSE
    WHERE user_id = $1
      AND id != $2
      AND key_uri != 'per-device';
    `,
    [input.userId, keyId]
  );

  // v68 (2026-05-06): fire xray-sync webhook so Xray on every VPN VPS picks
  // up the (re)activated UUID within ~1 second instead of waiting up to 5
  // minutes for the next cron tick.
  //
  // SYMPTOM this fixes: user pays for a renewal after their subscription
  // expired → activateSubscriptionForDays + ensureVpnKey flip is_active back
  // to TRUE in the DB → /api/xray/clients snapshot now includes the UUID
  // again → BUT no VPN server has refetched the snapshot yet, so Xray's
  // accepted-clients list still excludes the UUID → all servers show
  // "Ping N/A" until the 5-min cron tick on /opt/xray-sync.sh runs.
  //
  // This webhook fires from EVERY payment path (crypto callback, SBP confirm,
  // Telegram Stars webhook) because they all funnel through `ensureVpnKey`.
  //
  // v65 (2026-05-17): switched from 'fire-and-forget' to 'wait'. With fire-
  // and-forget the webhook could silently fail (Python listener busy, TCP
  // RST, single-threaded queue full) and the user would be stuck waiting up
  // to 5 min for cron — the exact "почему я должен ждать пока серваки
  // заработают, n/a" symptom. 'wait' mode adds ~200-800 ms to the payment
  // callback (well within the 30 s budget every payment gateway gives us),
  // confirms every VPS got the sync, and retries up to 2× per server if any
  // fail. Payment is durably committed before this fires, so even a hard
  // webhook failure can't undo the purchase — worst case is the user falls
  // back to the cron path, which is no worse than the old fire-and-forget.
  // Default = wait (post-payment correctness). Box rewards opt out via
  // awaitSync: false to keep openBox() under 100 ms.
  const awaitSync = input.awaitSync !== false;
  if (awaitSync) {
    const webhookOk = await triggerXraySync('wait').catch((err) => {
      console.warn('[ensureVpnKey] xray sync trigger failed:', err);
      return false;
    });
    console.log(
      `[ensureVpnKey] userId=${input.userId} subId=${input.subscriptionId} `
      + `keyId=${keyId} reused=${!!existingKey} webhookOk=${webhookOk}`
    );
  } else {
    void triggerXraySync('fire-and-forget').catch((err) => {
      console.warn('[ensureVpnKey] xray sync trigger failed (async):', err);
    });
    console.log(
      `[ensureVpnKey] userId=${input.userId} subId=${input.subscriptionId} `
      + `keyId=${keyId} reused=${!!existingKey} awaitSync=false`
    );
  }

  return {
    keyId,
    keyHash,
    keyUri,
    subscriptionUrl: null,
  };
}

export async function banUserAccess(client: PoolClient, userId: number) {
  // Обнуляем дни подписки (end_date = NOW)
  await client.query(
    `
    UPDATE subscriptions
    SET status = 'canceled',
        end_date = NOW(),
        updated_at = NOW()
    WHERE user_id = $1
      AND status = 'active';
    `,
    [userId]
  );

  // Деактивируем ключи и обнуляем expires_at
  await client.query(
    `
    UPDATE vpn_keys
    SET is_active = FALSE,
        expires_at = NOW()
    WHERE user_id = $1;
    `,
    [userId]
  );

  // v65 (2026-05-17): mirror deactivateExpiredAccess and fire the xray sync
  // webhook immediately so VLESS dies within ~1s instead of waiting up to
  // 5 min for the next cron tick. Without this the ban looked like:
  //   - Hy2: dead within seconds (live /api/hysteria/auth check rejects).
  //   - VLESS: alive for ~5 min until cron/sweep-expired re-snapshots Xray.
  // 'wait' so the admin's HTTP response to /api/admin/ban returns only after
  // every VPN VPS has reloaded its client list — the admin can re-test the
  // banned account immediately and see VPN actually dead. Adds ~1 s to the
  // admin response which is fine for a human-driven flow.
  await triggerXraySync('wait').catch((err) => {
    console.warn('[banUserAccess] xray sync trigger failed:', err);
  });
}

export async function banUserSubscription(client: PoolClient, userId: number) {
  // Обнуляем дни подписки (end_date = NOW)
  await client.query(
    `
    UPDATE subscriptions
    SET status = 'canceled',
        end_date = NOW(),
        updated_at = NOW()
    WHERE user_id = $1
      AND status = 'active';
    `,
    [userId]
  );

  // Деактивируем ключи и обнуляем expires_at
  await client.query(
    `
    UPDATE vpn_keys
    SET is_active = FALSE,
        expires_at = NOW()
    WHERE user_id = $1;
    `,
    [userId]
  );

  // v65 (2026-05-17): see banUserAccess — same reasoning, same fix.
  // 'wait' so the admin response to /api/admin/ban only returns after every
  // VPN VPS has reloaded its client list and dropped the banned UUID.
  await triggerXraySync('wait').catch((err) => {
    console.warn('[banUserSubscription] xray sync trigger failed:', err);
  });
}

export async function reactivatePaidAccessIfEligible(client: PoolClient, userId: number) {
  const eligibleSub = await client.query<SubscriptionRow>(
    `
    SELECT s.id, s.end_date, s.status
    FROM subscriptions s
    WHERE s.user_id = $1
      AND s.end_date > NOW()
      AND EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.user_id = s.user_id
          AND p.subscription_id = s.id
          AND p.status = 'paid'
      )
    ORDER BY s.end_date DESC
    LIMIT 1
    FOR UPDATE;
    `,
    [userId]
  );

  const row = eligibleSub.rows[0];
  if (!row) {
    await client.query(
      `
      UPDATE vpn_keys
      SET is_active = FALSE
      WHERE user_id = $1;
      `,
      [userId]
    );
    return null;
  }

  await client.query(
    `
    UPDATE subscriptions
    SET status = 'active',
        updated_at = NOW()
    WHERE id = $1;
    `,
    [row.id]
  );

  const existingKeys = await client.query<{ count: string }>(
    `
    SELECT COUNT(*)::text AS count
    FROM vpn_keys
    WHERE user_id = $1
      AND subscription_id = $2
      AND (expires_at IS NULL OR expires_at > NOW());
    `,
    [userId, row.id]
  );

  let keyUri: string | null = null;

  if (Number(existingKeys.rows[0]?.count ?? '0') > 0) {
    await client.query(
      `
      UPDATE vpn_keys
      SET is_active = CASE WHEN subscription_id = $2 AND (expires_at IS NULL OR expires_at > NOW()) THEN TRUE ELSE FALSE END,
          expires_at = CASE WHEN subscription_id = $2 THEN $3 ELSE expires_at END
      WHERE user_id = $1;
      `,
      [userId, row.id, row.end_date]
    );

    const keyResult = await client.query<{ key_uri: string }>(
      `
      SELECT key_uri
      FROM vpn_keys
      WHERE user_id = $1
        AND subscription_id = $2
        AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1;
      `,
      [userId, row.id]
    );
    keyUri = keyResult.rows[0]?.key_uri ?? null;

    // v65 (2026-05-17): reactivating existing keys via raw UPDATE does NOT
    // route through ensureVpnKey, so the xray-sync webhook would never fire
    // and the user's VPN stayed dead for up to 5 min after admin un-banned
    // them. Fire it here too. Skipped for the INSERT branch below because
    // ensureVpnKey already fires its own webhook. 'wait' so the admin sees
    // the VPN come back immediately on the un-banned account.
    await triggerXraySync('wait').catch((err) => {
      console.warn('[reactivatePaidAccessIfEligible] xray sync trigger failed:', err);
    });
  } else {
    const key = await ensureVpnKey(client, {
      userId,
      subscriptionId: row.id,
      expiresAt: row.end_date,
      deviceName: 'Restored Access',
    });
    keyUri = key.keyUri;
  }

  return {
    subscriptionId: row.id,
    endDate: row.end_date,
    keyUri,
  };
}

export async function userNeedsInitialTrial(client: PoolClient, userId: number) {
  const result = await client.query<{ subscriptions_count: string; payments_count: string; keys_count: string }>(
    `
    SELECT
      (SELECT COUNT(*)::text FROM subscriptions WHERE user_id = $1) AS subscriptions_count,
      (SELECT COUNT(*)::text FROM payments WHERE user_id = $1 AND status = 'paid') AS payments_count,
      (SELECT COUNT(*)::text FROM vpn_keys WHERE user_id = $1) AS keys_count;
    `,
    [userId]
  );

  const row = result.rows[0];
  return Number(row?.subscriptions_count ?? '0') === 0
    && Number(row?.payments_count ?? '0') === 0
    && Number(row?.keys_count ?? '0') === 0;
}

export async function issueTrialAccess(
  client: PoolClient,
  userId: number,
  telegramId: number,
  days: number = 3,
) {
  const safeDays = Math.max(1, Math.round(days));
  const planId = await ensureNamedPlan(client, {
    name: `Free Trial ${safeDays}d`,
    durationDays: safeDays,
    price: 0,
    maxDevices: 1,
    trafficLimit: null,
  });

  const subscription = await activateSubscriptionForDays(client, {
    userId,
    planId,
    days: safeDays,
  });

  const key = await ensureVpnKey(client, {
    userId,
    subscriptionId: subscription.subscriptionId,
    expiresAt: subscription.endDate,
    deviceName: 'Free Trial Device',
  });

  return {
    subscriptionId: subscription.subscriptionId,
    endDate: subscription.endDate,
    keyUri: key.keyUri,
    subscriptionUrl: getSubscriptionUrl(telegramId),
  };
}

/**
 * Tiered referral bonus schedule (days granted to the inviter, based on
 * the subscription duration the invitee just purchased):
 *
 *   < 30 days     → 0 days  (sub-monthly plans intentionally earn nothing —
 *                            avoids farming +1 bonuses via 3-day trial buys)
 *   30..179 days  → 7 days  (monthly, 3-month, etc.)
 *   180..364 days → 14 days (half-year)
 *   ≥ 365 days    → 21 days (year / multi-year)
 *
 * Unlike the pre-v2 schedule this fires on EVERY qualifying payment, not
 * just the friend's first one — see applyReferralReward.
 */
export function getReferralBonusDays(paidDays: number): number {
  if (!Number.isFinite(paidDays) || paidDays < 30) return 0;
  if (paidDays >= 365) return 21;
  if (paidDays >= 180) return 14;
  return 7;
}

/**
 * Credits a referral bonus to the inviter for a successful PAID plan of
 * `paidDays` (see getReferralBonusDays for the tier table). Fires on EVERY
 * qualifying payment — monthly renewals, crypto top-ups, SBP charges, etc.
 *
 * Idempotency is anchored to `paymentId` via the partial UNIQUE
 * `idx_referral_bonus_payment_unique`, so gateway retries produce at most
 * one journal row per payment. Pass `null` only if the caller has no
 * payments row (exceptional path — then the journal row is skipped and
 * the bonus subscription extension is NOT applied, keeping the two sides
 * in sync).
 */
export async function applyReferralReward(
  client: PoolClient,
  paidUserId: number,
  paidDays: number,
  paymentId: number | null
) {
  const bonusDays = getReferralBonusDays(paidDays);
  if (bonusDays <= 0) {
    return;
  }

  // No paymentId → can't dedupe across retries. Skip rather than risk
  // double-crediting the inviter. All three current callers (SBP, crypto,
  // Telegram Stars webhook) pass a concrete id.
  if (!paymentId || !Number.isFinite(paymentId) || paymentId <= 0) {
    return;
  }

  const inviterResult = await client.query<{ referred_by_user_id: number | null }>(
    `
    SELECT referred_by_user_id
    FROM users
    WHERE id = $1
    LIMIT 1;
    `,
    [paidUserId]
  );

  const inviterUserId = inviterResult.rows[0]?.referred_by_user_id;
  if (!inviterUserId) {
    return;
  }

  // Journal FIRST so ON CONFLICT dedupes replayed gateway callbacks. Only
  // extend the inviter's subscription after we know the journal insert
  // actually took effect — otherwise a retry would double-credit days.
  const journal = await client.query<{ id: number }>(
    `
    INSERT INTO referral_bonus_transactions (
      inviter_user_id, invitee_user_id, bonus_type, bonus_days, payment_id
    ) VALUES ($1, $2, 'payment', $3, $4)
    ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL AND bonus_type = 'payment' DO NOTHING
    RETURNING id;
    `,
    [inviterUserId, paidUserId, bonusDays, paymentId]
  );

  if (journal.rowCount === 0) {
    // Already journaled for this payment — treat as no-op (replay).
    return;
  }

  const bonusPlanName = `Referral Bonus ${bonusDays}d`;
  const bonusPlanId = await ensureNamedPlan(client, {
    name: bonusPlanName,
    durationDays: bonusDays,
    price: 0,
    maxDevices: 3,
    trafficLimit: null,
  });
  if (!bonusPlanId) {
    return;
  }

  const inviterSub = await client.query<{ id: number; end_date: Date }>(
    `
    SELECT id, end_date
    FROM subscriptions
    WHERE user_id = $1 AND status = 'active'
    ORDER BY end_date DESC
    LIMIT 1
    FOR UPDATE;
    `,
    [inviterUserId]
  );

  if (inviterSub.rows[0] && new Date(inviterSub.rows[0].end_date) > new Date()) {
    await client.query(
      `
      UPDATE subscriptions
      SET end_date = end_date + ($2::int * INTERVAL '1 day'),
          updated_at = NOW(),
          status = 'active'
      WHERE id = $1;
      `,
      [inviterSub.rows[0].id, bonusDays]
    );

    // 2026-05-05: extending inviter's existing subscription bumps end_date.
    // Wipe stale 'expiring_1d' reminders so the cron can re-send when the
    // new end_date enters the 24h window. Idempotent.
    await client.query(
      `DELETE FROM subscription_reminders WHERE subscription_id = $1`,
      [inviterSub.rows[0].id]
    );

    await client.query(
      `
      UPDATE vpn_keys
      SET expires_at = CASE
        WHEN expires_at IS NULL THEN NOW() + ($2::int * INTERVAL '1 day')
        ELSE expires_at + ($2::int * INTERVAL '1 day')
      END
      WHERE user_id = $1
        AND is_active = TRUE
        AND (expires_at IS NULL OR expires_at > NOW());
      `,
      [inviterUserId, bonusDays]
    );
  } else {
    await client.query(
      `
      INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status)
      VALUES ($1, $2, NOW(), NOW() + ($3::int * INTERVAL '1 day'), 'active');
      `,
      [inviterUserId, bonusPlanId, bonusDays]
    );
  }
}

/**
 * Fixed bonus the inviter receives every time a brand-new user registers
 * via their referral link (Mini App `startapp=ref_<code>`). Independent of
 * the tiered first-payment bonus in `applyReferralReward`.
 */
// 2026-05-22: dropped from 5 → 3. The new 10% cash referral system
// (lib/referral-cash.ts) carries a higher LTV reward, so the
// signup-only bonus can be slimmer without hurting growth incentives.
export const REFERRAL_SIGNUP_BONUS_DAYS = 3;

/**
 * Credits `bonusDays` to the inviter on a fresh referral SIGNUP (i.e. when
 * a new user is inserted via referral link). Mirrors the credit logic from
 * `applyReferralReward` — extends the inviter's active subscription if any,
 * otherwise opens a new bonus subscription.
 *
 * Idempotency is the caller's responsibility: this MUST be called only on
 * the row's first INSERT (`syncedUser.inserted === true`), not on repeated
 * upserts of the same user.
 */
export async function grantReferralSignupBonus(
  client: PoolClient,
  inviterUserId: number,
  inviteeUserId: number,
  bonusDays: number = REFERRAL_SIGNUP_BONUS_DAYS,
) {
  if (!inviterUserId || !inviteeUserId || bonusDays <= 0) {
    return;
  }

  const bonusPlanName = `Referral Signup Bonus ${bonusDays}d`;
  const bonusPlanId = await ensureNamedPlan(client, {
    name: bonusPlanName,
    durationDays: bonusDays,
    price: 0,
    maxDevices: 3,
    trafficLimit: null,
  });
  if (!bonusPlanId) {
    return;
  }

  // Idempotency gate FIRST — without this the function double-credited
  // when re-invoked. Pre-2026-05-07 the only caller (api/users/sync)
  // gated on `syncedUser.inserted` so a second call was structurally
  // impossible; with the post-incident gate relaxed to `shouldCreateTrial`
  // a user who runs `/start ref_X` twice (or has multiple chat-bot/Mini
  // App entries before their trial expires) would otherwise extend the
  // inviter's subscription by 5 days on EACH /start while the journal
  // INSERT silently no-op'd via ON CONFLICT.
  //
  // We mirror `applyReferralReward`'s pattern: INSERT … RETURNING id with
  // ON CONFLICT DO NOTHING; an empty RETURNING means the (inviter,
  // invitee, 'signup') row already exists in `referral_bonus_transactions`
  // and we must short-circuit. The partial UNIQUE index
  // `idx_referral_bonus_signup_unique` (inviter, invitee)
  // WHERE bonus_type = 'signup' keeps the gate atomic across concurrent
  // signup-bonus grants from the Mini App + chat bot.
  const journal = await client.query<{ id: number }>(
    `
    INSERT INTO referral_bonus_transactions (
      inviter_user_id, invitee_user_id, bonus_type, bonus_days
    ) VALUES ($1, $2, 'signup', $3)
    ON CONFLICT (inviter_user_id, invitee_user_id) WHERE bonus_type = 'signup' DO NOTHING
    RETURNING id;
    `,
    [inviterUserId, inviteeUserId, bonusDays]
  );
  if (journal.rows.length === 0) {
    return;
  }

  const inviterSub = await client.query<{ id: number; end_date: Date }>(
    `
    SELECT id, end_date
    FROM subscriptions
    WHERE user_id = $1 AND status = 'active'
    ORDER BY end_date DESC
    LIMIT 1
    FOR UPDATE;
    `,
    [inviterUserId]
  );

  if (inviterSub.rows[0] && new Date(inviterSub.rows[0].end_date) > new Date()) {
    await client.query(
      `
      UPDATE subscriptions
      SET end_date = end_date + ($2::int * INTERVAL '1 day'),
          updated_at = NOW(),
          status = 'active'
      WHERE id = $1;
      `,
      [inviterSub.rows[0].id, bonusDays]
    );

    // 2026-05-05: extending inviter's existing subscription bumps end_date.
    // Wipe stale 'expiring_1d' reminders so the cron can re-send when the
    // new end_date enters the 24h window. Idempotent.
    await client.query(
      `DELETE FROM subscription_reminders WHERE subscription_id = $1`,
      [inviterSub.rows[0].id]
    );

    await client.query(
      `
      UPDATE vpn_keys
      SET expires_at = CASE
        WHEN expires_at IS NULL THEN NOW() + ($2::int * INTERVAL '1 day')
        ELSE expires_at + ($2::int * INTERVAL '1 day')
      END
      WHERE user_id = $1
        AND is_active = TRUE
        AND (expires_at IS NULL OR expires_at > NOW());
      `,
      [inviterUserId, bonusDays]
    );
  } else {
    await client.query(
      `
      INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status)
      VALUES ($1, $2, NOW(), NOW() + ($3::int * INTERVAL '1 day'), 'active');
      `,
      [inviterUserId, bonusPlanId, bonusDays]
    );
  }
}

export async function applyPromoCode(client: PoolClient, input: { userId: number; telegramId: number | null; code: string }) {
  const normalizedCode = input.code.trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error('Promo code is required');
  }

  // 2026-05-13: try soft-delete-aware first, fall back without
  // deleted_at if the column hasn't been migrated yet (Postgres 42703).
  // Without the fallback, a user applying a free-days promo from the
  // home screen would hit a 500 between deploy and the first call to
  // an admin endpoint that runs `ensurePromoSchema()`.
  //
  // We're inside a transaction here — a raw error would mark the whole
  // tx ABORTED ("current transaction is aborted, commands ignored until
  // end of transaction block"). SAVEPOINT lets us swallow the column-
  // -missing error and retry without losing the outer tx.
  let promoResult;
  await client.query('SAVEPOINT promo_select');
  try {
    promoResult = await client.query<PromoRow>(
      `
      SELECT id, code, days, discount_percent, max_uses, used_count, expires_at
      FROM promo_codes
      WHERE code = $1
        AND is_active = TRUE
        AND deleted_at IS NULL
        AND used_count < max_uses
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1
      FOR UPDATE;
      `,
      [normalizedCode]
    );
    await client.query('RELEASE SAVEPOINT promo_select');
  } catch (e: any) {
    await client.query('ROLLBACK TO SAVEPOINT promo_select');
    if (e?.code !== '42703') throw e;
    promoResult = await client.query<PromoRow>(
      `
      SELECT id, code, days, discount_percent, max_uses, used_count, expires_at
      FROM promo_codes
      WHERE code = $1
        AND is_active = TRUE
        AND used_count < max_uses
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1
      FOR UPDATE;
      `,
      [normalizedCode]
    );
    await client.query('RELEASE SAVEPOINT promo_select');
  }

  const promo = promoResult.rows[0];
  if (!promo) {
    throw new Error('Промокод недействителен или исчерпан');
  }

  const alreadyUsed = await client.query<{ id: number }>(
    `
    SELECT id
    FROM promo_code_uses
    WHERE promo_code_id = $1 AND user_id = $2
    LIMIT 1;
    `,
    [promo.id, input.userId]
  );

  if (alreadyUsed.rows[0]?.id) {
    throw new Error('Промокод уже был использован');
  }

  const userState = await client.query<{ is_banned: boolean }>(
    `
    SELECT is_banned
    FROM users
    WHERE id = $1
    LIMIT 1
    FOR UPDATE;
    `,
    [input.userId]
  );

  if (userState.rows[0]?.is_banned) {
    throw new Error('Забаненному пользователю промокод недоступен');
  }

  // Скидочный промокод - возвращаем информацию о скидке без создания подписки
  if (promo.discount_percent && promo.discount_percent > 0 && promo.days === 0) {
    return {
      type: 'discount' as const,
      promoCode: promo.code,
      promoId: promo.id,
      discountPercent: promo.discount_percent,
      days: 0,
      subscriptionId: null,
      endDate: null,
      keyUri: null,
      subscriptionUrl: null,
    };
  }

  // Промокод на дни - создаём подписку
  const planId = await ensureNamedPlan(client, {
    name: `Promo ${promo.code} ${promo.days}d`,
    durationDays: promo.days,
    price: 0,
    maxDevices: 3,
    trafficLimit: null,
  });

  const subscription = await activateSubscriptionForDays(client, {
    userId: input.userId,
    planId,
    days: promo.days,
  });

  const key = await ensureVpnKey(client, {
    userId: input.userId,
    subscriptionId: subscription.subscriptionId,
    expiresAt: subscription.endDate,
    deviceName: 'Promo Access',
  });

  await client.query(
    `
    INSERT INTO promo_code_uses (promo_code_id, user_id)
    VALUES ($1, $2);
    `,
    [promo.id, input.userId]
  );

  await client.query(
    `
    UPDATE promo_codes
    SET used_count = used_count + 1
    WHERE id = $1;
    `,
    [promo.id]
  );

  return {
    type: 'days' as const,
    promoCode: promo.code,
    promoId: promo.id,
    discountPercent: 0,
    days: promo.days,
    subscriptionId: subscription.subscriptionId,
    endDate: subscription.endDate,
    keyUri: key.keyUri,
    subscriptionUrl: input.telegramId
      ? getSubscriptionUrl(input.telegramId)
      : getSubscriptionUrlForUser(input.userId),
  };
}
