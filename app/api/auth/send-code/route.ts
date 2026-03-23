import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { generateCode, sendVerificationCode } from '@/lib/email';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = (body.email || '').trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Некорректный email' }, { status: 400 });
    }

    // Rate limit: max 1 code per email per 60 seconds
    const recent = await dbQuery(
      `SELECT id FROM email_codes WHERE email = $1 AND created_at > NOW() - INTERVAL '60 seconds' AND used = FALSE LIMIT 1;`,
      [email]
    );
    if (recent.rows.length > 0) {
      return NextResponse.json({ error: 'Подождите минуту перед повторной отправкой' }, { status: 429 });
    }

    const code = generateCode();

    await dbQuery(
      `INSERT INTO email_codes (email, code) VALUES ($1, $2);`,
      [email, code]
    );

    await sendVerificationCode(email, code);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Send code error:', error);
    return NextResponse.json({ error: 'Ошибка отправки кода' }, { status: 500 });
  }
}
