import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';
import {
  getWithdrawalById,
  listWithdrawalMessages,
  addWithdrawalMessage,
  processWithdrawal,
  WithdrawalError,
  type WithdrawalStatus,
} from '@/lib/referral-cash';

export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────────────────────
// Admin single-withdrawal endpoints. Multiplexes message + status-change
// actions on POST so the admin chat panel can dispatch from one URL.
//
// GET    /api/admin/withdrawals/<id>?telegramId=<admin>
//   Returns full withdrawal + chat thread + the requester's user record.
//
// POST   /api/admin/withdrawals/<id>?telegramId=<admin>
//   Body:
//     { action: 'message', body, attachmentUrl? }     — admin-side reply
//     { action: 'process', status: 'in_progress'|'paid'|'rejected', payoutNote? }
//   Status transitions are enforced by lib/referral-cash → processWithdrawal.
// ────────────────────────────────────────────────────────────────────────────

function parseId(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return trimmed;
}

async function resolveAdminUserId(telegramId: number): Promise<number | null> {
  const pool = getDbPool();
  const res = await pool.query<{ id: number }>(
    'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1;',
    [telegramId],
  );
  return res.rows[0]?.id ?? null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (!id) {
      return NextResponse.json({ error: 'Invalid withdrawal id' }, { status: 400 });
    }
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');
    if (!telegramId || !isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      const withdrawal = await getWithdrawalById(client, id);
      if (!withdrawal) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const messages = await listWithdrawalMessages(client, id);

      // Pull a richer user record for the admin panel header. We
      // already have userId on the withdrawal, but the admin wants to
      // see telegram handle, email, etc. without a separate request.
      const userRes = await client.query<{
        id: number;
        telegram_id: string | null;
        username: string | null;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        photo_url: string | null;
        referral_balance_rub: string;
      }>(
        `SELECT id, telegram_id::text AS telegram_id, username, first_name, last_name, email,
                photo_url, referral_balance_rub::text AS referral_balance_rub
           FROM users WHERE id = $1 LIMIT 1;`,
        [withdrawal.userId],
      );
      const u = userRes.rows[0];
      const user = u ? {
        id: u.id,
        telegramId: u.telegram_id,
        username: u.username,
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        photoUrl: u.photo_url,
        referralBalanceRub: Number(u.referral_balance_rub) || 0,
        displayName:
          [u.first_name, u.last_name].filter(Boolean).join(' ').trim() ||
          u.username ||
          u.email ||
          (u.telegram_id ? `tg:${u.telegram_id}` : `user#${u.id}`),
      } : null;

      return NextResponse.json({ ok: true, withdrawal, messages, user });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[admin/withdrawals/[id]/GET] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type PostBody =
  | { action: 'message'; telegramId: number; body: string; attachmentUrl?: string | null }
  | { action: 'process'; telegramId: number; status: WithdrawalStatus; payoutNote?: string | null };

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (!id) {
      return NextResponse.json({ error: 'Invalid withdrawal id' }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as Partial<PostBody>;
    const telegramId = (body as any).telegramId;
    if (!telegramId || !Number.isFinite(telegramId) || !isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const adminUserId = await resolveAdminUserId(telegramId);
    if (!adminUserId) {
      return NextResponse.json({ error: 'Admin user not found' }, { status: 404 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await getWithdrawalById(client, id);
      if (!existing) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      if (body.action === 'message') {
        const text = String((body as any).body ?? '').trim();
        if (!text) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Сообщение не может быть пустым' }, { status: 400 });
        }
        const message = await addWithdrawalMessage(client, {
          withdrawalId: id,
          authorUserId: adminUserId,
          authorRole: 'admin',
          body: text,
          attachmentUrl: (body as any).attachmentUrl ?? null,
        });
        await client.query('COMMIT');
        return NextResponse.json({ ok: true, message });
      }

      if (body.action === 'process') {
        const nextStatus = (body as any).status as WithdrawalStatus;
        const allowed: WithdrawalStatus[] = ['in_progress', 'paid', 'rejected'];
        if (!allowed.includes(nextStatus)) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'status must be in_progress, paid or rejected' },
            { status: 400 },
          );
        }
        const updated = await processWithdrawal(client, {
          withdrawalId: id,
          nextStatus,
          adminUserId,
          payoutNote: (body as any).payoutNote ?? null,
        });
        await client.query('COMMIT');
        return NextResponse.json({ ok: true, withdrawal: updated });
      }

      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
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
    console.error('[admin/withdrawals/[id]/POST] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/withdrawals/<id>?telegramId=<admin>
//
// Полное удаление заявки и всей её переписки. Используется админом для
// чистки тестовых / спам-заявок чтобы они не висели в списке.
//
// Поведение по балансу:
//   · Если заявка в статусе pending или in_progress — деньги ВОЗВРАЩАЮТСЯ
//     на referral_balance_rub пользователя (потому что они были списаны
//     при создании заявки и админ ещё не выплатил).
//   · Если paid / rejected / cancelled — баланс не трогаем (либо уже
//     выплачено, либо уже возвращено в processWithdrawal).
//
// Это идемпотентная операция: повторный DELETE на удалённый id вернёт 404,
// но без побочных эффектов.
// ────────────────────────────────────────────────────────────────────────────
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (!id) {
      return NextResponse.json({ error: 'Invalid withdrawal id' }, { status: 400 });
    }
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');
    if (!telegramId || !isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await getWithdrawalById(client, id);
      if (!existing) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      // Refund balance for in-flight requests so the user doesn't lose
      // money just because the admin pruned the queue.
      if (existing.status === 'pending' || existing.status === 'in_progress') {
        await client.query(
          'UPDATE users SET referral_balance_rub = referral_balance_rub + $2 WHERE id = $1;',
          [existing.userId, existing.amountRub],
        );
      }

      // Drop chat thread first (FK CASCADE would also work but explicit
      // delete keeps the intent obvious in logs and survives any FK
      // policy change).
      await client.query('DELETE FROM referral_withdrawal_messages WHERE withdrawal_id = $1;', [id]);
      await client.query('DELETE FROM referral_withdrawals WHERE id = $1;', [id]);

      await client.query('COMMIT');
      return NextResponse.json({ ok: true, refunded: existing.status === 'pending' || existing.status === 'in_progress' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[admin/withdrawals/[id]/DELETE] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
