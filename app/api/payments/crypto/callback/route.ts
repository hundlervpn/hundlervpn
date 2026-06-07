import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { getDbPool } from '@/lib/db';
import { getSubscriptionUrl } from '@/lib/sub-token';
import {
  activateSubscriptionForDays,
  applyReferralReward,
  deactivateExpiredAccess,
  ensureNamedPlan,
  ensureVpnKey,
} from '@/lib/access';
import { applyReferralCashReward } from '@/lib/referral-cash';

// OxaPay требует вернуть просто "ok" с HTTP 200
function okResponse() {
  return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

function errorResponse(message: string, status: number = 400) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(req: Request) {
  try {
    // Читаем raw body для HMAC валидации
    const rawBody = await req.text();
    const body = JSON.parse(rawBody);
    
    // HMAC валидация (опционально, но рекомендуется)
    const hmacHeader = req.headers.get('hmac') || req.headers.get('HMAC');
    const apiKey = process.env.OXAPAY_API_KEY;
    
    if (apiKey && hmacHeader) {
      const calculatedHmac = createHmac('sha512', apiKey).update(rawBody).digest('hex');
      if (calculatedHmac !== hmacHeader) {
        console.error('OxaPay callback: Invalid HMAC signature');
        return errorResponse('Invalid HMAC signature', 401);
      }
    }
    
    // OxaPay отправляет поля в snake_case
    const status = body.status; // "Paying", "Paid", etc. (с большой буквы!)
    const trackId = body.track_id;
    const orderId = body.order_id;
    const amount = body.amount;
    const currency = body.currency;

    console.log('OxaPay callback received:', rawBody);
    console.log('Parsed callback data:', { status, trackId, orderId, amount, currency });

    // OxaPay статусы (с большой буквы): Paying, Paid, Expired, etc.
    if (!trackId || !status) {
      console.error('OxaPay callback: missing trackId or status');
      return errorResponse('Invalid callback body');
    }

    const pool = getDbPool();

    // Найти платёж по trackId
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
      [trackId]
    );

    const payment = paymentResult.rows[0];
    if (!payment) {
      console.error('OxaPay callback: payment not found for trackId', trackId);
      return okResponse();
    }

    // Если уже оплачен - игнорируем
    if (payment.status === 'paid') {
      console.log('OxaPay callback: payment already paid, ignoring');
      return okResponse();
    }

    const meta = payment.metadata as Record<string, unknown>;
    const effectiveDays = (meta?.days as number) || (meta?.months ? (meta.months as number) * 30 : 30);
    const promoId = meta?.promoId as number | null;
    const dbUserId = payment.user_id;

    // OxaPay статусы с большой буквы: "Paid", "Paying", "Expired"
    const statusLower = status.toLowerCase();
    
    if (statusLower === 'paid') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await deactivateExpiredAccess(client, dbUserId);

        const planName = `Premium ${effectiveDays}d`;
        const planId = await ensureNamedPlan(client, {
          name: planName,
          durationDays: effectiveDays,
          price: amount,
          maxDevices: 3,
          trafficLimit: null,
        });

        if (!planId) {
          throw new Error('Failed to resolve subscription plan');
        }

        const activeSubscription = await activateSubscriptionForDays(
          client,
          {
            userId: dbUserId,
            planId,
            days: effectiveDays,
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
          deviceName: 'Crypto Payment Device',
        });

        await applyReferralReward(client, dbUserId, effectiveDays, payment.id);

        // Промокод уже записан как использованный при создании инвойса

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
              oxapay_track_id: trackId,
              oxapay_status: status,
              oxapay_raw: body,
            }),
            payment.id,
          ]
        );

        // Accrue 10% RUB cash on the inviter's referral wallet. MUST run
        // AFTER the UPDATE above flips status='paid' — the helper's SELECT
        // filters `status='paid'`, so calling it earlier silently no-ops
        // (credited:false) and the inviter never sees the money. OxaPay
        // invoices are stored with currency='RUB' (see crypto-invoice
        // route), so the helper credits; non-RUB rows are skipped. Mirrors
        // lib/sbp-confirm.ts. Idempotent via UNIQUE(payment_id).
        await applyReferralCashReward(client, dbUserId, payment.id);

        await client.query('COMMIT');

        console.log(
          `Crypto payment confirmed: user=${dbUserId}, days=${effectiveDays}, sub=${activeSubId}`
        );
      } catch (dbError) {
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }

      await notifyUserViaTelegram(pool, dbUserId);
    } else if (statusLower === 'expired' || statusLower === 'underpaid' || statusLower === 'refunded' || statusLower === 'failed') {
      await pool.query(
        `UPDATE payments
         SET status = 'failed',
             metadata = metadata || $1::jsonb
         WHERE id = $2`,
        [
          JSON.stringify({
            oxapay_track_id: trackId,
            oxapay_status: status,
            oxapay_raw: body,
          }),
          payment.id,
        ]
      );

      console.log(
        `Crypto payment ${status}: user=${dbUserId}, trackId=${trackId}`
      );
    } else {
      // Paying, Confirming, etc. - просто обновляем метаданные
      await pool.query(
        `UPDATE payments
         SET metadata = metadata || $1::jsonb
         WHERE id = $2`,
        [
          JSON.stringify({
            oxapay_track_id: trackId,
            oxapay_status: status,
            oxapay_raw: body,
          }),
          payment.id,
        ]
      );
      
      console.log(`Crypto payment status update: ${status}, trackId=${trackId}`);
    }

    return okResponse();
  } catch (error) {
    console.error('OxaPay callback error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// Per-bot Telegram routing (added 2026-05-07) — same logic as
// `lib/sbp-confirm.ts:notifySbpSuccessViaTelegram`. See that file for
// the rationale; the notification goes through whichever bot the user
// originally paid from (`metadata.notifyVia`), with `<tg-emoji>` premium
// icons + Moscow-time expiry to stay in sync with the Mini App.
function pickCryptoNotifyToken(notifyVia: 'main' | 'chat'): string | null {
  if (notifyVia === 'chat') {
    const t = (process.env.TELEGRAM_BOT_CHAT_TOKEN || '').trim();
    if (t) return t;
  }
  const main = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  return main || null;
}

function formatExpiryMsk(endDate: Date): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(endDate);
  } catch {
    return endDate.toLocaleDateString('ru-RU');
  }
}

