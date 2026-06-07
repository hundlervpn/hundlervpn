import { randomInt } from 'crypto';
import type { PoolClient } from 'pg';
import {
  activateSubscriptionForHours,
  ensureNamedPlan,
  ensureVpnKey,
} from '@/lib/access';

// ────────────────────────────────────────────────────────────────────────────
// Daily / Super Boxes (2026-05-21).
//
// v3 (2026-05-21 night): mixed reward pool — drops are EITHER subscription
// hours OR a one-shot 24h discount coupon (auto-issued promo_code with
// max_uses=1 and expires_at = NOW()+24h). The coupon is bound to the
// specific user that rolled it via promo_code_uses on apply. Coupons let
// us hand out value without donating real VPN bandwidth on every open.
//
// v2 (2026-05-21 evening): reward_value is hours, not days.
//
// Race-condition fix: the first openBox() for a user used to leave a
// window where two concurrent requests could both miss the (non-
// existent) state row and both roll a reward. We now pre-INSERT an
// empty state row with ON CONFLICT DO NOTHING, then SELECT FOR UPDATE
// it — that guarantees one transaction owns the row across the whole
// reward-rolling block.
// ────────────────────────────────────────────────────────────────────────────

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h
const STREAK_GRACE_MS = 48 * 60 * 60 * 1000; // miss >48h since last open → reset
const SUPER_BOX_INTERVAL = 7; // every 7th open is a super box
const RECENT_REWARDS_LIMIT = 10;
const COUPON_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const COUPON_CODE_LENGTH = 6;
const COUPON_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O — visually ambiguous
const COUPON_CODE_PREFIX = 'BOX'; // makes box coupons easy to spot in admin / DB

export type BoxKind = 'daily' | 'super';
export type RewardKind = 'subscription_hours' | 'discount_coupon';
export type BoxRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type BoxRewardOption = {
  kind: RewardKind;
  value: number; // hours (subscription_hours) OR percent (discount_coupon)
  weight: number; // relative weight (positive integer)
  rarity: BoxRarity;
};

// Daily box reward table — mixed pool of coupons and short subscription
// extensions. Total weight = 1000. v4 (2026-05-21 late): all coupons
// shifted -10 pp (15→5, 20→10, 30→20, 50→40), the 10%-coupon entry
// removed entirely, and the freed weight redistributed into the lowest
// tiers so cheap drops dominate. Probabilities:
//   5% coupon: 45%, +4h sub: 23%, 10% coupon: 17%, +12h sub: 8%,
//   20% coupon: 4%, +24h sub: 2%, +72h sub: 0.7%, 40% coupon: 0.2%,
//   +168h sub (7d): 0.1%.
const DAILY_REWARDS: BoxRewardOption[] = [
  { kind: 'discount_coupon',    value: 5,   weight: 450, rarity: 'common' },
  { kind: 'subscription_hours', value: 4,   weight: 230, rarity: 'common' },
  { kind: 'discount_coupon',    value: 10,  weight: 170, rarity: 'uncommon' },
  { kind: 'subscription_hours', value: 12,  weight: 80,  rarity: 'uncommon' },
  { kind: 'discount_coupon',    value: 20,  weight: 40,  rarity: 'rare' },
  { kind: 'subscription_hours', value: 24,  weight: 20,  rarity: 'rare' },
  { kind: 'subscription_hours', value: 72,  weight: 7,   rarity: 'epic' },
  { kind: 'discount_coupon',    value: 40,  weight: 2,   rarity: 'epic' },
  { kind: 'subscription_hours', value: 168, weight: 1,   rarity: 'legendary' },
];

