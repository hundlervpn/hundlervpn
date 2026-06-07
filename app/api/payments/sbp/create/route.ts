import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { createSbpTransaction } from '@/lib/platega';
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
      // 2026-05-07: per-bot routing fields. The chat-only bot writes
      // `notifyVia: 'chat'` + `botUsername: '<chat-bot-username>'` so
      // (a) the post-payment redirect lands the user back in the chat
      // bot's DM rather than the Mini App, and (b) the success
      // notification is delivered via TELEGRAM_BOT_CHAT_TOKEN. The
      // Mini App + everywhere else omits both → defaults reproduce
      // the pre-2026-05-07 behaviour.
      botUsername: rawBotUsername,
      notifyVia: rawNotifyVia,
    } = body;
    const effectiveDays = days || (months ? months * 30 : 0);

    // Telegram bot usernames are 5-32 chars, [a-zA-Z0-9_], must not start
    // with a digit, and must end with `bot`/`Bot` per BotFather rules.
    // We sanitise here to prevent open-redirect via crafted return URLs.
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

    const pool = getDbPool();

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
    // `days` + applicable promo discount, using the same auto-discount
    // tiers as the mini-app and chat-bot (lib/pricing.ts).
    //   - 6 months  (180 ≤ days < 365)  → 10 % off automatically
    //   - 1 year+   (days ≥ 365)        → 15 % off automatically
    //   - Promo % stacks multiplicatively on top of the duration discount.
    const pricing = calculatePricing(effectiveDays, promoDiscountPct);
    const serverAmount = pricing.finalTotal;
    if (typeof amount === 'number' && Math.abs(amount - serverAmount) > 1) {
      console.warn(
        `[sbp/create] amount mismatch: client=${amount}\u20bd server=${serverAmount}\u20bd ` +
        `days=${effectiveDays} promo=${promoDiscountPct}% \u2192 using server-computed`
      );
    }

    const paymentResult = await pool.query<{ id: number }>(
      `INSERT INTO payments (user_id, amount, currency, status, provider, metadata)
       VALUES ($1, $2, 'RUB', 'pending', 'platega_sbp', $3::jsonb)
       RETURNING id`,
      [
        dbUserId,
        serverAmount,
        JSON.stringify({
          days: effectiveDays,
          telegramId: telegramId ?? null,
          promoId: promoId ?? null,
          promoCode: promoCode ?? null,
          // Stored so /lib/sbp-confirm.ts can pick the matching bot
          // token + format on confirmation, AND so admin-recovery later
          // re-runs the notification through the right bot. Defaults
          // to `main` for backwards compatibility.
          botUsername,
          notifyVia,
        }),
      ]
    );
    const paymentId = paymentResult.rows[0].id;

    // Сразу записываем использование промокода при создании платежа
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

    // For Telegram users, return them straight back into the Telegram bot
    // they came from. For web/email users, stay on the site.
    //   - notifyVia='main' (Mini-App-launcher bot) → use `?startapp=paid_X`
    //     so Telegram opens the Mini App directly with the promo / payment
    //     param.
    //   - notifyVia='chat' (chat-only bot, no Mini App attached) → use
    //     `?start=paid_X` which behaves like a regular `/start paid_X`
    //     deep-link inside the chat thread (the chat bot's start handler
    //     parses these args). Without this branch the chat bot user lands
    //     on the SISTER bot's Mini App instead of being returned to the
    //     chat thread they paid from.
    const backToTelegram = Boolean(telegramId);
    const startKey = notifyVia === 'chat' ? 'start' : 'startapp';
    const returnUrl = backToTelegram
      ? `https://t.me/${botUsername}?${startKey}=paid_${paymentId}`
      : `${appUrl}?sbp_payment=success&paymentId=${paymentId}`;
    const failedUrl = backToTelegram
      ? `https://t.me/${botUsername}?${startKey}=sbp_failed_${paymentId}`
      : `${appUrl}?sbp_payment=failed&paymentId=${paymentId}`;

    const transaction = await createSbpTransaction({
      amount: serverAmount,
      description: `Hundler VPN Premium ${effectiveDays} дн.`,
      returnUrl,
      failedUrl,
      payload: JSON.stringify({ paymentId, userId: dbUserId, days: effectiveDays }),
    });

    await pool.query(
      `UPDATE payments SET external_payment_id = $1 WHERE id = $2`,
      [transaction.transactionId, paymentId]
    );

    return NextResponse.json({
      ok: true,
      paymentId,
      transactionId: transaction.transactionId,
      redirect: transaction.redirect,
      expiresIn: transaction.expiresIn,
    });
  } catch (error) {
    console.error('SBP payment create error:', error);
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}
