import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { getSubscriptionUrl } from '@/lib/sub-token';
import {
  activateSubscriptionForMonths,
  applyReferralReward,
  deactivateExpiredAccess,
  ensureNamedPlan,
  ensureVpnKey,
  upsertTelegramUser,
} from '@/lib/access';

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

        const syncedUser = await upsertTelegramUser(client, {
          telegramId: userId,
          username,
          firstName,
          lastName,
        });

        await deactivateExpiredAccess(client, syncedUser.userId);
        const dbUserId = syncedUser.userId;

        const planName = `Premium ${months}m`;
        const planId = await ensureNamedPlan(client, {
          name: planName,
          durationDays: months * 30,
          price: Number(paymentInfo.total_amount),
          maxDevices: 3,
          trafficLimit: null,
        });

        if (!planId) {
          throw new Error('Failed to resolve subscription plan');
        }

        const activeSubscription = await activateSubscriptionForMonths(client, {
          userId: dbUserId,
          planId,
          months,
        });
        const activeSubId = activeSubscription.subscriptionId;
        endDate = activeSubscription.endDate;

        if (!activeSubId || !endDate) {
          throw new Error('Active subscription not found after payment');
        }

        const issuedKey = await ensureVpnKey(client, {
          userId: dbUserId,
          subscriptionId: activeSubId,
          expiresAt: endDate,
          deviceName: 'Telegram Device',
        });
        vlessKey = issuedKey.keyUri;

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
      const subUrl = getSubscriptionUrl(userId);
      const subMessage = subUrl
        ? `\n\n📡 <b>Ссылка на подписку (вставьте в VPN-клиент):</b>\n<code>${escapeHtml(subUrl)}</code>`
        : '';
      const keyMessage = vlessKey
        ? `\n\n🔑 <b>Ваш VLESS ключ:</b>\n<code>${escapeHtml(vlessKey)}</code>${subMessage}`
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