// Super box (every 7th open). Total weight = 10000. v4 (2026-05-21
// late): the 99%-coupon legendary is removed (way too generous —
// effectively a free month for one click). Coupons -10 pp across the
// board (20→10, 30→20, 50→40). Probabilities:
//   +12h: 25%, 10% coupon: 20%, +24h: 18%, 20% coupon: 12%,
//   +48h: 12%, 40% coupon: 7%, +168h (7d): 4%, +336h (14d): 1.5%,
//   +720h (30d): 0.4%, +2160h (90d): 0.1%.
const SUPER_REWARDS: BoxRewardOption[] = [
  { kind: 'subscription_hours', value: 12,   weight: 2500, rarity: 'common' },
  { kind: 'discount_coupon',    value: 10,   weight: 2000, rarity: 'common' },
  { kind: 'subscription_hours', value: 24,   weight: 1800, rarity: 'uncommon' },
  { kind: 'discount_coupon',    value: 20,   weight: 1200, rarity: 'uncommon' },
  { kind: 'subscription_hours', value: 48,   weight: 1200, rarity: 'rare' },
  { kind: 'discount_coupon',    value: 40,   weight: 700,  rarity: 'rare' },
  { kind: 'subscription_hours', value: 168,  weight: 400,  rarity: 'epic' },
  { kind: 'subscription_hours', value: 336,  weight: 150,  rarity: 'epic' },
  { kind: 'subscription_hours', value: 720,  weight: 40,   rarity: 'legendary' },
  { kind: 'subscription_hours', value: 2160, weight: 10,   rarity: 'legendary' },
];

export const BOX_REWARD_TABLES = {
  daily: DAILY_REWARDS,
  super: SUPER_REWARDS,
} as const;

export const BOX_REWARD_PLAN_NAME = 'Daily Box Reward';
export const BOX_REWARD_PLAN_DURATION_DAYS = 1;

// 6-character random suffix using a no-ambiguity alphabet (no I/O/0/1).
// We prefix with 'BOX' so admin tools can spot box-issued codes at a
// glance (e.g. for cleanup of expired ones). Total displayed length = 9.
function randomCouponSuffix(): string {
  let out = '';
  for (let i = 0; i < COUPON_CODE_LENGTH; i++) {
    out += COUPON_CODE_ALPHABET[randomInt(0, COUPON_CODE_ALPHABET.length)];
  }
  return out;
}

