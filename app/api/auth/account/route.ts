import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

// GET - fetch linked accounts for a user
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId');
    const telegramId = url.searchParams.get('telegramId');

    if (!userId && !telegramId) {
      return NextResponse.json({ error: 'userId or telegramId required' }, { status: 400 });
    }

    let result;
    if (telegramId) {
      result = await dbQuery(
        `SELECT id, telegram_id, email, email_verified, google_id, username, first_name, last_name, photo_url, auth_type, referral_code, created_at
         FROM users WHERE telegram_id = $1 LIMIT 1;`,
        [Number(telegramId)]
      );
    } else {
      result = await dbQuery(
        `SELECT id, telegram_id, email, email_verified, google_id, username, first_name, last_name, photo_url, auth_type, referral_code, created_at
         FROM users WHERE id = $1 LIMIT 1;`,
        [Number(userId)]
      );
    }

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const user = result.rows[0];
    return NextResponse.json({
      ok: true,
      account: {
        id: user.id,
        telegramId: user.telegram_id,
        email: user.email,
        emailVerified: user.email_verified,
        googleId: user.google_id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        photoUrl: user.photo_url,
        authType: user.auth_type,
        referralCode: user.referral_code,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('Account fetch error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// POST - link email or telegram to existing account
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, telegramId, action, email, linkTelegramId } = body;

    // Identify current user (select all auth-related fields so unlink_* can
    // decide whether removal is safe).
    type CurrentUser = {
      id: number;
      telegram_id: number | null;
      email: string | null;
      email_verified: boolean;
      google_id: string | null;
      auth_type: string;
    };
    let currentUser: CurrentUser | undefined;
    if (telegramId) {
      const r = await dbQuery<CurrentUser>(
        `SELECT id, telegram_id, email, email_verified, google_id, auth_type
         FROM users WHERE telegram_id = $1 LIMIT 1;`,
        [Number(telegramId)]
      );
      currentUser = r.rows[0];
    } else if (userId) {
      const r = await dbQuery<CurrentUser>(
        `SELECT id, telegram_id, email, email_verified, google_id, auth_type
         FROM users WHERE id = $1 LIMIT 1;`,
        [Number(userId)]
      );
      currentUser = r.rows[0];
    }

    if (!currentUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (action === 'link_email') {
      if (!email) {
        return NextResponse.json({ error: 'Email required' }, { status: 400 });
      }

      // Check if email already belongs to another user
      const existing = await dbQuery(
        `SELECT id FROM users WHERE email = $1 AND id != $2 LIMIT 1;`,
        [email.toLowerCase().trim(), currentUser.id]
      );

      if (existing.rows.length > 0) {
        return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 });
      }

      // Link email
      await dbQuery(
        `UPDATE users SET email = $2, email_verified = false WHERE id = $1;`,
        [currentUser.id, email.toLowerCase().trim()]
      );

      return NextResponse.json({ ok: true, message: 'Email linked' });
    }

    if (action === 'link_telegram') {
      if (!linkTelegramId) {
        return NextResponse.json({ error: 'Telegram ID required' }, { status: 400 });
      }

      // Check if telegram already belongs to another user
      const existing = await dbQuery(
        `SELECT id FROM users WHERE telegram_id = $1 AND id != $2 LIMIT 1;`,
        [Number(linkTelegramId), currentUser.id]
      );

      if (existing.rows.length > 0) {
        return NextResponse.json({ error: 'TELEGRAM_TAKEN' }, { status: 409 });
      }

      // Link telegram
      await dbQuery(
        `UPDATE users SET telegram_id = $2 WHERE id = $1;`,
        [currentUser.id, Number(linkTelegramId)]
      );

      return NextResponse.json({ ok: true, message: 'Telegram linked' });
    }

    // Unlink Email from the current user.
    //
    // ONLY allowed if auth_type !== 'email' (user registered via telegram/google).
    // Email-registered users must NOT be able to unlink their primary identity
    // (that would delete their sign-in password and effectively orphan the account).
    //
    // Safety: block if this would leave the account with no alternative sign-in.
    if (action === 'unlink_email') {
      if (currentUser.auth_type === 'email') {
        return NextResponse.json({ error: 'CANNOT_UNLINK_PRIMARY' }, { status: 400 });
      }
      if (!currentUser.email) {
        return NextResponse.json({ error: 'NOT_LINKED' }, { status: 400 });
      }

      const hasTelegram = !!currentUser.telegram_id;
      const hasGoogle = !!currentUser.google_id;

      if (!hasTelegram && !hasGoogle) {
        return NextResponse.json({ error: 'LAST_AUTH_METHOD' }, { status: 400 });
      }

      await dbQuery(
        `UPDATE users
            SET email = NULL,
                email_verified = FALSE,
                last_seen_at = NOW()
          WHERE id = $1;`,
        [currentUser.id]
      );

      return NextResponse.json({ ok: true, message: 'Email unlinked' });
    }

    // Unlink Telegram from the current user.
    //
    // ONLY allowed if auth_type !== 'telegram' (user registered via email/google).
    // Telegram-registered users must NOT be able to unlink their primary identity.
    //
    // Safety: block if this would leave the account with no alternative sign-in.
    if (action === 'unlink_telegram') {
      if (currentUser.auth_type === 'telegram') {
        return NextResponse.json({ error: 'CANNOT_UNLINK_PRIMARY' }, { status: 400 });
      }
      if (!currentUser.telegram_id) {
        return NextResponse.json({ error: 'NOT_LINKED' }, { status: 400 });
      }

      const hasGoogle = !!currentUser.google_id;
      const hasEmailLogin =
        currentUser.auth_type === 'email' &&
        !!currentUser.email &&
        currentUser.email_verified === true;

      if (!hasGoogle && !hasEmailLogin) {
        return NextResponse.json({ error: 'LAST_AUTH_METHOD' }, { status: 400 });
      }

      await dbQuery(
        `UPDATE users
            SET telegram_id = NULL,
                last_seen_at = NOW()
          WHERE id = $1;`,
        [currentUser.id]
      );

      return NextResponse.json({ ok: true, message: 'Telegram unlinked' });
    }

    // Unlink Google from the current user.
    //
    // Safety: block the operation if this would leave the account with no
    // alternative way to sign in. A user must retain at least one of:
    //   - a Telegram binding (telegram_id != NULL), OR
    //   - a verified email with a password (auth_type === 'email' && email_verified)
    // Otherwise removing google_id would effectively lock them out.
    if (action === 'unlink_google') {
      if (!currentUser.google_id) {
        return NextResponse.json({ error: 'NOT_LINKED' }, { status: 400 });
      }

      const hasTelegram = currentUser.telegram_id !== null && currentUser.telegram_id !== undefined;
      const hasEmailLogin =
        currentUser.auth_type === 'email' &&
        !!currentUser.email &&
        currentUser.email_verified === true;

      if (!hasTelegram && !hasEmailLogin) {
        return NextResponse.json({ error: 'LAST_AUTH_METHOD' }, { status: 400 });
      }

      // If the user originally registered via Google, switch auth_type so the
      // account remains valid (avoids a dangling 'google' registration with no
      // google_id). Prefer telegram, fall back to email.
      const newAuthType =
        currentUser.auth_type === 'google'
          ? (hasTelegram ? 'telegram' : 'email')
          : currentUser.auth_type;

      await dbQuery(
        `UPDATE users
            SET google_id = NULL,
                auth_type = $2,
                last_seen_at = NOW()
          WHERE id = $1;`,
        [currentUser.id, newAuthType]
      );

      return NextResponse.json({ ok: true, message: 'Google unlinked' });
    }

    if (action === 'verify_email_send') {
      if (!currentUser.email) {
        return NextResponse.json({ error: 'No email to verify' }, { status: 400 });
      }

      // Generate code and send email (reuse existing email code system)
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await dbQuery(
        `INSERT INTO email_codes (email, code) VALUES ($1, $2);`,
        [currentUser.email, code]
      );

      // Send via existing email infra
      try {
        const { sendVerificationCode } = await import('@/lib/email');
        await sendVerificationCode(currentUser.email, code);
      } catch (e) {
        console.error('Failed to send verification email:', e);
        return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
      }

      return NextResponse.json({ ok: true, message: 'Verification code sent' });
    }

    if (action === 'verify_email_code') {
      const { code } = body;
      if (!code || !currentUser.email) {
        return NextResponse.json({ error: 'Code and email required' }, { status: 400 });
      }

      const codeResult = await dbQuery(
        `SELECT id FROM email_codes WHERE email = $1 AND code = $2 AND used = false AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1;`,
        [currentUser.email, code]
      );

      if (codeResult.rows.length === 0) {
        return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
      }

      await dbQuery(`UPDATE email_codes SET used = true WHERE id = $1;`, [codeResult.rows[0].id]);
      await dbQuery(`UPDATE users SET email_verified = true WHERE id = $1;`, [currentUser.id]);

      return NextResponse.json({ ok: true, message: 'Email verified' });
    }

    // Delete the account permanently.
    //
    // ONLY allowed if `auth_type === 'email'` (the user registered via email
    // and explicitly wants to remove all their data). Telegram-registered
    // users can't trigger this from the Mini App — they would simply stop
    // using it; their account remains in case they return.
    //
    // Safety:
    //   - The UI requires the user to type a confirmation phrase before
    //     calling this action.
    //   - All FK columns referencing users.id are `ON DELETE CASCADE` (see
    //     db/schema.sql), so a single DELETE removes:
    //       subscriptions, vpn_keys, payments, promo_code_uses, email_sessions,
    //       support_tickets (+ messages), fragment_orders, service_requests
    //       (+ messages), device_sessions.
    //   - `uuid_pool.assigned_to_key_id` is `ON DELETE SET NULL`, so the user's
    //     UUIDs return to the free pool automatically when their vpn_keys are
    //     cascade-deleted. We then trigger an Xray sync so the server's active
    //     client list re-labels them as `pool-N` (soft-kicks any cached client
    //     config on the next Xray restart, ≤ 5 min).
    //   - `logs.user_id` is `ON DELETE SET NULL` — audit history is preserved
    //     anonymously.
    if (action === 'delete_account') {
      if (currentUser.auth_type !== 'email') {
        return NextResponse.json({ error: 'CANNOT_DELETE_NON_EMAIL' }, { status: 400 });
      }

      const userId = currentUser.id;

      // Single DELETE — all dependent rows cascade away.
      await dbQuery(`DELETE FROM users WHERE id = $1;`, [userId]);

      // Best-effort: tell the NL VPS to refresh its client list so the
      // user's UUID labels flip back to `pool-N` immediately. Fire-and-forget
      // so a slow webhook doesn't block the response.
      try {
        const { triggerXraySync } = await import('@/lib/xray-webhook');
        await triggerXraySync('fire-and-forget');
      } catch (e) {
        console.error('Xray sync after account deletion failed:', e);
      }

      return NextResponse.json({ ok: true, message: 'Account deleted' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Account action error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
