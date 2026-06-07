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
 * Parsing is prefix-agnostic — `/api/users/sync` just looks up the row by
 * `WHERE referral_code = $1` regardless of how the code was generated.
 * This is important because a user referred by an email-registered user
 * still has to *accept* the invite by joining via Telegram (Mini App), so
 * the inviter lookup happens on the Telegram-side even when the inviter
 * themselves has no Telegram account.
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