async function notifyUserViaTelegram(
  pool: ReturnType<typeof getDbPool>,
  dbUserId: number
) {
  try {
    const userResult = await pool.query<{ telegram_id: number | null }>(
      'SELECT telegram_id FROM users WHERE id = $1 LIMIT 1',
      [dbUserId]
    );
    const telegramId = userResult.rows[0]?.telegram_id;
    if (!telegramId) return;

    const paymentMeta = await pool.query<{ metadata: Record<string, unknown> | null }>(
      `SELECT metadata
       FROM payments
       WHERE user_id = $1 AND status = 'paid'
       ORDER BY id DESC
       LIMIT 1`,
      [dbUserId]
    );
    const meta = (paymentMeta.rows[0]?.metadata || {}) as Record<string, unknown>;
    const notifyVia: 'main' | 'chat' = meta.notifyVia === 'chat' ? 'chat' : 'main';
    const botToken = pickCryptoNotifyToken(notifyVia);
    if (!botToken) return;

    const subResult = await pool.query<{ end_date: Date }>(
      `SELECT end_date
       FROM subscriptions
       WHERE user_id = $1 AND status = 'active'
       ORDER BY end_date DESC
       LIMIT 1`,
      [dbUserId]
    );
    const endDate = subResult.rows[0]?.end_date;
    const expiryLabel = endDate ? formatExpiryMsk(new Date(endDate)) : '—';

    const subUrl = getSubscriptionUrl(telegramId);
    // 🔗 (U+1F517) — see `lib/sbp-confirm.ts` for the matching incident
    // note. Using \u escape so the byte sequence survives re-encoding.
    const subMessage = subUrl
      ? `\n\n<tg-emoji emoji-id="6028171274939797252">\u{1F517}</tg-emoji> <b>Ссылка для подключения:</b>\n<code>${subUrl}</code>`
      : '';

    const text =
      `<tg-emoji emoji-id="5774022692642492953">✅</tg-emoji> ` +
      `<b>Крипто-оплата прошла успешно!</b>\n\n` +
      `Подписка активирована до <b>${expiryLabel}</b> ` +
      `<tg-emoji emoji-id="6041731551845159060">🎉</tg-emoji>` +
      subMessage;

    await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramId,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          text,
        }),
      }
    );
  } catch (err) {
    console.error('Failed to notify user via Telegram:', err);
  }
}
