import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

type UserPayment = {
  id: number;
  amount: string;
  currency: string;
  status: string;
  provider: string;
  paid_at: string | null;
  created_at: string;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramIdRaw = url.searchParams.get('telegramId');

    if (!telegramIdRaw) {
      return NextResponse.json({ error: 'telegramId is required' }, { status: 400 });
    }

    const telegramId = Number(telegramIdRaw);
    if (!Number.isFinite(telegramId)) {
      return NextResponse.json({ error: 'telegramId is invalid' }, { status: 400 });
    }

    const result = await dbQuery<UserPayment>(
      `
      SELECT
        p.id,
        p.amount::text AS amount,
        p.currency,
        p.status,
        p.provider,
        p.paid_at,
        p.created_at
      FROM payments p
      JOIN users u ON u.id = p.user_id
      WHERE u.telegram_id = $1
      ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.id DESC;
      `,
      [telegramId]
    );

    return NextResponse.json({ ok: true, payments: result.rows });
  } catch (error) {
    console.error('User payments error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