// Insert a fresh promo_codes row with a unique random code. Retries on
// the rare UNIQUE collision (same suffix happens to exist already) up
// to 5 times — at 24⁶ = 191 million combinations the collision space is
// astronomical, but we still guard for it.
async function issueBoxCoupon(
  client: PoolClient,
  options: { userId: number; discountPercent: number },
): Promise<{ promoCodeId: number; code: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + COUPON_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${COUPON_CODE_PREFIX}${randomCouponSuffix()}`;
    try {
      const result = await client.query<{ id: number }>(
        `INSERT INTO promo_codes
           (code, days, discount_percent, max_uses, used_count, is_active,
            created_by, created_at, expires_at)
         VALUES ($1, 0, $2, 1, 0, TRUE, $3, NOW(), $4)
         RETURNING id;`,
        [code, options.discountPercent, options.userId, expiresAt],
      );
      return { promoCodeId: result.rows[0].id, code, expiresAt };
    } catch (e: any) {
      if (e?.code === '23505') continue; // unique violation, retry
      throw e;
    }
  }
  throw new Error('Failed to generate unique coupon code after 5 attempts');
}

type BoxStateRow = {
  user_id: number;
  current_streak: number;
  total_opens: number;
  last_opened_at: Date | null;
  next_available_at: Date | null;
};

type BoxRewardRow = {
  id: number;
  box_kind: BoxKind;
  reward_kind: RewardKind | 'subscription_days'; // legacy rows
  reward_value: number;
  streak_at_open: number;
  created_at: Date;
  metadata: BoxRewardMetadata | null;
};

// Metadata persisted on every box_rewards row. We keep coupon code
// + promo_id + expiry here so the history feed can render the same
// info (and a "still valid?" label) without joining promo_codes.
type BoxRewardMetadata = {
  rarity?: BoxRarity;
  couponCode?: string;
  promoCodeId?: number;
  couponExpiresAt?: string; // ISO
  discountPercent?: number;
};

export type RewardHistoryItem = {
  id: number;
  boxKind: BoxKind;
  rewardKind: RewardKind | 'subscription_days';
  rewardValue: number;
  rewardHours: number;     // 0 for coupons
  rarity: BoxRarity;
  // Coupon-specific (only present when rewardKind = 'discount_coupon').
  couponCode?: string;
  discountPercent?: number;
  couponExpiresAt?: string;
  couponExpired?: boolean; // computed at response time
  streakAtOpen: number;
  createdAt: string;
};

export type BoxStateResponse = {
  currentStreak: number;
  totalOpens: number;
  lastOpenedAt: string | null;
  nextAvailableAt: string | null;
  canOpenNow: boolean;
  upcomingStreak: number;
  upcomingBoxKind: BoxKind;
  cooldownMs: number;
  streakLength: number;
  recentRewards: RewardHistoryItem[];
};

export type OpenBoxResult = {
  reward: {
    boxKind: BoxKind;
    rewardKind: RewardKind;
    rewardValue: number;     // hours OR percent depending on kind
    rewardHours: number;     // 0 for coupons
    rarity: BoxRarity;
    couponCode?: string;
    discountPercent?: number;
    couponExpiresAt?: string;
  };
  streakAtOpen: number;
  state: BoxStateResponse;
};

// Pick one option from a weighted table.
//
// Uses crypto.randomInt (CSPRNG, /dev/urandom on Linux) so the
// distribution is statistically uniform and provably unbiased — Math.random()
// in V8 is xorshift128+, which is fine but doesn't carry the same
// guarantee, and users have started questioning whether legendary drops
// happen "more often than 0.7%". With a CSPRNG there is no longer any
// hidden bias to argue about: the only knobs are the weights below, and
// all weights are integers so randomInt(0, totalWeight) is perfectly
// uniform across the [0, totalWeight) range.
function pickWeighted<T extends { weight: number }>(options: T[]): T {
  if (options.length === 0) {
    throw new Error('pickWeighted: empty options array');
  }
  const totalWeight = options.reduce((sum, opt) => sum + Math.max(0, Math.floor(opt.weight)), 0);
  if (totalWeight <= 0) {
    return options[0];
  }
  // randomInt(min, max) returns [min, max) — perfect for inclusive 0,
  // exclusive totalWeight which is what cumulative-weight selection needs.
  const roll = randomInt(0, totalWeight);
  let acc = 0;
  for (const opt of options) {
    acc += Math.max(0, Math.floor(opt.weight));
    if (roll < acc) {
      return opt;
    }
  }
  // Unreachable because totalWeight > 0 means at least one positive
  // weight exists and acc will reach totalWeight by the last iteration,
  // but TS wants an explicit return.
  return options[options.length - 1];
}

function computeUpcomingStreak(state: BoxStateRow | null, now: Date): number {
  if (!state || !state.last_opened_at) {
    return 1;
  }
  const sinceLast = now.getTime() - new Date(state.last_opened_at).getTime();
  if (sinceLast > STREAK_GRACE_MS) {
    return 1;
  }
  return state.current_streak + 1;
}

function boxKindForStreak(streak: number): BoxKind {
  return streak > 0 && streak % SUPER_BOX_INTERVAL === 0 ? 'super' : 'daily';
}

async function loadStateRow(
  client: PoolClient,
  userId: number,
  forUpdate: boolean,
): Promise<BoxStateRow | null> {
  const lockClause = forUpdate ? ' FOR UPDATE' : '';
  const result = await client.query<BoxStateRow>(
    `SELECT user_id, current_streak, total_opens, last_opened_at, next_available_at
       FROM box_user_state
      WHERE user_id = $1
      LIMIT 1${lockClause};`,
    [userId],
  );
  return result.rows[0] ?? null;
}

async function loadRecentRewards(
  client: PoolClient,
  userId: number,
  limit: number,
): Promise<BoxRewardRow[]> {
  const result = await client.query<BoxRewardRow>(
    `SELECT id, box_kind, reward_kind, reward_value, streak_at_open, created_at, metadata
       FROM box_rewards
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2;`,
    [userId, limit],
  );
  return result.rows;
}

// Convert a row's reward_value into canonical hours of subscription.
// Legacy rows (reward_kind = 'subscription_days') stored days; coupon
// rows store percent and contribute zero hours.
function normaliseRewardHours(kind: RewardKind | 'subscription_days', value: number): number {
  if (kind === 'discount_coupon') return 0;
  return kind === 'subscription_hours' ? value : value * 24;
}

// Rarity inference for legacy rows lacking metadata.rarity. Coupons
// always have metadata so this never runs for them; mirrors the
// hours-based DAILY_REWARDS / SUPER_REWARDS tables — keep in sync.
function inferRarityFromHours(boxKind: BoxKind, hours: number): BoxRarity {
  if (boxKind === 'super') {
    if (hours >= 720) return 'legendary';
    if (hours >= 168) return 'epic';
    if (hours >= 48) return 'rare';
    if (hours >= 24) return 'uncommon';
    return 'common';
  }
  if (hours >= 168) return 'legendary';
  if (hours >= 48) return 'epic';
  if (hours >= 24) return 'rare';
  if (hours >= 8) return 'uncommon';
  return 'common';
}

export function rewardRowToHistoryItem(r: BoxRewardRow, now: Date): RewardHistoryItem {
  const hours = normaliseRewardHours(r.reward_kind, r.reward_value);
  const rarity = r.metadata?.rarity ?? inferRarityFromHours(r.box_kind, hours);
  const item: RewardHistoryItem = {
    id: r.id,
    boxKind: r.box_kind,
    rewardKind: r.reward_kind,
    rewardValue: r.reward_value,
    rewardHours: hours,
    rarity,
    streakAtOpen: r.streak_at_open,
    createdAt: new Date(r.created_at).toISOString(),
  };
  if (r.reward_kind === 'discount_coupon' && r.metadata) {
    item.couponCode = r.metadata.couponCode;
    item.discountPercent = r.metadata.discountPercent ?? r.reward_value;
    item.couponExpiresAt = r.metadata.couponExpiresAt;
    if (r.metadata.couponExpiresAt) {
      item.couponExpired = new Date(r.metadata.couponExpiresAt).getTime() <= now.getTime();
    }
  }
  return item;
}

function buildStateResponse(
  state: BoxStateRow | null,
  recent: BoxRewardRow[],
  now: Date,
): BoxStateResponse {
  const currentStreak = state?.current_streak ?? 0;
  const totalOpens = state?.total_opens ?? 0;
  const lastOpenedAt = state?.last_opened_at ?? null;
  const nextAvailableAt = state?.next_available_at ?? null;
  const canOpenNow = !nextAvailableAt || new Date(nextAvailableAt).getTime() <= now.getTime();
  const upcomingStreak = computeUpcomingStreak(state, now);
  const upcomingBoxKind = boxKindForStreak(upcomingStreak);
  return {
    currentStreak,
    totalOpens,
    lastOpenedAt: lastOpenedAt ? new Date(lastOpenedAt).toISOString() : null,
    nextAvailableAt: nextAvailableAt ? new Date(nextAvailableAt).toISOString() : null,
    canOpenNow,
    upcomingStreak,
    upcomingBoxKind,
    cooldownMs: COOLDOWN_MS,
    streakLength: SUPER_BOX_INTERVAL,
    recentRewards: recent.map((r) => rewardRowToHistoryItem(r, now)),
  };
}

export async function getBoxState(
  client: PoolClient,
  userId: number,
): Promise<BoxStateResponse> {
  const state = await loadStateRow(client, userId, false);
  const recent = await loadRecentRewards(client, userId, RECENT_REWARDS_LIMIT);
  return buildStateResponse(state, recent, new Date());
}

// Full reward feed for a user — used by /api/boxes/rewards (history tab).
// Limit is bounded server-side to prevent runaway queries.
export async function getUserRewardHistory(
  client: PoolClient,
  userId: number,
  limit: number,
  offset: number,
): Promise<{ items: RewardHistoryItem[]; total: number }> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  // LEFT JOIN promo_codes via metadata->promoCodeId so the "used /
  // expired" badges on the user-facing history match what the checkout
  // flow + admin panel see. metadata is just a snapshot from issuance
  // time; the actual state lives in promo_codes.
  type Row = BoxRewardRow & {
    promo_used_count: number | null;
    promo_max_uses: number | null;
    promo_expires_at: Date | null;
  };
  const rows = await client.query<Row>(
    `SELECT br.id, br.box_kind, br.reward_kind, br.reward_value, br.streak_at_open,
            br.created_at, br.metadata,
            pc.used_count AS promo_used_count,
            pc.max_uses   AS promo_max_uses,
            pc.expires_at AS promo_expires_at
       FROM box_rewards br
       LEFT JOIN promo_codes pc ON pc.id = NULLIF(br.metadata->>'promoCodeId', '')::int
      WHERE br.user_id = $1
      ORDER BY br.created_at DESC, br.id DESC
      LIMIT $2 OFFSET $3;`,
    [userId, safeLimit, safeOffset],
  );
  const totalRow = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM box_rewards WHERE user_id = $1;`,
    [userId],
  );
  const now = new Date();
  const items: RewardHistoryItem[] = rows.rows.map((r) => {
    const item = rewardRowToHistoryItem(r, now);
    if (item.rewardKind === 'discount_coupon') {
      // Prefer promo_codes.expires_at (truth) over metadata snapshot.
      if (r.promo_expires_at) {
        item.couponExpiresAt = new Date(r.promo_expires_at).toISOString();
        item.couponExpired = new Date(r.promo_expires_at).getTime() <= now.getTime();
      }
      // Treat redeemed coupons as "no longer usable" — surface that as
      // `couponExpired = true` so the BoxesHistoryView strikes them
      // through and disables the copy button.
      if (r.promo_used_count !== null && r.promo_used_count >= (r.promo_max_uses ?? 1)) {
        item.couponExpired = true;
      }
    }
    return item;
  });
  return {
    items,
    total: parseInt(totalRow.rows[0]?.count ?? '0', 10),
  };
}

