import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────────────────────
// Stars conversion rate (₽ per ⭐) used by the referral withdrawal flow
// to show users how many Stars they'd receive when picking the
// "Telegram Stars" method, and by the admin to confirm payouts at a
// glance. The actual Stars transfer is manual (admin sends from their
// own Telegram balance) so this number is purely informational —
// changing it doesn't move any money, only updates the displayed
// estimate.
//
// Storage: single row in app_settings with key='referral_stars_rate'.
// Default = 0.5 ₽/⭐ if the row doesn't exist yet (matches the value
// originally hard-coded into the user modal copy).
//
//   GET  /api/settings/stars-rate              → public, returns { rate: number }
//   POST /api/admin/settings/stars-rate        → admin-only setter
//   (this same file handles both for code locality; the POST 403s if
//    the caller's telegramId is not in the admin list)
// ────────────────────────────────────────────────────────────────────────────

const SETTING_KEY = 'referral_stars_rate';
const DEFAULT_RATE_RUB_PER_STAR = 0.5;
// Hard caps: keep the rate inside a sane range so a misclick can't
// accidentally show users "you'll get 1 000 000 ⭐" or "0.0001 ⭐".
const MIN_RATE = 0.01;
const MAX_RATE = 100;

async function readRate(): Promise<number> {
  try {
    const pool = getDbPool();
    const res = await pool.query<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = $1 LIMIT 1;",
      [SETTING_KEY],
    );
    const raw = res.rows[0]?.value;
    if (!raw) return DEFAULT_RATE_RUB_PER_STAR;
    const num = Number(raw);
    if (!Number.isFinite(num) || num < MIN_RATE || num > MAX_RATE) {
      return DEFAULT_RATE_RUB_PER_STAR;
    }
    return num;
  } catch (e) {
    // Fail-open with the default so the withdrawal modal stays usable
    // even if the DB is temporarily flaky.
    console.error('[settings/stars-rate] read failed:', e);
    return DEFAULT_RATE_RUB_PER_STAR;
  }
}

export async function GET() {
  const rate = await readRate();
  return NextResponse.json({ ok: true, rate });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const telegramId = body?.telegramId;
    if (!telegramId || !Number.isFinite(telegramId) || !isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const raw = Number(body?.rate);
    if (!Number.isFinite(raw) || raw < MIN_RATE || raw > MAX_RATE) {
      return NextResponse.json(
        { error: `Rate must be between ${MIN_RATE} and ${MAX_RATE} ₽/⭐` },
        { status: 400 },
      );
    }
    const rate = Math.round(raw * 10000) / 10000; // 4 dp precision is more than enough
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO app_settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW();`,
      [SETTING_KEY, String(rate)],
    );
    return NextResponse.json({ ok: true, rate });
  } catch (e: any) {
    console.error('[settings/stars-rate] POST failed:', e);
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
