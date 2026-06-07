import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';

const ADMIN_TELEGRAM_IDS = [2029065770, 1483598839];

export async function GET() {
  try {
    const pool = getDbPool();
    
    const result = await pool.query(`
      SELECT value FROM app_settings WHERE key = 'maintenance_mode'
    `);
    
    const isEnabled = result.rows[0]?.value === 'true';
    
    return NextResponse.json({ enabled: isEnabled });
  } catch (error) {
    console.error('Failed to get maintenance status:', error);
    return NextResponse.json({ enabled: false });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { telegramId, enabled } = body;

    if (!telegramId || !ADMIN_TELEGRAM_IDS.includes(Number(telegramId))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const pool = getDbPool();

    await pool.query(`
      INSERT INTO app_settings (key, value)
      VALUES ('maintenance_mode', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [String(enabled)]);

    return NextResponse.json({ ok: true, enabled });
  } catch (error) {
    console.error('Failed to set maintenance mode:', error);
    return NextResponse.json(
      { error: 'Failed to set maintenance mode' },
      { status: 500 }
    );
  }
}
