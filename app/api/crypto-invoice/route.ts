import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { calculatePricing } from '@/lib/pricing';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      days,
      months,
      amount,
      telegramId,
      userId,
      promoId,
      promoCode,
      // 2026-05-07: per-bot routing — same shape as /api/payments/sbp/create.
      // Chat-only bot writes `notifyVia: 'chat'` so the success notification
      // is delivered via TELEGRAM_BOT_CHAT_TOKEN and the OxaPay return URL
      // doesn't lose the user in the Mini App. Mini App + everywhere else
      // omits both → defaults reproduce the legacy behaviour.
      botUsername: rawBotUsername,
      notifyVia: rawNotifyVia,
    } = body;
    const effectiveDays = days || (months ? months * 30 : 0);

    const isSafeBotUsername = (s: unknown): s is string =>
      typeof s === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{2,30}[a-zA-Z0-9]$/.test(s);
    const notifyVia: 'main' | 'chat' = rawNotifyVia === 'chat' ? 'chat' : 'main';
    const botUsername = isSafeBotUsername(rawBotUsername)
      ? rawBotUsername
      : (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'hundlervpnbot');

    if (!effectiveDays) {
      return NextResponse.json(
        { error: 'days is required' },
        { status: 400 }
      );
    }

    if (!telegramId && !userId) {
      return NextResponse.json(
        { error: 'telegramId or userId is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OXAPAY_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OxaPay API ключ не настроен (OXAPAY_API_KEY)' },
        { status: 500 }
      );
    }

    const pool = getDbPool();

    // Найти пользователя
    const userQuery = telegramId
      ? 'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1'
      : 'SELECT id FROM users WHERE id = $1 LIMIT 1';
    const userResult = await pool.query<{ id: number }>(
      userQuery,
      [telegramId ?? userId]
    );

    const dbUserId = userResult.rows[0]?.id;
    if (!dbUserId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Проверить что промокод ещё не использован этим пользователем,
    // и заодно подтянуть его discount_percent для серверного пересчёта
    // суммы (нельзя доверять клиентскому `amount`).
    let promoDiscountPct = 0;
    if (promoId) {
      const promoUsed = await pool.query(
        `SELECT 1 FROM promo_code_uses WHERE promo_code_id = $1 AND user_id = $2 LIMIT 1`,
        [promoId, dbUserId]
      );
      if (promoUsed.rows.length > 0) {
        return NextResponse.json(
          { error: 'Промокод уже был использован' },
          { status: 400 }
        );
      }
      const promoMeta = await pool.query<{ discount_percent: number | null }>(
        `SELECT discount_percent FROM promo_codes WHERE id = $1 LIMIT 1`,
        [promoId]
      );
      promoDiscountPct = promoMeta.rows[0]?.discount_percent ?? 0;
    }

    // SERVER-SIDE PRICE: never trust the client's `amount`. Recompute from
    // `days` + promo discount, using lib/pricing.ts (same logic as mini-app
    // and chat-bot). Auto-discount: 6mo (180-364d) → 10 %, year+ → 15 %.
    const pricing = calculatePricing(effectiveDays, promoDiscountPct);
    const serverAmount = pricing.finalTotal;
    if (typeof amount === 'number' && Math.abs(amount - serverAmount) > 1) {
      console.warn(
        `[crypto-invoice] amount mismatch: client=${amount}\u20bd server=${serverAmount}\u20bd ` +
        `days=${effectiveDays} promo=${promoDiscountPct}% \u2192 using server-computed`
      );
    }

    // Создать запись платежа в БД
    const paymentResult = await pool.query<{ id: number }>(
      `INSERT INTO payments (user_id, amount, currency, status, provider, metadata)
       VALUES ($1, $2, 'RUB', 'pending', 'oxapay_crypto', $3::jsonb)
       RETURNING id`,
      [
        dbUserId,
        serverAmount,
        JSON.stringify({
          days: effectiveDays,
          telegramId: telegramId ?? null,
          promoId: promoId ?? null,
          promoCode: promoCode ?? null,
          // Threaded through to crypto-callback's notifier — see
          // app/api/payments/crypto/callback/route.ts:notifyUserViaTelegram.
          botUsername,
          notifyVia,
        }),
      ]
    );
    const paymentId = paymentResult.rows[0].id;

    // Сразу записываем использование промокода при создании инвойса (до оплаты)
    if (promoId) {
      await pool.query(
        `INSERT INTO promo_code_uses (promo_code_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (promo_code_id, user_id) DO NOTHING`,
        [promoId, dbUserId]
      );
      await pool.query(
        `UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1`,
        [promoId]
      );
    }

    const appUrl = process.env.APP_URL || '';

    // OxaPay API v1 endpoint для создания инвойса
    const url = 'https://api.oxapay.com/v1/payment/invoice';

    // Telegram users go straight back to whichever bot they paid from
    // (same logic as SBP create — see that file for the full rationale).
    // Web/email users stay on the site.
    const backToTelegram = Boolean(telegramId);
    const startKey = notifyVia === 'chat' ? 'start' : 'startapp';
    const returnUrl = backToTelegram
      ? `https://t.me/${botUsername}?${startKey}=paid_${paymentId}`
      : `${appUrl}?crypto_payment=success&paymentId=${paymentId}`;

    const payload = {
      amount: serverAmount,
      currency: 'RUB',
      lifetime: 30,
      order_id: `vpn_${paymentId}_${effectiveDays}d`,
      description: `Hundler VPN Premium ${effectiveDays} days`,
      callback_url: `${appUrl}/api/payments/crypto/callback`,
      return_url: returnUrl,
    };

    console.log('OxaPay request payload:', JSON.stringify(payload, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'merchant_api_key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('OxaPay response:', JSON.stringify(data, null, 2));

    // API v1 возвращает status: 200 при успехе
    if (data.status === 200 && data.data?.payment_url) {
      // Сохранить track_id в БД
      await pool.query(
        `UPDATE payments SET external_payment_id = $1 WHERE id = $2`,
        [data.data.track_id, paymentId]
      );

      return NextResponse.json({ 
        ok: true,
        paymentId,
        paymentUrl: data.data.payment_url,
        trackId: data.data.track_id,
      });
    } else {
      // Отметить платёж как failed
      await pool.query(
        `UPDATE payments SET status = 'failed', metadata = metadata || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ oxapay_error: data }), paymentId]
      );

      console.error('OxaPay API Error:', data);
      return NextResponse.json(
        { error: data.message || 'Ошибка создания крипто-счета', details: data },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Crypto invoice creation error:', error);
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера', details: String(error) },
      { status: 500 }
    );
  }
}
