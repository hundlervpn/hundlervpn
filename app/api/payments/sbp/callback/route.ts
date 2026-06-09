import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { getTransactionStatus, verifyCallbackHeaders } from '@/lib/platega';
import {
  confirmSbpPayment,
  notifySbpSuccessViaTelegram,
} from '@/lib/sbp-confirm';
import { accrueReferralCashStandalone } from '@/lib/referral-cash';

export async function POST(req: Request) {
  // Read body up-front so we can log it on auth failures and recover the
  // transaction id even when header-based auth fails.
  let bodyText = '';
  try {
    bodyText = await req.text();
  } catch {
    bodyText = '';
  }

  // Log every callback (auth-failure or not) so we have permanent telemetry
  // about what Platega actually sends. This is critical for diagnosing the
  // header-name drift that caused payments to silently fail in the past.
  const allHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => { allHeaders[k] = v; });
  console.log('[sbp/callback] inbound', {
    bodyLen: bodyText.length,
    headerKeys: Object.keys(allHeaders),
    bodyPreview: bodyText.slice(0, 500),
  });

  let body: Record<string, unknown> = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch (e) {
    console.error('[sbp/callback] invalid JSON body', e);
    // Still return 200 so Platega does not pile up retries on malformed bodies.
    return NextResponse.json({ ok: true, error: 'invalid_json' });
  }

  try {
    const merchantId =
      req.headers.get('x-merchantid') ||
      req.headers.get('X-MerchantId') ||
      req.headers.get('x-merchant-id') ||
      req.headers.get('X-Merchant-Id') ||
      req.headers.get('merchant-id') ||
      '';
    const secret =
      req.headers.get('x-secret') ||
      req.headers.get('X-Secret') ||
      req.headers.get('x-api-key') ||
      req.headers.get('X-Api-Key') ||
      '';

    const headersValid = verifyCallbackHeaders(merchantId, secret);
    if (!headersValid) {
      console.warn(
        '[sbp/callback] header auth failed — will verify via Platega API instead',
        {
          gotMerchantId: merchantId ? `${merchantId.slice(0, 8)}…` : null,
          gotSecretLen: secret.length,
          headerKeys: Object.keys(allHeaders),
        }
      );
    }

    const {
      id: transactionId,
      amount: bodyAmount,
      currency,
      status: bodyStatus,
      paymentMethod,
      payload: rawPayload,
    } = body as Record<string, unknown>;

    if (!transactionId || typeof transactionId !== 'string') {
      console.error('[sbp/callback] missing transaction id in body');
      return NextResponse.json({ ok: true, error: 'no_transaction_id' });
    }

    // SOURCE OF TRUTH: pull the real status from Platega's own API using
    // OUR outbound credentials (which are known-good — they work for
    // create-transaction). This eliminates the entire class of bugs where
    // inbound webhook headers don't match what our code expects, AND
    // protects against forged callbacks.
    let status: string = typeof bodyStatus === 'string' ? bodyStatus : 'UNKNOWN';
    let amount: number = typeof bodyAmount === 'number' ? bodyAmount : 0;
    try {
      const fresh = await getTransactionStatus(transactionId);
      status = fresh.status;
      amount = fresh.paymentDetails?.amount ?? amount;
      console.log('[sbp/callback] verified via Platega API', {
        transactionId, status, amount, headersValid,
      });
    } catch (e) {
      console.error('[sbp/callback] Platega API verify failed; falling back to body', {
        transactionId, bodyStatus, error: (e as Error).message,
      });
      // If we couldn't verify and headers were also invalid → reject. We have
      // no trustworthy signal that this callback is real.
      if (!headersValid) {
        return NextResponse.json({ ok: true, error: 'verify_failed' });
      }
      // Otherwise trust the body since headers matched the known secret.
    }

    console.log('[sbp/callback] processing', { transactionId, status, amount, currency, paymentMethod });

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

    let payloadData: { type?: string } = {};
    try {
      payloadData = (typeof rawPayload === 'string' && rawPayload)
        ? JSON.parse(rawPayload)
        : {};
    } catch {
      payloadData = {};
    }

    const metadata = (payment.metadata || {}) as Record<string, unknown>;
    const isFragmentOrder =
      metadata?.type === 'fragment_order' ||
      payloadData.type === 'fragment_order';
    const dbUserId = payment.user_id;

    if (status === 'CONFIRMED') {
      // Handle Fragment order (Stars/Premium) — separate flow
      if (isFragmentOrder) {
        await handleFragmentOrderConfirmed(pool, payment.id, dbUserId, transactionId, metadata);
        return NextResponse.json({ ok: true });
      }

      const outcome = await confirmSbpPayment(
        pool,
        {
          id: payment.id,
          user_id: payment.user_id,
          status: payment.status,
          metadata: payment.metadata,
        },
        transactionId,
        amount
      );

      if (outcome.activated) {
        await notifySbpSuccessViaTelegram(pool, dbUserId);
      }
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

const ADMIN_TELEGRAM_IDS = [2029065770, 1483598839];

async function handleFragmentOrderConfirmed(
  pool: ReturnType<typeof getDbPool>,
  paymentId: number,
  dbUserId: number,
  transactionId: string,
  metadata: Record<string, unknown>
) {
  const fragmentOrderId = metadata?.fragmentOrderId as number | null;
  
  // Update payment status
  await pool.query(
    `UPDATE payments
     SET status = 'paid',
         paid_at = NOW(),
         metadata = metadata || $1::jsonb
     WHERE id = $2`,
    [
      JSON.stringify({
        platega_transaction_id: transactionId,
        platega_status: 'CONFIRMED',
      }),
      paymentId,
    ]
  );

  // Accrue the inviter's 10% referral cash on this RUB fragment-order
  // payment (Stars/Premium top-ups). Runs AFTER the status='paid' flip
  // above. No-op for non-referred users; idempotent per payment_id.
  await accrueReferralCashStandalone(pool, dbUserId, paymentId);

  // Update fragment order status
  if (fragmentOrderId) {
    await pool.query(
      `UPDATE fragment_orders SET status = 'paid' WHERE id = $1`,
      [fragmentOrderId]
    );
  }

  // Get order details for notification
  const orderResult = await pool.query<{
    product_type: string;
    period: string;
    stars_amount: number | null;
    price_rub: string;
    telegram_username: string | null;
  }>(
    `SELECT product_type, period, stars_amount, price_rub, telegram_username 
     FROM fragment_orders WHERE id = $1`,
    [fragmentOrderId]
  );
  const order = orderResult.rows[0];

  // Get user info
  const userResult = await pool.query<{ telegram_id: number | null; username: string | null; first_name: string | null }>(
    'SELECT telegram_id, username, first_name FROM users WHERE id = $1 LIMIT 1',
    [dbUserId]
  );
  const user = userResult.rows[0];

  // Notify user
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken && user?.telegram_id) {
    const productLabel = order?.product_type === 'stars'
      ? `${order.stars_amount} Telegram Stars`
      : `Telegram Premium (${order?.period?.replace('_', ' ')})`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.telegram_id,
        parse_mode: 'HTML',
        text: `✅ Оплата прошла успешно!\n\n<b>Заказ:</b> ${productLabel}\n<b>Сумма:</b> ${order?.price_rub} ₽\n\nМы обработаем ваш заказ в ближайшее время и отправим вам уведомление. 🎉`,
      }),
    });
  }

  // Notify admins
  if (botToken) {
    const productLabel = order?.product_type === 'stars'
      ? `${order.stars_amount} ⭐️ Stars`
      : `Premium (${order?.period?.replace('_', ' ')})`;
    
    const userName = user?.first_name || user?.username || `ID: ${dbUserId}`;
    const tgUsername = order?.telegram_username || user?.username;

    for (const adminId of ADMIN_TELEGRAM_IDS) {
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: adminId,
            parse_mode: 'HTML',
            text: `🛒 <b>Новый заказ Fragment!</b>\n\n` +
              `👤 <b>От:</b> ${userName}${tgUsername ? ` (@${tgUsername})` : ''}\n` +
              `📦 <b>Товар:</b> ${productLabel}\n` +
              `💰 <b>Сумма:</b> ${order?.price_rub} ₽\n` +
              `🆔 <b>Заказ #${fragmentOrderId}</b>\n\n` +
              `Отправьте товар пользователю и отметьте заказ как выполненный в админке.`,
          }),
        });
      } catch (err) {
        console.error(`Failed to notify admin ${adminId}:`, err);
      }
    }
  }

  console.log(`Fragment order confirmed: orderId=${fragmentOrderId}, user=${dbUserId}`);
}