// Wipe the caller's reward history. Hard delete of `box_rewards` rows
// for this user_id. Returns the number of rows actually removed.
//
// What is INTENTIONALLY preserved:
//   - `box_user_state` (current_streak, total_opens, last_opened_at,
//     next_available_at). Clearing the history does NOT reset the
//     cooldown or break the streak — those are separate concepts. If
//     a user wants to reset progress too, the admin has a dedicated
//     `/api/boxes/admin/reset` endpoint for that.
//   - `promo_codes` issued by previous box opens. Those coupons may
//     already be redeemed or still active; the user can't claw them
//     back by tidying their history feed. We just stop showing the
//     reward row that links to them.
//   - `subscriptions` granted by hours-rewards. Hours that were already
//     credited to the account stay credited; deleting the history row
//     does not subtract subscription days.
//
// Why CASCADE is safe here: `applied_subscription_id` is only used to
// label the history feed, not to compute access elsewhere — the
// subscriptions table is the source of truth for VPN entitlements.
export async function clearUserRewardHistory(
  client: PoolClient,
  userId: number,
): Promise<number> {
  const res = await client.query(
    `DELETE FROM box_rewards WHERE user_id = $1;`,
    [userId],
  );
  return res.rowCount ?? 0;
}

export class BoxCooldownError extends Error {
  readonly nextAvailableAt: Date;
  constructor(nextAvailableAt: Date) {
    super('Box cooldown active');
    this.name = 'BoxCooldownError';
    this.nextAvailableAt = nextAvailableAt;
  }
}

