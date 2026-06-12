import { NextResponse } from 'next/server';
import { dbQuery, getDbPool } from '@/lib/db';
import { randomUUID } from 'crypto';
import { attachSiteReferral, issueTrialAccess, userNeedsInitialTrial } from '@/lib/access';
import { buildReferralCodeForUser } from '@/lib/referral-code';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = (body.email || '').trim().toLowerCase();
    const code = (body.code || '').trim();
    // Site referral code from `?ref=<code>` captured on the web (passed by
    // the login page). Only honoured for BRAND-NEW signups below.
    const refCode = typeof body.ref === 'string' ? body.ref.trim() : '';

    if (!email || !code) {
      return NextResponse.json({ error: 'Email и код обязательны' }, { status: 400 });
    }

    // Find valid code
    const codeRow = await dbQuery(
      `SELECT id, attempts FROM email_codes
       WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1;`,
      [email, code]
    );

    if (codeRow.rows.length === 0) {
      // Increment attempts on latest unused code for this email
      await dbQuery(
        `UPDATE email_codes SET attempts = attempts + 1
         WHERE email = $1 AND used = FALSE AND expires_at > NOW();`,
        [email]
      );
      return NextResponse.json({ error: 'Неверный или истёкший код' }, { status: 400 });
    }

    const row = codeRow.rows[0];
    if (row.attempts >= 5) {
      return NextResponse.json({ error: 'Слишком много попыток. Запросите новый код.' }, { status: 429 });
    }

    // Mark code as used
    await dbQuery(`UPDATE email_codes SET used = TRUE WHERE id = $1;`, [row.id]);

    // Find or create user by email
    let userResult = await dbQuery(
      `SELECT id, email, telegram_id, first_name FROM users WHERE email = $1 LIMIT 1;`,
      [email]
    );

    let userId: number;
    let isNew = false;

    if (userResult.rows.length === 0) {
      // Create new user (email auth)
      const insertResult = await dbQuery(
        `INSERT INTO users (email, email_verified, first_name, auth_type)
         VALUES ($1, TRUE, $2, 'email')
         RETURNING id;`,
        [email, email.split('@')[0]]
      );
      userId = insertResult.rows[0].id;
      isNew = true;
    } else {
      userId = userResult.rows[0].id;
      // Update email_verified if not already
      await dbQuery(
        `UPDATE users SET email_verified = TRUE WHERE id = $1 AND email_verified = FALSE;`,
        [userId]
      );
    }

    // Ensure the email user has a `referral_code` so they can share
    // their invite link from ProfileView. Idempotent — only writes when
    // the column is currently NULL (so existing telegram-linked codes
    // never get overwritten on subsequent email-only logins).
    try {
      await dbQuery(
        `UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL;`,
        [userId, buildReferralCodeForUser(userId)]
      );
    } catch (refErr) {
      // Non-fatal: login still succeeds even if the unique-constraint race
      // bites (extremely unlikely — the prefix-based code is collision-free).
      console.error('[verify-code] referral_code backfill failed:', refErr);
    }

    // Issue initial 3-day trial to brand-new email users (parity with
    // Telegram signup via /api/users/sync). `userNeedsInitialTrial` checks
    // the user has no subscriptions, no paid payments, and no vpn_keys —
    // existing users with prior state never get a duplicate trial.
    // telegramId=0 is passed because issueTrialAccess only uses it to build
    // the subscription URL in its return value, which we don't use here.
    try {
      const pool = getDbPool();
      const client = await pool.connect();
      try {
        // Site referral attribution — ONLY for brand-new email signups.
        // Sets referred_by_user_id (never overwrites) so the inviter earns
        // the 10% CASH reward on this user's future RUB subscription
        // payments. No bonus DAYS are granted for email signups by design.
        if (isNew && refCode) {
          try {
            const { attached, inviterUserId } = await attachSiteReferral(client, userId, refCode);
            if (attached) {
              console.log(`[verify-code] site referral attached: invitee=${userId} inviter=${inviterUserId} (cash-only)`);
            }
          } catch (refAttachErr) {
            console.error('[verify-code] site referral attach failed:', refAttachErr);
          }
        }

        if (await userNeedsInitialTrial(client, userId)) {
          // Email signups get a 1-day trial (vs Telegram's 3-day). Product
          // rule: email signups are easier to mass-create, so the trial is
          // shorter to reduce abuse surface.
          await issueTrialAccess(client, userId, 0, 1);
          console.log(`[verify-code] issued 1-day trial for email user_id=${userId} (${email})`);
        }
      } finally {
        client.release();
      }
    } catch (trialErr) {
      // Non-fatal: user still authenticates even if trial allocation fails.
      // Admin can retrigger trial by applying a promo code or manually.
      console.error('[verify-code] trial issuance failed:', trialErr);
    }

    // Generate session token
    const sessionToken = randomUUID();

    await dbQuery(
      `INSERT INTO email_sessions (user_id, token) VALUES ($1, $2);`,
      [userId, sessionToken]
    );

    // Get full user profile
    userResult = await dbQuery(
      `SELECT id, email, first_name, telegram_id FROM users WHERE id = $1;`,
      [userId]
    );

    const user = userResult.rows[0];

    return NextResponse.json({
      ok: true,
      isNew,
      sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.first_name || email.split('@')[0],
        telegramId: user.telegram_id,
      },
    });
  } catch (error) {
    console.error('Verify code error:', error);
    return NextResponse.json({ error: 'Ошибка верификации' }, { status: 500 });
  }
}
