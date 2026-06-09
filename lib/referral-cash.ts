import type { Pool, PoolClient } from 'pg';

// ────────────────────────────────────────────────────────────────────────────
// Referral CASH balance + withdrawal flow (2026-05-22).
//
// Sits ALONGSIDE the day-based referral system in lib/access.ts (which
// extends the inviter's subscription end_date). This module manages the
// 10% cash share: a numeric wallet (`users.referral_balance_rub`)
// credited on every successful RUB payment by a referred user, and the
// withdrawal pipeline (request → admin → paid|rejected) with a chat
// thread per request.
//
// All RUB amounts are stored as NUMERIC(12,2) in Postgres, but
// JavaScript-side we round to 2 decimals via Number(x.toFixed(2)) so
// JSON outputs stay clean (no `12.000000000000001` artefacts).
// ────────────────────────────────────────────────────────────────────────────

export const REFERRAL_CASH_PERCENT = 10; // 10% of every referred-user RUB payment
export const REFERRAL_WITHDRAWAL_MIN_RUB = 500;

export type WithdrawalMethod = 'sbp_card' | 'crypto' | 'telegram_stars';
export type WithdrawalStatus = 'pending' | 'in_progress' | 'paid' | 'rejected' | 'cancelled';
export type WithdrawalAuthorRole = 'user' | 'admin' | 'system';

// Per-method destination payload shape. Stored as JSONB; the API layer
// validates that the right fields are present for each method before
// inserting. The DB itself is permissive (just `JSONB`) so adding a new
// method later doesn't require a schema migration.
export type WithdrawalDestination =
  | {
      method: 'sbp_card';
      phone?: string;        // +7… for SBP-by-phone payouts
      cardNumber?: string;   // PAN, last 4 visible to user
      bank?: string;         // free-form bank name ("Тинькофф", "Сбер", …)
      fullName: string;      // recipient full name (required by RUB rails)
    }
  | {
      method: 'crypto';
      // 2026-05-22: scope narrowed to assets the admin actually owns
      // wallets for. USDT can be paid via TON or TRC20; native TON
      // only via TON. BTC / BEP20 / ERC20 were removed — re-add later
      // if admin onboards those wallets.
      network: 'TON' | 'TRC20';
      address: string;       // wallet address — validated only by regex per network
      asset: 'USDT' | 'TON';
    }
  | {
      method: 'telegram_stars';
      telegramUsername?: string; // @handle; falls back to caller's username if absent
    };