// Thrown when a user without a linked telegram_id tries to interact with the
// boxes feature. Boxes are a retention loop that depends on Telegram push
// notifications ("your daily box is ready", coupon-expiry warnings) — without
// a TG account the reward funnel is broken on our side, and the user sees
// "claimed!" but never gets reminded to come back. We therefore block the
// feature for email-only accounts at the API layer and surface a CTA on the
// frontend that walks them through `/api/auth/telegram/start-link`.
export class BoxTelegramRequiredError extends Error {
  constructor() {
    super('telegram_required');
    this.name = 'BoxTelegramRequiredError';
  }
}

// Resolves whether a user has a linked Telegram account. Throws
// BoxTelegramRequiredError if not — callers in the boxes routes should let
// it bubble and translate it to HTTP 403 with `error: 'telegram_required'`.
// Note: the user MUST already exist (caller has resolved dbUserId); we don't
// 404 here because that case is handled upstream.
export async function assertTelegramLinked(
  client: PoolClient,
  userId: number,
): Promise<void> {
  const r = await client.query<{ telegram_id: string | null }>(
    'SELECT telegram_id FROM users WHERE id = $1 LIMIT 1;',
    [userId],
  );
  if (!r.rows[0] || r.rows[0].telegram_id === null) {
    throw new BoxTelegramRequiredError();
  }
}

