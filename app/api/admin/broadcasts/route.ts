import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

type Broadcast = {
  id: string;
  title: string | null;
  message: string;
  image_url: string | null;
  button_text: string | null;
  button_url: string | null;
  status: string;
  total_users: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await dbQuery<Broadcast>(
      `SELECT id::text, title, message, image_url, button_text, button_url, status, 
              total_users, sent_count, failed_count, created_at, sent_at
       FROM broadcasts 
       ORDER BY created_at DESC 
       LIMIT 50`
    );

    return NextResponse.json({ ok: true, broadcasts: result.rows });
  } catch (error) {
    console.error('Admin broadcasts GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, title, message, imageUrl, buttonText, buttonUrl, targetTelegramId } = body;

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Get admin user id
    const adminResult = await dbQuery<{ id: string }>(
      'SELECT id::text FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    const adminUserId = adminResult.rows[0]?.id ? Number(adminResult.rows[0].id) : null;

    // Count users - 1 if targeted, otherwise all users with telegram_id
    let totalUsers = 1;
    if (!targetTelegramId) {
      const countResult = await dbQuery<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM users WHERE telegram_id IS NOT NULL'
      );
      totalUsers = Number(countResult.rows[0]?.count ?? 0);
    }

    // Create broadcast record
    const result = await dbQuery<{ id: string }>(
      `INSERT INTO broadcasts (title, message, image_url, button_text, button_url, target_telegram_id, total_users, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id::text`,
      [
        title?.trim() || null,
        message.trim(),
        imageUrl?.trim() || null,
        buttonText?.trim() || null,
        buttonUrl?.trim() || null,
        targetTelegramId ? String(targetTelegramId) : null,
        totalUsers,
        adminUserId
      ]
    );

    return NextResponse.json({ 
      ok: true, 
      broadcastId: result.rows[0].id,
      totalUsers,
      targeted: !!targetTelegramId
    });
  } catch (error) {
    console.error('Admin broadcasts POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
