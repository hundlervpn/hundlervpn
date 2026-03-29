import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { buildVlessLink, getSubscriptionUrl } from '@/lib/sub-token';

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

export async function deactivateExpiredAccess(client: PoolClient, userId?: number) {
  const userFilter = userId ? 'AND user_id = $1' : '';
  const params = userId ? [userId] : [];

  await client.query(
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

  await client.query(
    `
    UPDATE vpn_keys
    SET is_active = FALSE
    WHERE (
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
  }
) {
  const existing = !input.forceNew
    ? await client.query<VpnKeyRow>(
        `
        SELECT id, key_hash, device_name
        FROM vpn_keys
        WHERE user_id = $1 AND subscription_id = $2
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE;
        `,
        [input.userId, input.subscriptionId]
      )
    : { rows: [] as VpnKeyRow[] };

  const existingKey = existing.rows[0];
  const keyHash = existingKey?.key_hash || randomUUID();
  const keyUri = buildVlessLink(keyHash) ?? `pending://xray-config-required/${keyHash}`;

  let keyId: number;

  if (existingKey) {
    const updated = await client.query<{ id: number }>(
      `
      UPDATE vpn_keys
      SET key_uri = $2,
          key_hash = $3,
          device_name = COALESCE(device_name, $4),
          expires_at = $5,
          is_active = TRUE,
          subscription_id = $6
      WHERE id = $1
      RETURNING id;
      `,
      [existingKey.id, keyUri, keyHash, input.deviceName, input.expiresAt, input.subscriptionId]
    );
    keyId = updated.rows[0].id;
  } else {
    const inserted = await client.query<{ id: number }>(
      `
      INSERT INTO vpn_keys (user_id, subscription_id, server_id, key_uri, key_hash, device_name, created_at, expires_at, is_active)
      VALUES ($1, $2, NULL, $3, $4, $5, NOW(), $6, TRUE)
      RETURNING id;
      `,
      [input.userId, input.subscriptionId, keyUri, keyHash, input.deviceName, input.expiresAt]
    );
    keyId = inserted.rows[0].id;
  }

  await client.query(
    `
    UPDATE vpn_keys
    SET is_active = CASE WHEN id = $2 THEN TRUE ELSE FALSE END
    WHERE user_id = $1;
    `,
    [input.userId, keyId]
  );

  return {
    keyId,
    keyHash,
    keyUri,
    subscriptionUrl: null,
  };
}

export async function banUserAccess(client: PoolClient, userId: number) {
  await client.query(
    `
    UPDATE subscriptions
    SET status = 'canceled',
        updated_at = NOW()
    WHERE user_id = $1
      AND status = 'active'
      AND end_date > NOW();
    `,
    [userId]
  );

  await client.query(
    `
    UPDATE vpn_keys
    SET is_active = FALSE
    WHERE user_id = $1;
    `,
    [userId]
  );
}

export async function banUserSubscription(client: PoolClient, userId: number) {
  await client.query(
    `
    UPDATE subscriptions
    SET status = 'canceled',
        updated_at = NOW()
    WHERE user_id = $1
      AND status = 'active'
      AND end_date > NOW();
    `,
    [userId]
  );

  await client.query(
    `
    UPDATE vpn_keys
    SET is_active = FALSE
    WHERE user_id = $1;
    `,
    [userId]
  );
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

export async function issueTrialAccess(client: PoolClient, userId: number, telegramId: number) {
  const planId = await ensureNamedPlan(client, {
    name: 'Free Trial 3d',
    durationDays: 3,
    price: 0,
    maxDevices: 1,
    trafficLimit: null,
  });

  const subscription = await activateSubscriptionForDays(client, {
    userId,
    planId,
    days: 3,
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

export async function applyReferralReward(client: PoolClient, paidUserId: number) {
  const paidHistory = await client.query<{ count: string }>(
    `
    SELECT COUNT(*)::text AS count
    FROM payments
    WHERE user_id = $1 AND status = 'paid';
    `,
    [paidUserId]
  );

  if (Number(paidHistory.rows[0]?.count ?? '0') > 0) {
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

  const bonusPlanName = 'Referral Bonus 7d';
  const bonusPlanId = await ensureNamedPlan(client, {
    name: bonusPlanName,
    durationDays: 7,
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
      SET end_date = end_date + INTERVAL '7 days',
          updated_at = NOW(),
          status = 'active'
      WHERE id = $1;
      `,
      [inviterSub.rows[0].id]
    );

    await client.query(
      `
      UPDATE vpn_keys
      SET expires_at = CASE
        WHEN expires_at IS NULL THEN NOW() + INTERVAL '7 days'
        ELSE expires_at + INTERVAL '7 days'
      END
      WHERE user_id = $1
        AND is_active = TRUE
        AND (expires_at IS NULL OR expires_at > NOW());
      `,
      [inviterUserId]
    );
  } else {
    await client.query(
      `
      INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status)
      VALUES ($1, $2, NOW(), NOW() + INTERVAL '7 days', 'active');
      `,
      [inviterUserId, bonusPlanId]
    );
  }
}

export async function applyPromoCode(client: PoolClient, input: { userId: number; telegramId: number; code: string }) {
  const normalizedCode = input.code.trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error('Promo code is required');
  }

  const promoResult = await client.query<PromoRow>(
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
    subscriptionUrl: getSubscriptionUrl(input.telegramId),
  };
}