export async function openBox(
  client: PoolClient,
  userId: number,
): Promise<OpenBoxResult> {
  const now = new Date();

  // Race-safe lock acquisition. Pre-insert an empty state row so the
  // subsequent FOR UPDATE always has something to lock — even for a
  // first-ever opener. Without this, two concurrent first-opens both saw
  // NULL and both rolled rewards (the bug the user just hit on prod).
  await client.query(
    `INSERT INTO box_user_state (user_id, current_streak, total_opens)
     VALUES ($1, 0, 0)
     ON CONFLICT (user_id) DO NOTHING;`,
    [userId],
  );

  const existing = await loadStateRow(client, userId, true);

  if (existing?.next_available_at && new Date(existing.next_available_at).getTime() > now.getTime()) {
    throw new BoxCooldownError(new Date(existing.next_available_at));
  }

  const newStreak = computeUpcomingStreak(existing, now);
  const boxKind = boxKindForStreak(newStreak);
  const table = BOX_REWARD_TABLES[boxKind];
  const reward = pickWeighted(table);

  // Materialise the reward.
  let appliedSubscriptionId: number | null = null;
  let metadata: BoxRewardMetadata = { rarity: reward.rarity };
  let rewardHours = 0;

  if (reward.kind === 'subscription_hours') {
    const planId = await ensureNamedPlan(client, {
      name: BOX_REWARD_PLAN_NAME,
      durationDays: BOX_REWARD_PLAN_DURATION_DAYS,
      price: 0,
      maxDevices: 3,
      trafficLimit: null,
    });

    const sub = await activateSubscriptionForHours(client, {
      userId,
      planId,
      hours: reward.value,
    });
    appliedSubscriptionId = sub.subscriptionId;
    rewardHours = reward.value;

    await ensureVpnKey(client, {
      userId,
      subscriptionId: sub.subscriptionId,
      expiresAt: sub.endDate,
      deviceName: 'Daily Box Reward',
      // v4 (2026-05-21 late): box rewards land on already-subscribed
      // users — they're already connected to a VPS, so the new
      // subscription_id can propagate via the next ~1-min cron poll
      // instead of the synchronous 'wait' webhook (~1 s). This is what
      // made the "часы выпали — кнопка тупит ещё секунду" complaint:
      // coupons take ~50 ms (just one INSERT), hours used to wait for
      // every VPN VPS to confirm xray-sync. Now both paths respond in
      // <100 ms, the box reveal animation stays snappy.
      awaitSync: false,
    });
  } else if (reward.kind === 'discount_coupon') {
    const coupon = await issueBoxCoupon(client, {
      userId,
      discountPercent: reward.value,
    });
    metadata = {
      ...metadata,
      couponCode: coupon.code,
      promoCodeId: coupon.promoCodeId,
      couponExpiresAt: coupon.expiresAt.toISOString(),
      discountPercent: reward.value,
    };
  }

  await client.query(
    `INSERT INTO box_rewards
       (user_id, box_kind, reward_kind, reward_value, streak_at_open,
        applied_subscription_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7);`,
    [
      userId,
      boxKind,
      reward.kind,
      reward.value,
      newStreak,
      appliedSubscriptionId,
      JSON.stringify(metadata),
    ],
  );

  const nextAvailableAt = new Date(now.getTime() + COOLDOWN_MS);

  // v5 (2026-05-22): reset current_streak back to 0 after a SUPER box
  // open so the user starts a fresh daily cycle (1→2→…→7=SUPER again).
  // Without this, streak would keep climbing past 7 — and while
  // boxKindForStreak() still flagged every 7th open as SUPER (14, 21,
  // 28…), the displayed streak number kept growing unboundedly and the
  // "progress to next SUPER" UI math relied on `streak % 7`, which got
  // confusing for the user. Cleaner semantics: SUPER is the climax,
  // then we're back to zero and the user works toward the next SUPER.
  //
  // streakAtOpen stays = newStreak (the unmutated 7) so box_rewards
  // history correctly logs "this open happened at streak 7". The user
  // sees in their history feed: 1,2,3,4,5,6,7★,1,2,3… — exactly what
  // you'd expect.
  const persistedStreak = boxKind === 'super' ? 0 : newStreak;

  await client.query(
    `UPDATE box_user_state
        SET current_streak    = $2,
            total_opens       = total_opens + 1,
            last_opened_at    = $3,
            next_available_at = $4,
            updated_at        = NOW()
      WHERE user_id = $1;`,
    [userId, persistedStreak, now, nextAvailableAt],
  );

  const updatedState = await loadStateRow(client, userId, false);
  const recent = await loadRecentRewards(client, userId, RECENT_REWARDS_LIMIT);

  const rewardOut: OpenBoxResult['reward'] = {
    boxKind,
    rewardKind: reward.kind,
    rewardValue: reward.value,
    rewardHours,
    rarity: reward.rarity,
  };
  if (reward.kind === 'discount_coupon') {
    rewardOut.couponCode = metadata.couponCode;
    rewardOut.discountPercent = metadata.discountPercent;
    rewardOut.couponExpiresAt = metadata.couponExpiresAt;
  }

  return {
    reward: rewardOut,
    streakAtOpen: newStreak,
    state: buildStateResponse(updatedState, recent, new Date()),
  };
}

