import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { getSubscriptionUrl } from '@/lib/sub-token';
import { verifyCallbackHeaders } from '@/lib/platega';
import {
  activateSubscriptionForMonths,
  applyReferralReward,
  deactivateExpiredAccess,
  ensureNamedPlan,
  ensureVpnKey,
} from '@/lib/access';

export async function POST(req: Request) {
  try {
    const merchantId =
      req.headers.get('x-merchantid') ||
      req.headers.get('X-MerchantId') ||
      '';
    const secret =
      req.headers.get('x-secret') || req.headers.get('X-Secret') || '';

    if (!verifyCallbackHeaders(merchantId, secret)) {
      console.error('SBP callback: invalid credentials');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      id: transactionId,
      amount,
      currency,
      status,
      paymentMethod,
      payload: rawPayload,
    } = body;

    console.log('SBP callback received:', { transactionId, status, amount, currency, paymentMethod });

    if (!transactionId || !status) {
      return NextResponse.json(
        { error: 'Invalid callback body' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    const paymentResult = await pool.query<{
      id: number;
      user_id: number;
      status: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, user_id, status, metadata
       FROM payments
       WHERE external_payment_id = $1
       LIMIT 1`,
      [transactionId]
    );

    const payment = paymentResult.rows[0];
    if (!payment) {
      console.error(
        'SBP callback: payment not found for transaction',
        transactionId
      );
      return NextResponse.json({ ok: true });
    }

    if (payment.status === 'paid') {
      return NextResponse.json({ ok: true });
    }

    let payloadData: {
      paymentId?: number;
      userId?: number;
      months?: number;
    } = {};
    try {
      payloadData = rawPayload ? JSON.parse(rawPayload) : {};
    } catch {
      payloadData = {};
    }

    const months =
      payloadData.months ||
      (payment.metadata as Record<string, unknown>)?.months ||
      1;
    const promoId = (payment.metadata as Record<string, unknown>)?.promoId as number | null;
    const dbUserId = payment.user_id;

    if (status === 'CONFIRMED') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await deactivateExpiredAccess(client, dbUserId);

        const planName = `Premium ${months}m`;
        const planId = await ensureNamedPlan(client, {
          name: planName,
          durationDays: (months as number) * 30,
          price: amount,
          maxDevices: 3,
          trafficLimit: null,
        });

        if (!planId) {
          throw new Error('Failed to resolve subscription plan');
        }

        const activeSubscription = await activateSubscriptionForMonths(
          client,
          {
            userId: dbUserId,
            planId,
            months: months as number,
          }
        );

        const activeSubId = activeSubscription.subscriptionId;
        const endDate = activeSubscription.endDate;

        if (!activeSubId || !endDate) {
          throw new Error('Active subscription not found after payment');
        }

        await ensureVpnKey(client, {
          userId: dbUserId,
          subscriptionId: activeSubId,
          expiresAt: endDate,
          deviceName: 'SBP Payment Device',
        });

        await applyReferralReward(client, dbUserId);

        // Записываем использование промокода если был применён
        if (promoId) {
          await client.query(
            `INSERT INTO promo_code_uses (promo_code_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (promo_code_id, user_id) DO NOTHING`,
            [promoId, dbUserId]
          );
          await client.query(
            `UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1`,
            [promoId]
          );
        }

        await client.query(
          `UPDATE payments
           SET status = 'paid',
               paid_at = NOW(),
               subscription_id = $1,
               metadata = metadata || $2::jsonb
           WHERE id = $3`,
          [
            activeSubId,
            JSON.stringify({
              platega_transaction_id: transactionId,
              platega_status: status,
            }),
            payment.id,
          ]
        );

        await client.query('COMMIT');

        console.log(
          `SBP payment confirmed: user=${dbUserId}, months=${months}, sub=${activeSubId}`
        );
      } catch (dbError) {
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }

      await notifyUserViaTelegram(pool, dbUserId);
    } else if (status === 'CANCELED' || status === 'CHARGEBACKED') {
      await pool.query(
        `UPDATE payments
         SET status = 'failed',
             metadata = metadata || $1::jsonb
         WHERE id = $2`,
        [
          JSON.stringify({
            platega_transaction_id: transactionId,
            platega_status: status,
          }),
          payment.id,
        ]
      );

      console.log(
        `SBP payment ${status.toLowerCase()}: user=${dbUserId}, transaction=${transactionId}`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('SBP callback error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function notifyUserViaTelegram(
  pool: ReturnType<typeof getDbPool>,
  dbUserId: number
) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return;

    const userResult = await pool.query<{ telegram_id: number | null }>(
      'SELECT telegram_id FROM users WHERE id = $1 LIMIT 1',
      [dbUserId]
    );
    const telegramId = userResult.rows[0]?.telegram_id;
    if (!telegramId) return;

    const subResult = await pool.query<{ end_date: Date }>(
      `SELECT end_date
       FROM subscriptions
       WHERE user_id = $1 AND status = 'active'
       ORDER BY end_date DESC
       LIMIT 1`,
      [dbUserId]
    );
    const endDate = subResult.rows[0]?.end_date;
    const expiryLabel = endDate
      ? new Date(endDate).toLocaleDateString('ru-RU')
      : '—';

    const subUrl = getSubscriptionUrl(telegramId);
    const subMessage = subUrl
      ? `\n\n📡 <b>Ссылка на подписку:</b>\n<code>${subUrl}</code>`
      : '';

    await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramId,
          parse_mode: 'HTML',
          text: `✅ Оплата через СБП прошла успешно!\n\nПодписка активирована до <b>${expiryLabel}</b>. 🎉${subMessage}`,
        }),
      }
    );
  } catch (err) {
    console.error('Failed to notify user via Telegram:', err);
  }
}
