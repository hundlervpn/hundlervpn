import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';

function parseMonthsFromPayload(payload: string): number {
  const match = payload.match(/vpn_premium_(\d+)_months_/);
  if (!match) return 1;
  const months = Number(match[1]);
  if (!Number.isFinite(months) || months <= 0) return 1;
  return Math.min(months, 24);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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

async function applyReferralReward(client: PoolClient, paidUserId: number) {
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
  await client.query(
    `
    INSERT INTO plans (name, duration_days, price, max_devices, traffic_limit, is_active)
    VALUES ($1, 7, 0, 3, NULL, TRUE)
    ON CONFLICT DO NOTHING;
    `,
    [bonusPlanName]
  );

  const bonusPlanResult = await client.query<{ id: number }>(
    'SELECT id FROM plans WHERE name = $1 ORDER BY id DESC LIMIT 1;',
    [bonusPlanName]
  );
  const bonusPlanId = bonusPlanResult.rows[0]?.id;
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

export async function POST(req: Request) {
  try {
    const update = await req.json();
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN is not set');
      return NextResponse.json({ error: 'Bot token not configured' }, { status: 500 });
    }

    // Handle pre_checkout_query
    if (update.pre_checkout_query) {
      const preCheckoutQueryId = update.pre_checkout_query.id;
      
      // Here you can validate the payload, check stock, etc.
      // For digital goods with Stars, we usually just approve it.
      
      const url = `https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`;
      
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pre_checkout_query_id: preCheckoutQueryId,
          ok: true,
        }),
      });
      
      return NextResponse.json({ ok: true });
    }

    // Handle successful_payment
    if (update.message && update.message.successful_payment) {
      const paymentInfo = update.message.successful_payment;
      const payload = paymentInfo.invoice_payload as string;
      const userId = Number(update.message.from.id);
      const months = parseMonthsFromPayload(payload);
      
      console.log(`Payment successful! User ID: ${userId}, Payload: ${payload}, Total Amount: ${paymentInfo.total_amount} ${paymentInfo.currency}`);

      const pool = getDbPool();
      const client = await pool.connect();

      let vlessKey: string | null = null;
      let endDate: Date | null = null;

      try {
        await client.query('BEGIN');

        const username = update.message.from.username ?? null;
        const firstName = update.message.from.first_name ?? null;
        const lastName = update.message.from.last_name ?? null;

        const userResult = await client.query<{ id: number }>(
          `
          INSERT INTO users (telegram_id, username, first_name, last_name, status, is_banned, auto_renew, last_seen_at)
          VALUES ($1, $2, $3, $4, 'active', FALSE, FALSE, NOW())
          ON CONFLICT (telegram_id)
          DO UPDATE SET
            username = COALESCE(EXCLUDED.username, users.username),
            first_name = COALESCE(EXCLUDED.first_name, users.first_name),
            last_name = COALESCE(EXCLUDED.last_name, users.last_name),
            last_seen_at = NOW(),
            updated_at = NOW()
          RETURNING id;
          `,
          [userId, username, firstName, lastName]
        );

        await client.query(
          `
          UPDATE vpn_keys
          SET is_active = FALSE
          WHERE (expires_at IS NOT NULL AND expires_at <= NOW())
             OR user_id IN (
               SELECT s.user_id
               FROM subscriptions s
               WHERE s.status <> 'active' OR s.end_date <= NOW()
             );
          `
        );
        const dbUserId = userResult.rows[0].id;

        const planName = `Premium ${months}m`;
        await client.query(
          `
          INSERT INTO plans (name, duration_days, price, max_devices, traffic_limit, is_active)
          VALUES ($1, $2, $3, 3, NULL, TRUE)
          ON CONFLICT DO NOTHING;
          `,
          [planName, months * 30, paymentInfo.total_amount]
        );

        const planResult = await client.query<{ id: number }>(
          `
          SELECT id FROM plans WHERE name = $1 ORDER BY id DESC LIMIT 1;
          `,
          [planName]
        );
        const planId = planResult.rows[0]?.id;

        if (!planId) {
          throw new Error('Failed to resolve subscription plan');
        }

        const currentSub = await client.query<{ id: number; end_date: Date }>(
          `
          SELECT id, end_date
          FROM subscriptions
          WHERE user_id = $1 AND status = 'active'
          ORDER BY end_date DESC
          LIMIT 1
          FOR UPDATE;
          `,
          [dbUserId]
        );

        if (currentSub.rows[0] && new Date(currentSub.rows[0].end_date) > new Date()) {
          const updated = await client.query<{ id: number; end_date: Date }>(
            `
            UPDATE subscriptions
            SET end_date = end_date + ($2::int * INTERVAL '1 month'),
                updated_at = NOW(),
                status = 'active'
            WHERE id = $1
            RETURNING id, end_date;
            `,
            [currentSub.rows[0].id, months]
          );
          endDate = updated.rows[0].end_date;
        } else {
          const inserted = await client.query<{ id: number; end_date: Date }>(
            `
            INSERT INTO subscriptions (user_id, plan_id, start_date, end_date, status)
            VALUES ($1, $2, NOW(), NOW() + ($3::int * INTERVAL '1 month'), 'active')
            RETURNING id, end_date;
            `,
            [dbUserId, planId, months]
          );
          endDate = inserted.rows[0].end_date;
        }

        const activeSub = await client.query<{ id: number }>(
          `
          SELECT id
          FROM subscriptions
          WHERE user_id = $1 AND status = 'active'
          ORDER BY end_date DESC
          LIMIT 1;
          `,
          [dbUserId]
        );
        const activeSubId = activeSub.rows[0]?.id;

        if (!activeSubId || !endDate) {
          throw new Error('Active subscription not found after payment');
        }

        await client.query(
          `
          UPDATE vpn_keys
          SET is_active = FALSE
          WHERE user_id = $1;
          `,
          [dbUserId]
        );

        const clientUuid = randomUUID();
        vlessKey = buildVlessLink(clientUuid);

        await client.query(
          `
          INSERT INTO vpn_keys (user_id, subscription_id, server_id, key_uri, key_hash, device_name, created_at, expires_at, is_active)
          VALUES ($1, $2, NULL, $3, $4, $5, NOW(), $6, TRUE);
          `,
          [
            dbUserId,
            activeSubId,
            vlessKey ?? `pending://xray-config-required/${clientUuid}`,
            clientUuid,
            'Telegram Device',
            endDate,
          ]
        );

        await applyReferralReward(client, dbUserId);

        await client.query(
          `
          INSERT INTO payments (user_id, subscription_id, amount, currency, status, provider, external_payment_id, paid_at, metadata)
          VALUES ($1, $2, $3, $4, 'paid', 'telegram_stars', $5, NOW(), $6::jsonb);
          `,
          [
            dbUserId,
            activeSubId,
            paymentInfo.total_amount,
            paymentInfo.currency,
            paymentInfo.telegram_payment_charge_id ?? null,
            JSON.stringify({ payload, months, telegramUserId: userId }),
          ]
        );

        await client.query('COMMIT');
      } catch (dbError) {
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }
      
      // Send a thank you message to the user
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const expiryLabel = endDate ? new Date(endDate).toLocaleDateString('ru-RU') : '—';
      const keyMessage = vlessKey
        ? `\n\n🔑 <b>Ваш VLESS ключ:</b>\n<code>${escapeHtml(vlessKey)}</code>`
        : '\n\n⚠️ Ключ создан в базе, но не выдан: заполните XRAY_* переменные окружения на сервере.';

      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: update.message.chat.id,
          parse_mode: 'HTML',
          text: `Спасибо за оплату! Подписка активирована до <b>${expiryLabel}</b>. 🎉${keyMessage}`,
        }),
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
