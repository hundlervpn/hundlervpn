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
  // 2026-05-05: kind of inline button. 'url' = legacy plain URL,
  // 'app' = open Mini App, 'promo' = open Mini App + auto-apply promo code.
  button_kind: string;
  button_promo_code: string | null;
  status: string;
  total_users: number;
  sent_count: number;
  failed_count: number;
  target_audience: string;
  created_at: string;
  sent_at: string | null;
};

// 2026-05-05: valid button kinds. Keep in sync with DB CHECK constraint and
// bot/main.py's URL builder.
type ButtonKind = 'url' | 'app' | 'promo';
const VALID_BUTTON_KINDS: ReadonlyArray<ButtonKind> = ['url', 'app', 'promo'];

// v65: valid audience filters. Keep in sync with DB CHECK constraint and bot/main.py.
// 2026-05-05: added 'active_no_devices' for users who paid but never set up the VPN.
type TargetAudience = 'all' | 'active' | 'no_sub' | 'active_no_devices';
const VALID_AUDIENCES: ReadonlyArray<TargetAudience> = ['all', 'active', 'no_sub', 'active_no_devices'];

/**
 * Build the COUNT(*) SQL fragment that returns the number of users
 * matching the given audience filter. Used at broadcast creation
 * (for total_users). Logic must match bot/main.py SELECT — keep them
 * in sync so the count shown to admin matches actual recipients.
 */
function buildAudienceCountSql(audience: TargetAudience): string {
  switch (audience) {
    case 'active':
      return `
        SELECT COUNT(*)::text AS count
        FROM users u
        WHERE u.telegram_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM subscriptions s
            WHERE s.user_id = u.id
              AND s.status = 'active'
              AND s.end_date > NOW()
          )
      `;
    case 'no_sub':
      return `
        SELECT COUNT(*)::text AS count
        FROM users u
        WHERE u.telegram_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM subscriptions s
            WHERE s.user_id = u.id
              AND s.status = 'active'
              AND s.end_date > NOW()
          )
      `;
    case 'active_no_devices':
      // Users with a live subscription but zero non-kicked device_sessions.
      // Targets people who paid but never imported the VLESS subscription
      // into a VPN client. Matches the same semantics as the Mini App's
      // device list (`kicked_at IS NULL` = currently bound device).
      return `
        SELECT COUNT(*)::text AS count
        FROM users u
        WHERE u.telegram_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM subscriptions s
            WHERE s.user_id = u.id
              AND s.status = 'active'
              AND s.end_date > NOW()
          )
          AND NOT EXISTS (
            SELECT 1 FROM device_sessions ds
            WHERE ds.user_id = u.id
              AND ds.kicked_at IS NULL
          )
      `;
    case 'all':
    default:
      return `SELECT COUNT(*)::text AS count FROM users WHERE telegram_id IS NOT NULL`;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const telegramId = url.searchParams.get('telegramId');

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await dbQuery<Broadcast>(
      `SELECT id::text, title, message, image_url, button_text, button_url,
              button_kind, button_promo_code,
              status, total_users, sent_count, failed_count, target_audience,
              created_at, sent_at
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
    const {
      telegramId,
      title,
      message,
      imageUrl,
      buttonText,
      buttonUrl,
      targetTelegramId,
      targetAudience: rawAudience,
      // 2026-05-05: button kind + optional promo code.
      buttonKind: rawButtonKind,
      buttonPromoCode: rawPromoCode,
    } = body;

    if (!isAdmin(telegramId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // v65: normalize audience. Default 'all' for backward compat with old admin UI.
    const targetAudience: TargetAudience = VALID_AUDIENCES.includes(rawAudience as TargetAudience)
      ? (rawAudience as TargetAudience)
      : 'all';

    // 2026-05-05: normalize button kind. Default 'url' for backward compat.
    const buttonKind: ButtonKind = VALID_BUTTON_KINDS.includes(rawButtonKind as ButtonKind)
      ? (rawButtonKind as ButtonKind)
      : 'url';

    // For 'promo' kind validate the code exists and is currently usable
    // (active, not expired, not exhausted). The bot will fan this out to
    // many users, so the code MUST stay valid until they all click — but
    // we at least catch typos and dead codes at creation time.
    let buttonPromoCode: string | null = null;
    if (buttonKind === 'promo') {
      const code = String(rawPromoCode ?? '').trim().toUpperCase();
      if (!code) {
        return NextResponse.json(
          { error: 'Promo code is required when button kind is "promo"' },
          { status: 400 }
        );
      }
      const promoCheck = await dbQuery<{ id: number; max_uses: number; used_count: number }>(
        `SELECT id, max_uses, used_count
         FROM promo_codes
         WHERE code = $1
           AND is_active = TRUE
           AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1`,
        [code]
      );
      if (!promoCheck.rows[0]) {
        return NextResponse.json(
          { error: `Promo code '${code}' not found or inactive` },
          { status: 400 }
        );
      }
      // Warn if the code is already exhausted — reject so the broadcast
      // doesn't ship a button that everyone clicks and gets an error from.
      if (promoCheck.rows[0].used_count >= promoCheck.rows[0].max_uses) {
        return NextResponse.json(
          { error: `Promo code '${code}' is exhausted (${promoCheck.rows[0].used_count}/${promoCheck.rows[0].max_uses})` },
          { status: 400 }
        );
      }
      buttonPromoCode = code;
    }

    // For 'url' kind keep the old behaviour: button_url required iff button_text given.
    // For 'app'/'promo' the bot builds the URL itself, so button_url is ignored.
    const finalButtonUrl: string | null = buttonKind === 'url'
      ? (buttonUrl?.trim() || null)
      : null;

    // Get admin user id
    const adminResult = await dbQuery<{ id: string }>(
      'SELECT id::text FROM users WHERE telegram_id = $1',
      [telegramId]
    );
    const adminUserId = adminResult.rows[0]?.id ? Number(adminResult.rows[0].id) : null;

    // v65: Count recipients. Single-user target overrides audience filter.
    let totalUsers = 1;
    if (!targetTelegramId) {
      const countResult = await dbQuery<{ count: string }>(buildAudienceCountSql(targetAudience));
      totalUsers = Number(countResult.rows[0]?.count ?? 0);
    }

    // Create broadcast record
    const result = await dbQuery<{ id: string }>(
      `INSERT INTO broadcasts (title, message, image_url, button_text, button_url,
                               button_kind, button_promo_code,
                               target_telegram_id, target_audience, total_users, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id::text`,
      [
        title?.trim() || null,
        message.trim(),
        imageUrl?.trim() || null,
        buttonText?.trim() || null,
        finalButtonUrl,
        buttonKind,
        buttonPromoCode,
        targetTelegramId ? BigInt(targetTelegramId) : null,
        targetAudience,
        totalUsers,
        adminUserId
      ]
    );

    return NextResponse.json({
      ok: true,
      broadcastId: result.rows[0].id,
      totalUsers,
      targeted: !!targetTelegramId,
      targetAudience,
      buttonKind,
      buttonPromoCode,
    });
  } catch (error) {
    console.error('Admin broadcasts POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