// Admin-only — clear the user's box state (cooldown + streak) so they can
// open immediately. Optionally also wipes the reward history. Reward
// history is the audit log; clearing it should be reserved for testing.
export async function resetUserBoxState(
  client: PoolClient,
  userId: number,
  options: { wipeHistory?: boolean } = {},
): Promise<BoxStateResponse> {
  await client.query(
    `DELETE FROM box_user_state WHERE user_id = $1;`,
    [userId],
  );
  if (options.wipeHistory) {
    await client.query(
      `DELETE FROM box_rewards WHERE user_id = $1;`,
      [userId],
    );
  }
  return getBoxState(client, userId);
}

// Admin-only — force the user's NEXT box open to be a SUPER box.
//
// Mechanics: SUPER fires whenever `upcomingStreak % SUPER_BOX_INTERVAL === 0`
// (every 7th open). `computeUpcomingStreak` returns `currentStreak + 1`
// when last_opened_at is fresh (within STREAK_GRACE_MS = 48h), else 1.
//
// To make the very next open SUPER we therefore set:
//   - current_streak = SUPER_BOX_INTERVAL - 1   (6 → next will be 7 → super)
//   - last_opened_at = NOW()                    (so grace doesn't reset it)
//   - next_available_at = NULL                  (cooldown cleared, can open NOW)
//
// total_opens is preserved for existing users (left untouched in ON CONFLICT).
//
// This is intentionally an admin-only debug helper — used to test the
// SUPER reveal flow without grinding 7 daily opens. It DOES rotate the
// rest of the streak forward, which is fine for testing purposes; if a
// real user accidentally got it, they'd land on a 7-streak afterwards
// (which is harmless: the 8th, 9th, ... opens roll back into daily).
export async function grantSuperBoxToUser(
  client: PoolClient,
  userId: number,
): Promise<BoxStateResponse> {
  const targetStreak = SUPER_BOX_INTERVAL - 1; // 6
  await client.query(
    `INSERT INTO box_user_state
       (user_id, current_streak, total_opens, last_opened_at, next_available_at, updated_at)
     VALUES ($1, $2, 0, NOW(), NULL, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET current_streak    = EXCLUDED.current_streak,
           last_opened_at    = NOW(),
           next_available_at = NULL,
           updated_at        = NOW();`,
    [userId, targetStreak],
  );
  return getBoxState(client, userId);
}
