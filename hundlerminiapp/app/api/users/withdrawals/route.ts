import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import {
  getReferralBalance,
  listUserWithdrawals,
  submitWithdrawal,
  validateDestination,
  REFERRAL_WITHDRAWAL_MIN_RUB,
  WithdrawalError,
  type WithdrawalMethod,
} from '@/lib/referral-cash';

export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────────────────────
// User withdrawal endpoints — referral cash payout.
//
// GET  /api/users/withdrawals?telegramId=…
//   Returns: { ok, balanceRub, withdrawals: [...] }
//   Lists the caller's own withdrawal requests (newest first), plus their
//   current spendable balance. Powers the "Заявки" tab inside the
//   referral modal.
//
// POST /api/users/withdrawals
//   Body: { telegramId, amountRub, method, destination }
//   Creates a new withdrawal request, debiting the caller's wallet
//   atomically. Method-specific `destination` is validated server-side
//   (see lib/referral-cash.ts → validateDestination).
//
// All routes resolve the caller via telegramId. We trust the Telegram
// Mini App init-data middleware to have authenticated the request
// upstream; no extra auth check here.
// ────────────────────────────────────────────────────────────────────────────

async function resolveUserIdByTelegram(telegramId: number): Promise<number | null> {
  const pool = getDbPool();
  const res = await pool.query<{ id: number }>(
    'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1;',
    [telegramId],
  );
  return res.rows[0]?.id ?? null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramIdRaw = url.searchParams.get('telegramId');
    const telegramId = telegramIdRaw ? Number(telegramIdRaw) : null;
    if (!telegramId || !Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }
    const userId = await resolveUserIdByTelegram(telegramId);
    if (!userId) {
      // New telegram user that hasn't synced yet — show an empty wallet
      // rather than a 404 so the UI can render cleanly.
      return NextResponse.json({ ok: true, balanceRub: 0, withdrawals: [] });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      const [balance, withdrawals] = await Promise.all([
        getReferralBalance(client, userId),
        listUserWithdrawals(client, userId, 100),
      ]);
      return NextResponse.json({ ok: true, balanceRub: balance, withdrawals });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[withdrawals/GET] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type CreateBody = {
  telegramId?: number;
  amountRub?: number;
  method?: WithdrawalMethod;
  destination?: Record<string, unknown>;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as CreateBody;
    const telegramId = body.telegramId;
    if (!telegramId || !Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }
    const userId = await resolveUserIdByTelegram(telegramId);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const method = body.method;
    if (!method || !['sbp_card', 'crypto', 'telegram_stars'].includes(method)) {
      return NextResponse.json(
        { error: 'method must be one of: sbp_card, crypto, telegram_stars' },
        { status: 400 },
      );
    }
    const amountRub = Number(body.amountRub);
    if (!Number.isFinite(amountRub) || amountRub < REFERRAL_WITHDRAWAL_MIN_RUB) {
      return NextResponse.json(
        { error: `Минимальная сумма вывода — ${REFERRAL_WITHDRAWAL_MIN_RUB} ₽` },
        { status: 400 },
      );
    }

    // validateDestination throws WithdrawalError on bad input — caught
    // below and mapped to a 400 with the localized message.
    let cleanDest: Record<string, unknown>;
    try {
      cleanDest = validateDestination(method, body.destination);
    } catch (e) {
      if (e instanceof WithdrawalError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
      }
      throw e;
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const withdrawal = await submitWithdrawal(client, {
        userId,
        amountRub,
        method,
        destination: cleanDest,
      });
      await client.query('COMMIT');
      return NextResponse.json({ ok: true, withdrawal });
    } catch (e) {
      await client.query('ROLLBACK');
      if (e instanceof WithdrawalError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[withdrawals/POST] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
