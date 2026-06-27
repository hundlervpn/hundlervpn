import type { Pool } from 'pg';
import {
  activateSubscriptionForDays,
  applyReferralReward,
  deactivateExpiredAccess,
  ensureNamedPlan,
  ensureVpnKey,
} from '@/lib/access';
import { applyReferralCashReward } from '@/lib/referral-cash';
import { syncRemnawaveUser } from '@/lib/remnawave-sync';
import { getSubscriptionUrl } from '@/lib/sub-token';

export type SbpPaymentRow = {
  id: number;
  user_id: number;
  status: string;
  metadata: Record<string, unknown> | null;
};

export type ConfirmSbpPaymentResult = {
  activated: boolean;
  subscriptionId?: number;
  endDate?: Date;
  days?: number;
};

/**
 * Runs the full SBP "payment confirmed" flow in a single DB transaction:
 *  - deactivate expired access for user
 *  - ensure Premium plan for the purchased duration
 *  - extend or create subscription
 *  - ensure vpn_key for that subscription
 *  - apply referral reward
 *  - mark payments row as paid
 *
 * Safe to call multiple times for the same payment — row is locked with
 * FOR UPDATE and a second call short-circuits when status is already `paid`.
 */
export async function confirmSbpPayment(
  pool: Pool,
  payment: SbpPaymentRow,
  transactionId: string,
  amountRub: number
): Promise<ConfirmSbpPaymentResult> {
  const metadata = (payment.metadata || {}) as Record<string, unknown>;
  const days = metadata.days as number | undefined;
  const months = metadata.months as number | undefined;
  const effectiveDays =
    (typeof days === 'number' && days > 0 && days) ||
    (typeof months === 'number' && months > 0 && months * 30) ||
    30;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lock = await client.query<{ status: string }>(
      `SELECT status FROM payments WHERE id = $1 FOR UPDATE`,
      [payment.id]
    );
    if (lock.rows[0]?.status === 'paid') {
      await client.query('ROLLBACK');
      return { activated: false };
    }

    await deactivateExpiredAccess(client, payment.user_id);

    const planName = `Premium ${effectiveDays}d`;
    const planId = await ensureNamedPlan(client, {
      name: planName,
      durationDays: effectiveDays,
      price: amountRub,
      maxDevices: 3,
      trafficLimit: null,
    });
    if (!planId) {
      throw new Error('Failed to resolve subscription plan');
    }

    const activeSubscription = await activateSubscriptionForDays(client, {
      userId: payment.user_id,
      planId,
      days: effectiveDays,
    });
    const activeSubId = activeSubscription.subscriptionId;
    const endDate = activeSubscription.endDate;
    if (!activeSubId || !endDate) {
      throw new Error('Active subscription not found after payment');
    }

    await ensureVpnKey(client, {
      userId: payment.user_id,
      subscriptionId: activeSubId,
      expiresAt: endDate,
      deviceName: 'SBP Payment Device',
    });

    await applyReferralReward(client, payment.user_id, effectiveDays, payment.id);

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
          platega_status: 'CONFIRMED',
        }),
        payment.id,
      ]
    );

    // 2026-06-04: accrue 10% RUB cash on the inviter's referral wallet.
    // MUST run AFTER the UPDATE above flips status='paid' — the helper's
    // SELECT filters `status='paid'`, so calling it earlier silently
    // no-ops (credited:false) and the inviter never sees the money.
    // Day-bonus and cash-bonus are independent; RUB-only (Stars/crypto
    // skipped automatically by the helper).
    await applyReferralCashReward(client, payment.user_id, payment.id);

    await client.query('COMMIT');

    // Reconcile Remnawave with the freshly-extended subscription (best-effort,
    // post-COMMIT — must not fail an already-credited payment).
    await syncRemnawaveUser(payment.user_id, 'sbp-payment');

    console.log(
      `SBP payment confirmed: user=${payment.user_id}, days=${effectiveDays}, sub=${activeSubId}, payment=${payment.id}`
    );

    return {
      activated: true,
      subscriptionId: activeSubId,
      endDate,
      days: effectiveDays,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Per-bot Telegram notification routing (added 2026-05-07).
 *
 * Users can pay from EITHER the Mini-App-launcher bot (`hundlervpnbot`,
 * env `TELEGRAM_BOT_TOKEN`) OR the chat-only bot (`hundlervpn_bot`-style,
 * env `TELEGRAM_BOT_CHAT_TOKEN`). The success notification has to be
 * delivered through the SAME bot the user paid from — otherwise the
 * message lands in the wrong DM thread and the user thinks the payment
 * silently failed. The bot client tags the payment by writing
 * `metadata.notifyVia = 'chat'` (or `'main'`) at create time; this
 * function reads that tag back and picks the matching token.
 *
 * Falls back to `TELEGRAM_BOT_TOKEN` whenever the chat-bot token is not
 * configured, so the existing Mini-App-only deploys keep working.
 */
type NotifyVia = 'main' | 'chat';

function pickNotifyToken(notifyVia: NotifyVia | undefined): string | null {
  if (notifyVia === 'chat') {
    const t = (process.env.TELEGRAM_BOT_CHAT_TOKEN || '').trim();
    if (t) return t;
    // Hard fallback — if the chat-bot token isn't set on the server we
    // still want the user to receive SOME notification rather than none.
  }
  const main = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  return main || null;
}

/** Format a UTC end-date in Moscow time so all three surfaces (Mini App,
 *  chat bot, and this notification) agree on the displayed day. Falls
 *  back to the host's locale formatting if Intl can't honour the time
 *  zone (extremely unlikely on Node ≥18, but defensive anyway).
 *
 *  Deploy-trigger note 2026-05-07: re-pushed because the previous Hostman
 *  build hung. No behavioural change in this commit. */
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

/**
 * Sends a "payment confirmed" message to the user via Telegram with their
 * expiry date and subscription URL. Silently no-ops for non-Telegram users
 * or when no bot token is configured. The message uses Bot API 9.4
 * `<tg-emoji>` tags so Premium clients render the brand-styled animated
 * icons — non-Premium clients see the plain Unicode emoji as a fallback.
 */
export async function notifySbpSuccessViaTelegram(
  pool: Pool,
  dbUserId: number
): Promise<void> {
  try {
    const userResult = await pool.query<{ telegram_id: number | null }>(
      'SELECT telegram_id FROM users WHERE id = $1 LIMIT 1',
      [dbUserId]
    );
    const telegramId = userResult.rows[0]?.telegram_id;
    if (!telegramId) return;

    // Read the tag the bot client wrote at payment-create time so we can
    // route the notification through the matching bot token. We pull
    // from the most recent `paid` payment for this user so the call is
    // robust even when the caller has not threaded the metadata through.
    const paymentMeta = await pool.query<{ metadata: Record<string, unknown> | null }>(
      `SELECT metadata
       FROM payments
       WHERE user_id = $1 AND status = 'paid'
       ORDER BY id DESC
       LIMIT 1`,
      [dbUserId]
    );
    const meta = (paymentMeta.rows[0]?.metadata || {}) as Record<string, unknown>;
    const notifyVia: NotifyVia = meta.notifyVia === 'chat' ? 'chat' : 'main';
    const botToken = pickNotifyToken(notifyVia);
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
    // The literal inside `<tg-emoji>` MUST be the actual link emoji
    // (U+1F517 \uD83D\uDD17). An earlier edit corrupted it to U+FFFD
    // (replacement char) which silently broke ALL payment success
    // notifications — Telegram rejects messages whose `<tg-emoji>`
    // inner text doesn't match the referenced custom-emoji glyph.
    // Symptom 2026-05-07: «не отправляются сообщения после успешной
    // оплаты, ни должны как в мини апп бота отправляться так и в чат
    // бота». Restored using \u escape so any future re-encoding keeps
    // the byte sequence intact.
    const subMessage = subUrl
      ? `\n\n<tg-emoji emoji-id="6028171274939797252">\u{1F517}</tg-emoji> <b>Ссылка для подключения:</b>\n<code>${subUrl}</code>`
      : '';

    const text =
      `<tg-emoji emoji-id="5774022692642492953">✅</tg-emoji> ` +
      `<b>Оплата через СБП прошла успешно!</b>\n\n` +
      `Подписка активирована до <b>${expiryLabel}</b> ` +
      `<tg-emoji emoji-id="6041731551845159060">🎉</tg-emoji>` +
      subMessage;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        text,
      }),
    });
  } catch (err) {
    console.error('Failed to notify user via Telegram:', err);
  }
}