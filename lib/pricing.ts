/**
 * Centralised pricing model for HundlerVPN subscription purchases.
 *
 * Used by:
 *   - `app/page.tsx` (Mini App PaymentView)
 *   - `app/api/payments/sbp/create/route.ts` (server-side amount validation)
 *   - `app/api/crypto-invoice/route.ts` (server-side amount validation)
 *   - mirrored verbatim in `bot-chat/handlers/buy.py` Python module so
 *     the Telegram chat-bot inline buttons compute the same numbers.
 *
 * Pricing model (2026-05-09):
 *   - Flat 7 ₽/day base price
 *   - Automatic duration discount tier:
 *       6 months  (180 ≤ days < 365)  → 10 % off
 *       1 year+   (days ≥ 365)        → 15 % off
 *   - Optional promo code multiplicative on top of the duration discount
 *     (i.e. final = raw × (1 − duration%) × (1 − promo%))
 *
 * Why multiplicative stacking:
 *   - Cannot drop below 0 even with two ~50 % discounts (additive could).
 *   - Matches what most e-commerce checkouts do (Shopify, WooCommerce).
 *   - Promo codes still feel rewarding on top of the auto-discount because
 *     they always knock another absolute amount off the already-reduced
 *     subtotal.
 */

export const PRICE_PER_DAY_RUB = 7;

/**
 * Returns the auto-discount percentage (0/10/15) for a given duration in days.
 * Floor-step function — no interpolation between tiers.
 */
export function getDurationDiscountPercent(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0;
  if (days >= 365) return 15;
  if (days >= 180) return 10;
  return 0;
}

export type PricingBreakdown = {
  /** Days requested by the user. */
  days: number;
  /** Raw subtotal: days × PRICE_PER_DAY_RUB. */
  rawTotal: number;
  /** Auto-discount tier percentage (0/10/15). */
  durationDiscountPercent: number;
  /** Absolute amount knocked off by the duration discount, ₽. */
  durationDiscountAmount: number;
  /** Subtotal after the duration discount, before promo. */
  subtotalAfterDuration: number;
  /** Promo discount percentage (0–100), 0 if no promo. */
  promoDiscountPercent: number;
  /** Absolute amount knocked off by the promo, ₽. */
  promoDiscountAmount: number;
  /** Final price after BOTH discounts, ₽ (integer). */
  finalTotal: number;
};

/**
 * Compute the full pricing breakdown for `days` (with optional promo % off).
 *
 * Both percentages stack multiplicatively. Result is always non-negative
 * integer-valued ₽ (rounded after the final multiplication).
 */
export function calculatePricing(days: number, promoPercent: number = 0): PricingBreakdown {
  const safeDays = Math.max(0, Math.floor(Number.isFinite(days) ? days : 0));
  const safePromoPct = Math.max(0, Math.min(100, Number.isFinite(promoPercent) ? promoPercent : 0));

  const rawTotal = safeDays * PRICE_PER_DAY_RUB;
  const durationPct = getDurationDiscountPercent(safeDays);
  const subtotalAfterDuration = Math.round((rawTotal * (100 - durationPct)) / 100);
  const finalTotal = Math.round((subtotalAfterDuration * (100 - safePromoPct)) / 100);

  return {
    days: safeDays,
    rawTotal,
    durationDiscountPercent: durationPct,
    durationDiscountAmount: rawTotal - subtotalAfterDuration,
    subtotalAfterDuration,
    promoDiscountPercent: safePromoPct,
    promoDiscountAmount: subtotalAfterDuration - finalTotal,
    finalTotal,
  };
}

/**
 * Server-side amount validator. The client (mini-app or chat-bot) sends
 * `{ days, amount, promoPercent }` to /api/payments/sbp/create or
 * /api/crypto-invoice. We recompute what the price SHOULD be and reject
 * the request if the client tampered with `amount`.
 *
 * Returns null if validation passes; an error string otherwise.
 *
 * Slack: ±1 ₽ tolerance for legacy clients that may use a slightly
 * different rounding rule on the duration discount step.
 */
export function validateClientAmount(
  days: number,
  clientAmount: number,
  promoPercent: number = 0,
): string | null {
  const breakdown = calculatePricing(days, promoPercent);
  if (typeof clientAmount !== 'number' || !Number.isFinite(clientAmount) || clientAmount < 0) {
    return 'Invalid amount';
  }
  const diff = Math.abs(clientAmount - breakdown.finalTotal);
  if (diff > 1) {
    return `Amount mismatch: client sent ${clientAmount}₽, server computed ${breakdown.finalTotal}₽ (days=${days}, promo=${promoPercent}%)`;
  }
  return null;
}