export type WithdrawalRow = {
  id: string;                  // BIGSERIAL → string (pg precision-safety)
  userId: number;
  amountRub: number;
  method: WithdrawalMethod;
  destination: Record<string, unknown>;
  status: WithdrawalStatus;
  payoutNote: string | null;
  processedAt: string | null;
  processedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type WithdrawalMessageRow = {
  id: string;
  withdrawalId: string;
  authorUserId: number;
  authorRole: WithdrawalAuthorRole;
  body: string;
  attachmentUrl: string | null;
  createdAt: string;
};

// ────────────────────────────────────────────────────────────────────────────
// 10% accrual on every successful RUB payment.
//
// Called from each payment-confirmation pathway (SBP, crypto callback,
// Telegram Stars webhook). Reads the payment's amount+currency from the
// `payments` row to keep the call sites identical regardless of gateway.
//
// Strict guards:
//   • payment.status must already be 'paid' (caller flips it; this
//     function trusts the row).
//   • payment.currency must be 'RUB' — Stars (XTR) and crypto rails are
//     ignored on the cash side. They still grant referral bonus DAYS via
//     applyReferralReward in lib/access.ts.
//   • Inviter must exist and must NOT be the payer (self-ref guard).
//   • Idempotency anchored to payment_id via the partial UNIQUE index
//     `idx_referral_balance_payment_unique`. ON CONFLICT DO NOTHING +
//     empty RETURNING short-circuits replayed gateway callbacks.
// ────────────────────────────────────────────────────────────────────────────
export async function applyReferralCashReward(
  client: PoolClient,
  paidUserId: number,
  paymentId: number | null,
): Promise<{ credited: boolean; amountRub: number }> {
  if (!paymentId || !Number.isFinite(paymentId) || paymentId <= 0) {
    return { credited: false, amountRub: 0 };
  }

  // Locate the inviter first — most callers will hit this fast-fail path
  // (no referrer → no work to do, skip the heavier query below).
  const inviterRes = await client.query<{ referred_by_user_id: number | null }>(
    'SELECT referred_by_user_id FROM users WHERE id = $1 LIMIT 1;',
    [paidUserId],
  );
  const inviterUserId = inviterRes.rows[0]?.referred_by_user_id;
  if (!inviterUserId || inviterUserId === paidUserId) {
    return { credited: false, amountRub: 0 };
  }

  // Pull the payment to figure out RUB amount. We trust the caller to
  // have already marked status='paid'; the journal here is downstream of
  // that. NUMERIC values come back as strings from pg — cast in SQL to
  // ::float8 so JS gets a real number.
  const payRes = await client.query<{ amount: number; currency: string }>(
    `SELECT amount::float8 AS amount, currency
       FROM payments
      WHERE id = $1
        AND status = 'paid'
      LIMIT 1;`,
    [paymentId],
  );
  const payment = payRes.rows[0];
  if (!payment || payment.currency !== 'RUB') {
    return { credited: false, amountRub: 0 };
  }
  const paidAmountRub = Number(payment.amount);
  if (!Number.isFinite(paidAmountRub) || paidAmountRub <= 0) {
    return { credited: false, amountRub: 0 };
  }
  // Round to 2 decimals after percentage. NUMERIC CHECK in the table
  // rejects ≤ 0 so we also short-circuit when 10% rounds away to zero
  // for tiny test payments (< 0.01 ₽).
  const accrual = Math.round((paidAmountRub * REFERRAL_CASH_PERCENT) / 100 * 100) / 100;
  if (accrual <= 0) {
    return { credited: false, amountRub: 0 };
  }

  // Journal-first idempotency: insert the audit row under partial
  // UNIQUE(payment_id). If a replayed callback hits this code path, the
  // ON CONFLICT returns 0 rows and we don't double-credit the wallet.
  const journal = await client.query<{ id: string }>(
    `INSERT INTO referral_balance_transactions
       (inviter_user_id, invitee_user_id, payment_id, payment_amount_rub, percent, amount_rub)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING
     RETURNING id::text AS id;`,
    [inviterUserId, paidUserId, paymentId, paidAmountRub, REFERRAL_CASH_PERCENT, accrual],
  );
  if (journal.rowCount === 0) {
    return { credited: false, amountRub: 0 };
  }

  // Bump the wallet. CHECK (>= 0) protects against ever going negative
  // from concurrent withdrawal debits.
  await client.query(
    'UPDATE users SET referral_balance_rub = referral_balance_rub + $2 WHERE id = $1;',
    [inviterUserId, accrual],
  );

  return { credited: true, amountRub: accrual };
}

// ────────────────────────────────────────────────────────────────────────────
// Standalone accrual wrapper for callers that DON'T already own a
// transaction client (e.g. the OxaPay "services" callback and the SBP
// fragment-order handler use bare `pool.query`, not a BEGIN/COMMIT
// client). `applyReferralCashReward` does an INSERT (journal) followed by
// an UPDATE (wallet) — those two MUST be atomic, otherwise a crash
// between them leaves a journal row with no wallet credit, and the
// ON CONFLICT idempotency would then permanently skip the retry → the
// inviter silently loses the money. This helper grabs its own client,
// wraps the pair in a transaction, and is safe to call from any
// payment-confirmation path right AFTER the payment row was flipped to
// status='paid'. RUB-only + self-ref guards live inside the helper, so
// it's a no-op for Stars/crypto/non-referred payments.
// ────────────────────────────────────────────────────────────────────────────
export async function accrueReferralCashStandalone(
  pool: Pool,
  paidUserId: number,
  paymentId: number | null,
): Promise<{ credited: boolean; amountRub: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await applyReferralCashReward(client, paidUserId, paymentId);
    await client.query('COMMIT');
    if (result.credited) {
      console.log(
        `[referral-cash] accrued ${result.amountRub} RUB to inviter of user=${paidUserId} (payment=${paymentId})`,
      );
    }
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Never let a referral-cash hiccup break the payment-confirmation
    // response — log and swallow. The backfill endpoint can re-credit
    // any payment this missed (idempotent via UNIQUE(payment_id)).
    console.error('[referral-cash] accrueReferralCashStandalone failed:', err);
    return { credited: false, amountRub: 0 };
  } finally {
    client.release();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Read helpers
// ────────────────────────────────────────────────────────────────────────────

export async function getReferralBalance(
  client: PoolClient,
  userId: number,
): Promise<number> {
  const res = await client.query<{ balance: number }>(
    'SELECT referral_balance_rub::float8 AS balance FROM users WHERE id = $1 LIMIT 1;',
    [userId],
  );
  return Number(res.rows[0]?.balance ?? 0);
}

// Map a raw DB row to the camelCase shape our APIs return.
function mapWithdrawalRow(r: any): WithdrawalRow {
  return {
    id: String(r.id),
    userId: Number(r.user_id),
    amountRub: Number(r.amount_rub),
    method: r.method,
    destination: r.destination ?? {},
    status: r.status,
    payoutNote: r.payout_note,
    processedAt: r.processed_at ? new Date(r.processed_at).toISOString() : null,
    processedByUserId: r.processed_by_user_id !== null ? Number(r.processed_by_user_id) : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function mapMessageRow(r: any): WithdrawalMessageRow {
  return {
    id: String(r.id),
    withdrawalId: String(r.withdrawal_id),
    authorUserId: Number(r.author_user_id),
    authorRole: r.author_role,
    body: r.body,
    attachmentUrl: r.attachment_url,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function listUserWithdrawals(
  client: PoolClient,
  userId: number,
  limit = 50,
): Promise<WithdrawalRow[]> {
  const res = await client.query(
    `SELECT id::text AS id, user_id, amount_rub::float8 AS amount_rub, method,
            destination, status, payout_note, processed_at, processed_by_user_id,
            created_at, updated_at
       FROM referral_withdrawals
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2;`,
    [userId, Math.max(1, Math.min(200, limit))],
  );
  return res.rows.map(mapWithdrawalRow);
}

export async function getWithdrawalById(
  client: PoolClient,
  withdrawalId: string | number,
): Promise<WithdrawalRow | null> {
  const res = await client.query(
    `SELECT id::text AS id, user_id, amount_rub::float8 AS amount_rub, method,
            destination, status, payout_note, processed_at, processed_by_user_id,
            created_at, updated_at
       FROM referral_withdrawals
      WHERE id = $1
      LIMIT 1;`,
    [withdrawalId],
  );
  if (res.rowCount === 0) return null;
  return mapWithdrawalRow(res.rows[0]);
}

export async function listWithdrawalMessages(
  client: PoolClient,
  withdrawalId: string | number,
): Promise<WithdrawalMessageRow[]> {
  const res = await client.query(
    `SELECT id::text AS id, withdrawal_id::text AS withdrawal_id, author_user_id,
            author_role, body, attachment_url, created_at
       FROM referral_withdrawal_messages
      WHERE withdrawal_id = $1
      ORDER BY created_at ASC;`,
    [withdrawalId],
  );
  return res.rows.map(mapMessageRow);
}

// ────────────────────────────────────────────────────────────────────────────
// Mutation helpers — submission, cancellation, admin processing
// ────────────────────────────────────────────────────────────────────────────

export class WithdrawalError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'WithdrawalError';
  }
}

// Validate that `destination` matches the shape expected for `method`.
// Returns the sanitised destination (only fields we care about), or
// throws a WithdrawalError on bad input.
export function validateDestination(
  method: WithdrawalMethod,
  raw: any,
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') {
    throw new WithdrawalError('invalid_destination', 'Destination payload is required');
  }
  if (method === 'sbp_card') {
    // 2026-05-22: ФИО больше не обязательно. Получатель и так указывается
    // самим админом при оплате (СБП показывает имя владельца номера/карты).
    // Принимаем как опциональное поле — если придёт, сохраним; если нет —
    // просто пропустим.
    const fullName = typeof raw.fullName === 'string' ? raw.fullName.trim() : '';
    const phone = typeof raw.phone === 'string' ? raw.phone.trim() : '';
    const cardNumber = typeof raw.cardNumber === 'string' ? raw.cardNumber.replace(/\s+/g, '') : '';
    if (!phone && !cardNumber) {
      throw new WithdrawalError('invalid_destination', 'Укажите телефон СБП или номер карты');
    }
    if (cardNumber && !/^\d{16,19}$/.test(cardNumber)) {
      throw new WithdrawalError('invalid_destination', 'Номер карты должен содержать 16-19 цифр');
    }
    if (phone && !/^\+?\d{10,15}$/.test(phone)) {
      throw new WithdrawalError('invalid_destination', 'Телефон должен быть в формате +71234567890');
    }
    const bank = typeof raw.bank === 'string' ? raw.bank.trim().slice(0, 64) : '';
    return {
      method: 'sbp_card',
      ...(fullName ? { fullName: fullName.slice(0, 128) } : {}),
      ...(phone ? { phone } : {}),
      ...(cardNumber ? { cardNumber } : {}),
      ...(bank ? { bank } : {}),
    };
  }
  if (method === 'crypto') {
    const asset = typeof raw.asset === 'string' ? raw.asset.toUpperCase() : 'USDT';
    if (!['USDT', 'TON'].includes(asset)) {
      throw new WithdrawalError('invalid_destination', 'Поддерживаемые активы: USDT, TON');
    }
    const network = typeof raw.network === 'string' ? raw.network.toUpperCase() : '';
    // Allowed (asset, network) combinations — see WithdrawalDestination
    // type comment for rationale. Server-side guard so a crafted client
    // can't sneak in BEP20/ERC20 via raw JSON.
    const allowed: Record<string, string[]> = {
      USDT: ['TON', 'TRC20'],
      TON: ['TON'],
    };
    if (!allowed[asset]?.includes(network)) {
      throw new WithdrawalError(
        'invalid_destination',
        asset === 'TON'
          ? 'TON выводится только в сети TON'
          : 'USDT выводится только в сетях TON или TRC20',
      );
    }
    const address = typeof raw.address === 'string' ? raw.address.trim() : '';
    if (!address || address.length < 20 || address.length > 128) {
      throw new WithdrawalError('invalid_destination', 'Некорректный адрес кошелька');
    }
    return { method: 'crypto', network: network as 'TON' | 'TRC20', address, asset: asset as 'USDT' | 'TON' };
  }
  if (method === 'telegram_stars') {
    const username = typeof raw.telegramUsername === 'string'
      ? raw.telegramUsername.trim().replace(/^@/, '').slice(0, 64)
      : '';
    return { method: 'telegram_stars', ...(username ? { telegramUsername: username } : {}) };
  }
  throw new WithdrawalError('invalid_method', `Unknown withdrawal method: ${method}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Submit a new withdrawal request.
//
// Atomic: SELECT…FOR UPDATE locks the user row, checks the balance,
// inserts the request, decrements the balance. If anything fails the
// caller's transaction rollbacks the whole thing.
//
// The amount is debited UPFRONT (not at payout) so a user can't open
// 20 parallel requests and game the system. If admin rejects/cancels
// the request later, `refundWithdrawal` returns the locked funds.
// ────────────────────────────────────────────────────────────────────────────
export async function submitWithdrawal(
  client: PoolClient,
  params: {
    userId: number;
    amountRub: number;
    method: WithdrawalMethod;
    destination: Record<string, unknown>;
  },
): Promise<WithdrawalRow> {
  const { userId, amountRub, method, destination } = params;
  if (!Number.isFinite(amountRub) || amountRub < REFERRAL_WITHDRAWAL_MIN_RUB) {
    throw new WithdrawalError(
      'min_amount',
      `Минимальная сумма вывода — ${REFERRAL_WITHDRAWAL_MIN_RUB} ₽`,
    );
  }
  const roundedAmount = Math.round(amountRub * 100) / 100;

  // Lock the user row to serialise concurrent withdraw submissions for
  // the same wallet. Without FOR UPDATE two parallel requests could both
  // pass the balance check and overdraft the wallet (CHECK >= 0 would
  // trip and one would 500-error mid-transaction).
  const balanceRes = await client.query<{ balance: number }>(
    `SELECT referral_balance_rub::float8 AS balance
       FROM users
      WHERE id = $1
      FOR UPDATE;`,
    [userId],
  );
  const balance = Number(balanceRes.rows[0]?.balance ?? 0);
  if (balance < roundedAmount) {
    throw new WithdrawalError(
      'insufficient_balance',
      `Недостаточно средств. На балансе: ${balance.toFixed(2)} ₽`,
    );
  }

  // Insert request row.
  const insertRes = await client.query(
    `INSERT INTO referral_withdrawals (user_id, amount_rub, method, destination)
     VALUES ($1, $2, $3, $4)
     RETURNING id::text AS id, user_id, amount_rub::float8 AS amount_rub, method,
               destination, status, payout_note, processed_at,
               processed_by_user_id, created_at, updated_at;`,
    [userId, roundedAmount, method, destination],
  );

  // Debit balance.
  await client.query(
    'UPDATE users SET referral_balance_rub = referral_balance_rub - $2 WHERE id = $1;',
    [userId, roundedAmount],
  );

  return mapWithdrawalRow(insertRes.rows[0]);
}

// ────────────────────────────────────────────────────────────────────────────
// Move a withdrawal between statuses. Centralises the side-effects so
// the API routes don't have to remember to refund balances or insert
// system messages.
//
// Allowed transitions:
//   pending      → in_progress | rejected | cancelled
//   in_progress  → paid | rejected
//   (terminal: paid, rejected, cancelled)
//
// Refund: refundOnReject ensures we credit the locked funds back to the
// user's wallet exactly once. Idempotency is the caller's responsibility
// (don't call processWithdrawal twice with the same target state).
// ────────────────────────────────────────────────────────────────────────────
export async function processWithdrawal(
  client: PoolClient,
  params: {
    withdrawalId: string | number;
    nextStatus: WithdrawalStatus;
    adminUserId?: number | null;
    payoutNote?: string | null;
  },
): Promise<WithdrawalRow> {
  const { withdrawalId, nextStatus, adminUserId, payoutNote } = params;

  const cur = await client.query(
    `SELECT id::text AS id, user_id, amount_rub::float8 AS amount_rub, status
       FROM referral_withdrawals
      WHERE id = $1
      FOR UPDATE;`,
    [withdrawalId],
  );
  if (cur.rowCount === 0) {
    throw new WithdrawalError('not_found', 'Заявка не найдена');
  }
  const { user_id: targetUserId, amount_rub: amountRub, status: currentStatus } = cur.rows[0];

  const allowed: Record<WithdrawalStatus, WithdrawalStatus[]> = {
    pending: ['in_progress', 'rejected', 'cancelled'],
    in_progress: ['paid', 'rejected'],
    paid: [],
    rejected: [],
    cancelled: [],
  };
  if (!allowed[currentStatus as WithdrawalStatus]?.includes(nextStatus)) {
    throw new WithdrawalError(
      'invalid_transition',
      `Нельзя перевести заявку из «${currentStatus}» в «${nextStatus}»`,
    );
  }

  const shouldRefund = nextStatus === 'rejected' || nextStatus === 'cancelled';
  const terminal = nextStatus === 'paid' || nextStatus === 'rejected' || nextStatus === 'cancelled';

  const updateRes = await client.query(
    `UPDATE referral_withdrawals
        SET status = $2,
            payout_note = COALESCE($3, payout_note),
            processed_by_user_id = COALESCE($4, processed_by_user_id),
            processed_at = CASE WHEN $5::boolean THEN NOW() ELSE processed_at END
      WHERE id = $1
      RETURNING id::text AS id, user_id, amount_rub::float8 AS amount_rub, method,
                destination, status, payout_note, processed_at,
                processed_by_user_id, created_at, updated_at;`,
    [withdrawalId, nextStatus, payoutNote ?? null, adminUserId ?? null, terminal],
  );

  if (shouldRefund) {
    await client.query(
      'UPDATE users SET referral_balance_rub = referral_balance_rub + $2 WHERE id = $1;',
      [targetUserId, amountRub],
    );
  }

  // System message documenting the transition. Renders inline-grey in
  // the chat UI (see referral_withdrawal_messages.author_role='system').
  // Author defaults to the user themselves for self-cancellation, or
  // the admin user for everything else.
  const sysAuthor = adminUserId ?? targetUserId;
  const sysBody = nextStatus === 'paid'
    ? '✅ Заявка выплачена'
    : nextStatus === 'rejected'
      ? `❌ Заявка отклонена${payoutNote ? `: ${payoutNote}` : ''}. Средства возвращены на баланс.`
      : nextStatus === 'cancelled'
        ? '🚫 Заявка отменена. Средства возвращены на баланс.'
        : nextStatus === 'in_progress'
          ? '⏳ Заявка взята в работу'
          : `Статус изменён: ${nextStatus}`;
  await client.query(
    `INSERT INTO referral_withdrawal_messages
       (withdrawal_id, author_user_id, author_role, body)
     VALUES ($1, $2, 'system', $3);`,
    [withdrawalId, sysAuthor, sysBody],
  );

  return mapWithdrawalRow(updateRes.rows[0]);
}

export async function addWithdrawalMessage(
  client: PoolClient,
  params: {
    withdrawalId: string | number;
    authorUserId: number;
    authorRole: WithdrawalAuthorRole;
    body: string;
    attachmentUrl?: string | null;
  },
): Promise<WithdrawalMessageRow> {
  const body = String(params.body ?? '').trim();
  if (!body || body.length > 4000) {
    throw new WithdrawalError('invalid_body', 'Сообщение должно быть от 1 до 4000 символов');
  }
  const res = await client.query(
    `INSERT INTO referral_withdrawal_messages
       (withdrawal_id, author_user_id, author_role, body, attachment_url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id::text AS id, withdrawal_id::text AS withdrawal_id,
               author_user_id, author_role, body, attachment_url, created_at;`,
    [
      params.withdrawalId,
      params.authorUserId,
      params.authorRole,
      body,
      params.attachmentUrl ?? null,
    ],
  );
  return mapMessageRow(res.rows[0]);
}
