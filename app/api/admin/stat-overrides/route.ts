import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isOwner } from '@/lib/admin';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isOwner(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await dbQuery<{ overrides: any }>(
      'SELECT overrides FROM stat_overrides WHERE id = 1'
    );

    return NextResponse.json({
      ok: true,
      overrides: result.rows[0]?.overrides ?? {},
    });
  } catch (error) {
    console.error('Stat overrides GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, overrides } = body;

    if (!isOwner(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!overrides || typeof overrides !== 'object') {
      return NextResponse.json({ error: 'Invalid overrides' }, { status: 400 });
    }

    await dbQuery(
      `INSERT INTO stat_overrides (id, overrides, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id)
       DO UPDATE SET overrides = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(overrides)]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Stat overrides POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
