import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const paymentId = url.searchParams.get('paymentId');

    if (!paymentId) {
      return NextResponse.json(
        { error: 'paymentId is required' },
        { status: 400 }
      );
    }

    const result = await dbQuery<{
      status: string;
      paid_at: string | null;
    }>(
      `SELECT status, paid_at FROM payments WHERE id = $1 LIMIT 1`,
      [paymentId]
    );

    if (!result.rows[0]) {
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      status: result.rows[0].status,
      paidAt: result.rows[0].paid_at,
    });
  } catch (error) {
    console.error('SBP status check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
