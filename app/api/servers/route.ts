import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

export async function GET() {
  try {
    const result = await dbQuery(
      `
      SELECT
        s.id,
        s.name,
        s.host,
        s.port,
        s.country,
        s.is_active,
        s.created_at
      FROM servers s
      ORDER BY s.country ASC, s.name ASC;
      `
    );

    return NextResponse.json({ ok: true, servers: result.rows });
  } catch (error) {
    console.error('Servers fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
