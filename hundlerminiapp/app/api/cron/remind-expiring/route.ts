import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

/**
 * Cron-friendly endpoint that sends ONE-TIME "your subscription expires in
 * <=24h" reminders to users via Telegram DM.
 *
 * Designed to be hit every hour by an external cron service
 * (cron-job.org, EasyCron, Timeweb panel cron, …). Running it more
 * frequently is harmless — the `subscription_reminders` table has a
 * `UNIQUE(subscription_id, kind)` constraint that prevents duplicate
 * sends no matter how often this endpoint fires.
 *
 * Who receives a reminder:
 *   - subscriptions.status = 'active'
 *   - subscriptions.end_date > NOW()
 *   - subscriptions.end_date <= NOW() + INTERVAL '24 hours'
 *   - users.telegram_id IS NOT NULL
 *   - users.is_banned = FALSE
 *   - NOT EXISTS (subscription_reminders row for this sub, kind='expiring_1d')
 *
 * So a user receives this reminder exactly once per subscription, and
 * users without a Telegram account or without any active subscription are
 * skipped entirely. Re-subscribing (creating a NEW row in `subscriptions`)
 * resets the eligibility — that's intentional, the new sub gets its own
 * expiring reminder when the time comes.
 *
 * Auth: `?token=XRAY_SYNC_TOKEN` query param (same secret used by
 * `/api/cron/sweep-expired` and other cron endpoints).
 *
 * Curl example:
 *   curl "https://hundlervpn.xyz/api/cron/remind-expiring?token=$XRAY_SYNC_TOKEN"
 *
 * Response:
 *   { ok: true, candidates: N, sent: X, failed: Y, skipped: Z }
 */

const REMINDER_KIND = 'expiring_1d';

type Candidate = {
  subscription_id: string;
  user_id: string;
  telegram_id: string;
  end_date: string;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || req.headers.get('x-xray-sync-token') || '';

    const expectedToken = process.env.XRAY_SYNC_TOKEN || '';
    if (!expectedToken || token !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!botToken) {
      return NextResponse.json(
        { error: 'TELEGRAM_BOT_TOKEN not configured' },
        { status: 500 }
      );
    }
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'hundlervpnbot';

    const pool = getDbPool();

    // Pick the LATEST active+expiring-within-24h subscription per user so
    // a user with overlapping subs (rare, but possible during an upgrade)
    // only gets one DM. Excludes users who already received 'expiring_1d'
    // for THIS sub, and users with telegram_id = NULL.
    const candidatesResult = await pool.query<Candidate>(
      `
      WITH expiring AS (
        SELECT s.id AS subscription_id,
               s.user_id,
               s.end_date,
               ROW_NUMBER() OVER (
                 PARTITION BY s.user_id
                 ORDER BY s.end_date DESC
               ) AS rn
        FROM subscriptions s
        JOIN users u ON u.id = s.user_id
        WHERE s.status = 'active'
          AND s.end_date > NOW()
          AND s.end_date <= NOW() + INTERVAL '24 hours'
          AND u.telegram_id IS NOT NULL
          AND u.is_banned = FALSE
          AND NOT EXISTS (
            SELECT 1 FROM subscription_reminders r
            WHERE r.subscription_id = s.id
              AND r.kind = $1
          )
      )
      SELECT e.subscription_id::text,
             e.user_id::text,
             u.telegram_id::text,
             e.end_date::text
      FROM expiring e
      JOIN users u ON u.id = e.user_id
      WHERE e.rn = 1
      ORDER BY e.end_date ASC
      `,
      [REMINDER_KIND]
    );

    const candidates = candidatesResult.rows;
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    // Open app deep-link. The Mini App boot effect will pick up
    // start_param = 'payment' and switch to the payment tab automatically
    // (see app/page.tsx). Using a real startapp value (not empty) so
    // Telegram routes the click to the WebApp instead of the bot chat.
    const buttonUrl = `https://t.me/${botUsername}?startapp=payment`;

    for (const cand of candidates) {
      const telegramId = cand.telegram_id;
      const subscriptionId = cand.subscription_id;
      const userId = cand.user_id;

      const text =
        '⏰ <b>Подписка заканчивается</b>\n\n' +
        'У тебя остался <b>всего один день</b> подписки HundlerVPN. 😔\n\n' +
        'Чтобы не остаться без доступа, открой приложение и продли подписку — это займёт меньше минуты.';

      let delivered = true;
      let errorText: string | null = null;

      try {
        const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: Number(telegramId),
            parse_mode: 'HTML',
            text,
            reply_markup: {
              inline_keyboard: [[
                { text: '🔓 Продлить подписку', url: buttonUrl },
              ]],
            },
          }),
        });

        if (!resp.ok) {
          delivered = false;
          const body = await resp.text().catch(() => '');
          errorText = `HTTP ${resp.status}: ${body.slice(0, 300)}`;
          failed++;
        } else {
          const body = await resp.json().catch(() => null) as { ok?: boolean; description?: string } | null;
          if (body && body.ok === false) {
            delivered = false;
            errorText = body.description || 'Telegram API returned ok:false';
            failed++;
          } else {
            sent++;
          }
        }
      } catch (err) {
        delivered = false;
        errorText = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
        failed++;
      }

      // Always write the reminder row regardless of delivery result so
      // we never retry the same sub — preferable to spamming a user
      // whose Telegram account is gone/blocked. ON CONFLICT protects
      // against the freak case of two concurrent cron runs hitting the
      // same row (the unique constraint wins either way).
      try {
        await pool.query(
          `
          INSERT INTO subscription_reminders
            (subscription_id, user_id, kind, delivered, error_text)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (subscription_id, kind) DO NOTHING
          `,
          [
            Number(subscriptionId),
            Number(userId),
            REMINDER_KIND,
            delivered,
            errorText,
          ]
        );
      } catch (err) {
        console.error(
          `[cron/remind-expiring] failed to record reminder for sub=${subscriptionId}:`,
          err
        );
        skipped++;
      }

      // Telegram bot API rate limit is 30 msg/sec for non-broadcast
      // messages. With a 50ms delay we top out at ~20/sec which gives
      // plenty of headroom. Most days there will be <50 candidates
      // anyway so this barely matters in practice.
      await new Promise((r) => setTimeout(r, 50));
    }

    return NextResponse.json({
      ok: true,
      candidates: candidates.length,
      sent,
      failed,
      skipped,
      kind: REMINDER_KIND,
    });
  } catch (error) {
    console.error('[cron/remind-expiring] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
