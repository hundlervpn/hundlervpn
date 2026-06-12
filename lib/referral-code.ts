/**
 * Referral-code encoding used for the Telegram `?startapp=ref_<code>` param.
 *
 * Two formats coexist in `users.referral_code`:
 *
 *   - `u{base36(telegramId)}` — users whose PRIMARY identity is their
 *     Telegram account. Generated at INSERT time in `upsertTelegramUser`
 *     (Mini App flow) and `/api/auth/telegram-login` (web Login Widget).
 *
 *   - `e{base36(userId)}` — users registered via email / Google / any
 *     non-Telegram path. Generated after INSERT (because `users.id` is a
 *     BIGSERIAL, not known until the row is written).
 *
 * Both prefixes guarantee collision-free unique codes because telegram_id
 * space and users.id space never overlap in the same prefix.
 *
 * Parsing is prefix-agnostic — lookups just do `WHERE referral_code = $1`
 * regardless of how the code was generated. The same code works in BOTH
 * entry points:
 *   - Telegram Mini App: `startapp=ref_<code>` → /api/users/sync.
 *   - Website (since 2026-06-12): `?ref=<code>` on hundlervpn.xyz →
 *     captured on the landing/login page and attributed at email/Google
 *     signup via `attachSiteReferral` (lib/access.ts). This lets an
 *     email/Google-registered invitee credit their inviter with the 10%
 *     CASH reward (lib/referral-cash.ts) WITHOUT joining via Telegram.
 *     Note: email/Google referrals are cash-only — no bonus DAYS (those
 *     remain a Telegram-registration perk, gated in applyReferralReward).
 */

export function buildReferralCodeForTelegramUser(telegramId: number): string {
  return `u${telegramId.toString(36)}`;
}

export function buildReferralCodeForUser(userId: number): string {
  return `e${userId.toString(36)}`;
}

/**
 * Convenience: given both identifiers, return the canonical code that
 * should live in `users.referral_code` for this user. Prefer the
 * telegram-based code when `telegramId` is present (it matches what
 * `upsertTelegramUser` writes), otherwise fall back to the user-id form.
 */
export function canonicalReferralCode(userId: number, telegramId: number | null | undefined): string {
  if (telegramId && Number.isFinite(telegramId)) {
    return buildReferralCodeForTelegramUser(Number(telegramId));
  }
  return buildReferralCodeForUser(userId);
}
