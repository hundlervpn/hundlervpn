import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import {
  getWithdrawalById,
  listWithdrawalMessages,
  addWithdrawalMessage,
  processWithdrawal,
  WithdrawalError,
} from '@/lib/referral-cash';

export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────────────────────
// User-side single-withdrawal endpoints.
//
// GET    /api/users/withdrawals/<id>?telegramId=…
//   Returns: { ok, withdrawal, messages }
//   Caller must own the withdrawal — 403 otherwise.
//
// POST   /api/users/withdrawals/<id>?telegramId=…
//   Body: { action: 'message', body, attachmentUrl? }
//         { action: 'cancel' }
//   Two actions multiplexed on the same endpoint so the client can dispatch
//   from one URL. `cancel` only works while the request is still `pending`.
// ────────────────────────────────────────────────────────────────────────────

async function resolveUserIdByTelegram(telegramId: number): Promise<number | null> {
  const pool = getDbPool();
  const res = await pool.query<{ id: number }>(
    'SELECT id FROM users WHERE telegram_id = $1 LIMIT 1;',
    [telegramId],
  );
  return res.rows[0]?.id ?? null;
}

function parseId(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return trimmed;
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
    const telegramId = Number(url.searchParams.get('telegramId'));
    if (!telegramId || !Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }
    const userId = await resolveUserIdByTelegram(telegramId);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      const withdrawal = await getWithdrawalById(client, id);
      if (!withdrawal) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (Number(withdrawal.userId) !== Number(userId)) {
        console.warn('[withdrawals/[id]/GET] ownership mismatch', {
          withdrawalId: id,
          withdrawalUserId: withdrawal.userId,
          callerUserId: userId,
          callerTelegramId: telegramId,
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const messages = await listWithdrawalMessages(client, id);
      return NextResponse.json({ ok: true, withdrawal, messages });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[withdrawals/[id]/GET] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type PostBody =
  | { action: 'message'; telegramId: number; body: string; attachmentUrl?: string | null }
  | { action: 'cancel'; telegramId: number };

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
    // Tolerant парсинг: фронт мог отдать как number, так и string
    // (Telegram WebApp в некоторых браузерах сериализует bigint user.id
    // через .toString()). Без `Number()` сравнение `WHERE telegram_id = $1`
    // в pg не сматчит string vs bigint и мы бы вернули фейковый 403.
    const telegramId = Number((body as any).telegramId);
    if (!telegramId || !Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }
    const userId = await resolveUserIdByTelegram(telegramId);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      // Ownership gate: load the row inside the transaction (and lock it
      // FOR UPDATE for the cancel path so a parallel admin status-change
      // can't race us).
      await client.query('BEGIN');
      const withdrawal = await getWithdrawalById(client, id);
      if (!withdrawal) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (Number(withdrawal.userId) !== Number(userId)) {
        console.warn('[withdrawals/[id]/POST] ownership mismatch', {
          withdrawalId: id,
          withdrawalUserId: withdrawal.userId,
          callerUserId: userId,
          callerTelegramId: telegramId,
          action: (body as any).action,
        });
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      if (body.action === 'message') {
        const text = String((body as any).body ?? '').trim();
        if (!text) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Сообщение не может быть пустым' }, { status: 400 });
        }
        // Users can post messages on any non-terminal request. Once paid
        // or rejected the thread is read-only (admin keeps history but
        // both sides stop talking).
        if (withdrawal.status === 'paid' || withdrawal.status === 'rejected' || withdrawal.status === 'cancelled') {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Заявка завершена, переписка закрыта' },
            { status: 400 },
          );
        }
        const message = await addWithdrawalMessage(client, {
          withdrawalId: id,
          authorUserId: userId,
          authorRole: 'user',
          body: text,
          attachmentUrl: (body as any).attachmentUrl ?? null,
        });
        await client.query('COMMIT');
        return NextResponse.json({ ok: true, message });
      }

      if (body.action === 'cancel') {
        if (withdrawal.status !== 'pending') {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Можно отменить только заявку в статусе "pending"' },
            { status: 400 },
          );
        }
        const updated = await processWithdrawal(client, {
          withdrawalId: id,
          nextStatus: 'cancelled',
          adminUserId: null,
          payoutNote: null,
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
    console.error('[withdrawals/[id]/POST] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
