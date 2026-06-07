## Subscriptions & Payments:
- Purchase by days (min 3 days, 6 RUB/day)
- Payment methods: SBP (Platega), Crypto (OxaPay), Telegram Stars
- On payment: creates subscription + vpn_key (UUID) in DB
- UUID synced to VPN servers via cron sync script
- Core logic in lib/access.ts: activateSubscriptionForDays, ensureVpnKey, deactivateExpiredAccess


## Device Tracking & Limit Enforcement

### Data Model:
- Table `device_sessions`: (id, user_id, device_hash, device_name, ip_address, user_agent,
  vpn_key_id, created_at, last_seen_at)
  - `UNIQUE(user_id, device_hash)` — one session per physical device.
  - `vpn_key_id` → FK to `vpn_keys.id`, the per-device UUID used in this client's configs.
- Table `vpn_keys`: per-user-per-device UUIDs. Column `key_uri = 'per-device'` marks keys
  created by the new per-device flow (vs. legacy shared keys with `key_uri != 'per-device'`).
- Table `plans.max_devices` → integer limit (default 3 for all plans).

### Device Identification (UA → device_hash):
- `detectDeviceType(ua, xDeviceOS?)` in `app/api/sub/[token]/route.ts` returns
  `ios`/`android`/`windows`/`macos`/`linux`/`unknown`.
  - First checks `X-Device-OS` header (Remnawave / v2rayTun).
  - Then tries Hiddify/Happ UA format: `Happ/ver/Platform/deviceId`.
  - Falls back to substring match on UA (`iphone`, `android`, `windows`, `darwin`/`cfnetwork`
    for v2rayTun on iOS, …).
- `extractDeviceId(ua)` pulls the stable device ID out of `Happ/ver/Platform/DEVICE_ID` if present.
- `buildDeviceHash(ua, deviceType, xHwid?)`:
  - `hwid_${xHwid}` when v2rayTun sends `X-HWID` (most stable).
  - Otherwise `{deviceType}_{hiddifyDeviceId}` for Happ/Hiddify.
  - Otherwise `{appName}_{deviceType}_{ua_sha256[0:12]}` (v42 fix): includes a 12-char
    SHA256 of the full UA so two different physical devices running the same client on the
    same OS get DIFFERENT hashes. Prior to v42 the fallback was just `{appName}_{deviceType}`
    which collided across all of a user's Windows/Happ devices — kicking one made every
    future Windows/Happ add look kicked. Tradeoff: a UA-changing client update creates a
    new session (takes a slot) until the old one expires by `last_seen_at`.
  - Last-resort fallback: `ua_{ua_sha256[0:12]}` (v42).
- `device_name` shown in UI is built by `formatDeviceName(xDeviceModel, xDeviceOS, deviceType)`:
  1. If `X-Device-Model` sent, strip architecture suffix (`_x86_64` / `_arm64` / …);
     treat mobile-brand-prefixed or whitespace-containing strings as phone models
     (shown verbatim, e.g. "iPhone 14 Pro"); wrap bare hostnames with the OS label
     so `MakuOSV6PC-2722_x86_64` becomes `Windows (MakuOSV6PC-2722)`. Capped length.
  2. Otherwise if UA matches a known VPN client but OS detection failed, use the app
     name from the UA head (e.g. "v2RayTun").
  3. Otherwise `deviceLabel(deviceType)` — "iPhone/iPad" / "Android" / "Windows" / …
- The `device_sessions` upsert refreshes `device_name` on every request
  (`COALESCE(NULLIF(EXCLUDED.device_name, ''), device_sessions.device_name)`) so a format
  improvement propagates to existing rows on the next subscription sync (≤ 1 hour).
- **Browser requests are skipped entirely**: if `deviceType === 'unknown'` AND not a known
  VPN client UA, NO session row is created. Only real VPN clients are tracked.
- **Known client bug**: Happ on iOS sometimes reports `android` in UA. Cannot fix server-side —
  the device shows up as "Android" in UI.

### Per-Session UUIDs (core of kick enforcement, v41):
See the "Per-Session UUID System (v41)" section above for the full design. TL;DR: each
`device_sessions` row has its own `vpn_keys` row with a UUID drawn from `uuid_pool`.
`ensureSessionUuid(sessionId, ...)` in `app/api/sub/[token]/route.ts` handles allocation
and legacy migration.

### Rank-Based Limit Enforcement (race-condition-safe):
Logic lives inline in `GET /api/sub/[token]`. Flow per request:
1. **Upsert session** via `INSERT ... ON CONFLICT (user_id, device_hash) DO UPDATE`. Returns
   `id`, `is_insert = (xmax = 0)`, and `was_kicked_before` (whether the pre-update row had
   `kicked_at IS NOT NULL`).
   - On INSERT, `created_at = NOW()`, `vpn_key_id = NULL`, `kicked_at = NULL`.
   - On UPDATE, v45 changed the UPSERT to ONLY touch `last_seen_at` / `ip_address` /
     `user_agent` / `device_name`. It no longer clears `kicked_at` and no longer resets
     `created_at`. This keeps kicks persistent across subscription auto-refreshes (Happ /
     v2rayTun poll every minute).
2. **v45: kicks are PERSISTENT.** If the row came back with `was_kicked_before = true`
   (plus `kicked_at IS NOT NULL` after the upsert), the sub endpoint returns a dedicated
   **"🚫 Устройство удалено"** error subscription (base64 VLESS URIs or sing-box JSON) and
   skips UUID allocation and rank checks entirely. The device is un-kicked ONLY via the
   admin panel (`POST /api/admin/users/:id/devices/:deviceId?action=unkick`) or the
   self-unkick button in `/api/users/devices`.
3. **Compute rank**: `ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)` among the user's
   sessions with `last_seen_at > NOW() - INTERVAL '30 days' AND kicked_at IS NULL`.
   Kicked rows are excluded from rank/total, so their slot is effectively free for a
   genuinely new device. Rank is **deterministic** across concurrent retries.
4. **Compare `rank` vs `max_devices`**:
   - `rank <= max_devices` → allowed. `ensureSessionUuid` sees `vpn_key_id = NULL` (kick
     cascade cleared it) and allocates a FRESH UUID from the pool.
   - `rank > max_devices` → **blocked** with "⛔ Лимит устройств" error subscription.
     Since the revived session is now the newest, it is the one blocked — not a legit
     newer device the user already set up in between.
5. **Zombie cleanup on over-limit block**: if we JUST INSERTED this session and it landed
   over-limit, `DELETE FROM device_sessions WHERE id = $sessionId` immediately. (For re-kick
   UPDATEs the row stays — it'll be cleaned up naturally by the 30-day `last_seen_at` window
   if never refreshed again.)
6. **Blocked response format** (`profile-title` header adapts):
   - `Device Limit` — over quota.
   - sing-box/Xray clients → `{ meta: null, outbounds: null, remarks: "..." }` JSON.
   - Fallback clients → base64 list of fake `vless://` URIs with the message in `#fragment`.
   - (v43: there is no longer a `Device Removed` format — re-added devices either succeed
     or hit the device-limit response.)

### Fail-Closed Guarantees:
- If the device-tracking SQL throws (DB transient error, schema mismatch, etc.), the endpoint
  returns **503 without a config**, never a fallback "free access". Error detail is logged and
  briefly returned in the response body for remote diagnosis.
- Sessions with `last_seen_at` older than 30 days are ignored in rank/total counts — a user
  who stops using a device for a month automatically frees a slot.

### Kick Device Flow (`DELETE /api/users/devices`) — v48 mechanics (2026-05-17):

**Goal**: owner clicks "удалить" → both VLESS and Hy2 traffic for that device
stop within seconds → owner clicks "обновить" in their VPN client → device
reconnects on a fresh UUID + fresh Hy2 password and is back at e.g. 3/3 slots.
No "Восстановить" button required — the client-side refresh is the recovery
mechanism.

- **Hard DELETE** the session row entirely on owner-initiated kick. The
  `device_hash` slot becomes free immediately; the next /api/sub/[token] poll
  from that physical device (same `device_hash`) creates a brand-new row,
  brand-new `device_sessions.id`, and brand-new per-session Hy2 password.
- UUID purge happens before the row delete:
  - **Exclusive key** → `DELETE FROM uuid_pool WHERE assigned_to_key_id = $id`,
    then `DELETE FROM vpn_keys WHERE id = $id`. The UUID is gone for good.
    `triggerXraySync('wait')` reloads xray on every VLESS server → cached
    VLESS config gets "user not found" within ~1 s.
  - **Shared key (legacy user mid-migration)** → SOFT KICK fallback: just unlink
    this session's `vpn_key_id`, leave the shared UUID alive for the other
    sessions. Logged `[device-delete] shared vpn_key=…` for audit. The session
    row is still hard-deleted afterward.
- Response: `{ ok: true, deletedId, hardKick }` — `hardKick=true` means the UUID
  was purged; `false` means shared-key fallback.
- **Hy2 disconnect mechanism (v48 core change)**: the Hy2 outbound's password
  is now `s<sessionId>.<hmac12>` (per-session HMAC), not the user-level
  sub-token. After hard-delete, the next reauth at /api/hysteria/auth misses
  the session row → returns `ok: false` → Hy2 server drops the client.
  - Hy2 server reauths on every new QUIC connection. QUIC sessions migrate
    on IP change / NAT rebinding / idle timeout (~30-60 s), so the kicked
    client loses Hy2 within seconds of the kick on a typical mobile network.
  - On Wi-Fi with stable IP and a long-lived UDP flow, the client may keep
    Hy2 working until the next reconnect (worst case ~1-2 min on Hy2 default
    keep-alive). Acceptable trade-off: VLESS-side already dropped instantly.
  - Legacy clients whose imported config still contains a user-level
    sub-token in the Hy2 password keep working until the next sub-poll
    (~60 s, controlled by `profile-update-interval: 1`) re-issues a
    session-scoped password. /api/hysteria/auth supports both formats.
- **Self-recovery on the same phone**: client auto-refresh (Happ / v2rayTun)
  hits /api/sub/[token] every minute. With the row gone, UPSERT INSERTs a
  fresh row → `ensureSessionUuid` allocates a fresh UUID + per-session Hy2
  password from the pool → on the next reconnect (or "обновить" tap by the
  user) the client pulls the new config and re-attaches to its slot. From
  the owner's POV: 2/3 right after kick, 3/3 a minute later or as soon as
  they manually refresh. **No UI button required.**

### Per-Session Hy2 Password (v48, 2026-05-17):
- Format: `s<sessionId>.<sig12>` where `<sig12>` is the first 12 chars of
  `HMAC-SHA256(XRAY_SYNC_TOKEN, "hy2-sess:" + sessionId).digest('base64url')`.
  Generated by `generateSessionHy2Password(sessionId)` in `lib/sub-token.ts`,
  parsed by `parseSessionHy2Password()`.
- /api/sub/[token] picks the per-session password whenever it has a tracked
  `sessionId` (`isRealVpnClient` path); falls back to the user-level
  sub-token only for browser previews / legacy code paths.
- /api/hysteria/auth tries the per-session decode first. On hit it joins
  `device_sessions` + `subscriptions` and rejects if:
  - the session row is gone (hard-deleted = owner kicked this device);
  - `kicked_at IS NOT NULL` (defense-in-depth for any soft-kick legacy);
  - subscription is not active.
  Falls through to the legacy user-level sub-token path on parse miss, so
  cached configs from before v48 keep working until their next sub-poll
  re-issues a session-scoped password (~60 s).
- `XRAY_SYNC_TOKEN` env var is reused as the HMAC key (no new env needed).
  Rotating it would invalidate all currently-issued Hy2 passwords + sub
  tokens at once — same blast radius as before, no regression.

### Event-Driven Xray Sync on Admin/Payment Paths (v65, 2026-05-17):

Background: VLESS validation happens locally inside Xray on each VPN VPS,
so any subscription/key mutation only takes effect after Xray on every VPS
has re-fetched `/api/xray/clients` and reloaded its client list. Hy2 by
contrast checks `/api/hysteria/auth` live on every reconnect, so it always
sees the latest DB state — that's why bans / expirations historically felt
instant on Hy2 and laggy (up to 5 min) on VLESS.

Before v65, several admin / payment paths skipped firing `triggerXraySync`
entirely, leaving the user's VLESS UUID alive in Xray until the next
`/api/cron/sweep-expired` tick:

| Path                                  | Before v65            | After v65              |
|---------------------------------------|-----------------------|------------------------|
| `banUserAccess` (admin login-ban)     | No webhook            | `triggerXraySync('wait')` |
| `banUserSubscription` (admin sub-ban) | No webhook            | `triggerXraySync('wait')` |
| `reactivatePaidAccessIfEligible` (admin un-ban, existing-keys branch) | No webhook | `triggerXraySync('wait')` |
| `ensureVpnKey` (payments / trial)     | `'fire-and-forget'`   | `'wait'` (~200-800 ms)  |
| `deactivateExpiredAccess`             | `'fire-and-forget'` (when totalChanged > 0) | unchanged — used in cron paths where fire-and-forget is correct |

Why `'wait'` is safe for human-driven flows:
- payment callbacks: every gateway gives us ≥30 s to respond; adding ~1 s
  worst-case for the webhook fan-out is invisible to the user. Payment is
  committed BEFORE the webhook fires, so even a hard webhook failure can't
  undo the purchase — worst case is the user falls back to the 5-min cron,
  which is exactly the pre-v65 behaviour.
- admin ban/unban: the admin clicks a button and waits for the row to
  update in the table. Adding 1 s so they can immediately verify the VPN is
  actually dead/alive is a net usability win.

Why `'fire-and-forget'` stays for cron / sub-poll paths:
- `/api/cron/sweep-expired` runs every minute; blocking it for 10s × 2
  retries × N servers would cascade into overlapping cron runs and
  duplicate webhook fan-out.
- `/api/sub/[token]` is hit every minute by every active client; same
  cascading-load reason.

### Mass Reactivation of Per-Device Keys on Renewal (v66, 2026-05-17):

**Symptom v65 missed**: after admin "ban subscription" + promo apply, only
Hy2 came back instantly; every VLESS server stayed N/A for ~60 s.

**Why**: `banUserSubscription` flips ALL `vpn_keys.is_active=FALSE` (shared
+ per-device session keys). `ensureVpnKey` only resurrects the SHARED
legacy key (`key_uri != 'per-device'`). Per-device session keys, the ones
the user's Happ has cached as the actual VLESS UUID, stayed dead until the
user's next sub-poll (~60 s) ran `ensureSessionUuid` — which has its own
`is_active=TRUE` flip. Since `/api/xray/clients` filters
`vk.is_active=TRUE`, those UUIDs were absent from the snapshot the
xray-sync webhook then fanned out, so VLESS was rejected on every VPS.

**Fix**: `lib/access.ts reactivateUserKeysAfterRenewal(client, userId,
subId, endDate)` — single UPDATE that flips `is_active=TRUE`, refreshes
`expires_at`, and re-points `subscription_id` for EVERY non-pending
`vpn_keys` row owned by this user. Idempotent (filters out rows already in
the desired state via `IS DISTINCT FROM`).

Wired into both branches (UPDATE-extend and INSERT-new) of:
- `activateSubscriptionForDays`
- `activateSubscriptionForMonths`

So every user-facing renewal — promo apply, crypto callback, SBP confirm,
Telegram Stars webhook, trial issue — mass-reactivates ALL the user's
keys before the downstream `ensureVpnKey('wait')` fires the xray-sync
webhook. The fan-out that follows includes every per-device UUID, so the
user's cached Happ configs are valid on every VPS the moment the response
returns.

`applyReferralReward` and `grantReferralSignupBonus` deliberately stay on
the old per-key UPDATE pattern — they're invoked on already-active users
whose keys are already `is_active=TRUE`, so mass reactivation would be a
no-op there.

### Dynamic webhook URL list from `servers` table (v67, 2026-05-17):

**Symptom**: after promo apply (or any subscription renewal) Hysteria и
Россия возвращались мгновенно, остальные VPS — N/A минут 5 пока не
сработает cron `/opt/xray-sync.sh`.

**Root cause**: `lib/xray-webhook.ts` читал список webhook URL'ов
из `process.env.XRAY_WEBHOOK_URL` (comma-separated) **один раз при
загрузке модуля**. В этом ENV были прописаны только старые VPS
(Россия + один-два других). При добавлении нового сервера через
админку он записывался в БД `servers`, но никто не добавлял его в
ENV. Результат: `triggerXraySync('wait')` отправлял webhook ТОЛЬКО на
старые VPS, новые узлы узнавали про активацию через 5 минут от cron.

Почему Hysteria работала: Hy2 проверяет активность юзера через live
`/api/sub/hy2-auth` callback на каждом TCP-handshake (см. v63 split).
Webhook ей не нужен — она и так видит свежее состояние БД мгновенно.

**Fix** (`lib/xray-webhook.ts::getWebhookUrls()`):

Превратил функцию из sync в async, и теперь она:
1. Делает `SELECT host FROM servers WHERE is_active=TRUE ORDER BY id`
2. Строит `http://${host}:${XRAY_WEBHOOK_PORT ?? 9999}/sync` на каждом
   вызове `triggerXraySync` / `triggerTrafficRefresh`
3. Падает обратно на ENV `XRAY_WEBHOOK_URL` только если БД-запрос
   ошибся (best-effort, чтобы payment callback не падал из-за webhook
   плагина)

Стоимость — один indexed `SELECT` (~1 мс) на каждый webhook trigger.
Дешевле чем последствия рассинхрона ENV↔DB.

**Эффект**: добавил VPS в админке → webhook автоматически до него
дойдёт на следующем promo/payment/ban. Шаг "обновить XRAY_WEBHOOK_URL
на Timeweb" больше не требуется (он остаётся в playbook только как
emergency fallback).

### Admin Referrals Tab v2: Engagement Scoring + Abuse Detection (2026-05-17):

**Problem**: the v1 referrals tab showed only `inviteeCount` + bonus days
per inviter. Couldn't distinguish:
- a real user who brought 3 paying friends, vs.
- an abuser who registered 8 throwaway Telegram accounts via their own
  ref link to farm signup bonus days. The latter is invisible because
  bonus accounting is the same in both cases (3 × `REFERRAL_SIGNUP_BONUS_DAYS`).

**v2 (2026-05-17) — `app/api/admin/referrals/route.ts`**:

Per-invitee engagement (computed via LATERAL subselects, single round-trip):
- `inviteePaidCount` / `inviteePaidAmountRub` — from `payments WHERE status='paid'`
- `inviteeDeviceCount` — from `device_sessions WHERE kicked_at IS NULL`
- `inviteeSubInviteeCount` — `users WHERE referred_by_user_id = invitee.id`
  (2nd-level depth; tells you which invitees are themselves productive)
- `inviteeLastSeenAt` — `MAX(device_sessions.last_seen_at)`

Per-inviter classification into 5 categories (`InviterCategory`):
- `whale`      — `paidInviteeCount ≥ 3` OR `paidAmountRub ≥ 500₽`
- `active`     — `paidInviteeCount ≥ 1` OR `subInviterCount ≥ 1`
- `neutral`    — fallback (1–2 friends, no signal yet)
- `suspicious` — `inviteeCount ≥ 5` AND `paidInviteeCount = 0` AND
                 `deviceCoverage < 50%`
- `abuser`     — `inviteeCount ≥ 5` AND `paidInviteeCount = 0` AND
                 `deviceInviteeCount = 0` AND `subInviterCount = 0`

`CATEGORY_ORDER` puts abuser first so they don't get buried at the bottom
of a long list. Inside each category, sort by `totalBonus DESC` (most
expensive farms first).

Abuse signals (independent flags, can stack):
- `no_devices`        — none of the invitees have an active device session
- `no_payments`       — none of the invitees ever paid
- `dead_end`          — none of the invitees invited anyone themselves
- `burst`             — ≥3 invitees registered within any 60-min window
                        (sliding-window detection over `invitedAt`)
- `all_same_authtype` — ≥5 invitees, all same `auth_type` (mass-bot signal)
- `never_seen`        — ≥5 invitees, zero device sessions across all of them

**Frontend** (`AdminReferralsView` in `app/page.tsx`):
- 6 KPI cards (added "Сумма оплат ₽" + "Платящих друзей").
- Filter tabs: All / Платящие / Активные / Нейтральные / Подозрительные /
  Абьюзеры — each shows the count badge. Tabs colour-coded
  (amber/emerald/zinc/orange/red) matching backend `CATEGORY_ORDER`.
- Each inviter row has a category chip + up to 3 abuse-signal pills.
- Per-invitee row in the expanded panel: 📱 device count (green if >0),
  💳 payment count + RUB (amber if >0), 👥 sub-invitee count (sky if >0).
- "Последний раз видели" timestamp from `MAX(device_sessions.last_seen_at)`
  helps distinguish "registered and never opened the app" abuse pattern
  from "real user just hasn't paid yet".

Single query, indexed lookups everywhere; tested fine up to ~10k pairs.
If we hit that ceiling, the right next step is a CTE-based pagination,
not multiple round-trips.

### v43 → v45: Kick Semantics History

**v41 (original)**: `kicked_at` = permanent blacklist, checked before rank. Broke
the "test kick → re-add same device" flow.

**v43 (abandoned)**: `kicked_at` = TRANSIENT marker, cleared by the UPSERT on the
next subscription refresh. Plan: let the rank check (with reset `created_at`) push
the revived device over the limit naturally.

**Bug that killed v43**: Happ / v2rayTun poll the subscription URL every minute
(`profile-update-interval: 1`). The kicked device's own client dutifully pings
`/api/sub/[token]` within ≤ 60 s of being kicked, UPSERT clears `kicked_at`, a fresh
UUID is allocated, and the device reconnects WITHOUT the user doing anything. From
the user's POV the kick "forgets itself". Symptom report: "3/3 devices, I kick one,
it comes back on its own".

**v45 (current, 2026-04-20)**: kicks are PERSISTENT again. The UPSERT no longer
touches `kicked_at` — auto-refreshes from a kicked device get a dedicated error
subscription ("🚫 Устройство удалено") and NO new UUID. The ghost-session issue
that v41 originally tried to solve is now handled by two other mechanisms:

1. **v45 device-session gate**: browsers (plain `Mozilla/5.0 (Windows ...)` UAs) no
   longer create sessions. `/api/sub/[token]` now requires either a known VPN-client
   UA substring (`sing-box`, `happ`, `v2raytun`, `v2rayng`, `streisand`, `hiddify`,
   `nekobox`, `nekoray`, `xray/`, `v2ray/`) OR an explicit `X-HWID` / `X-Device-OS` /
   `X-Device-Model` header. Browser visits to verify a subscription URL no longer
   leave "ghost Windows" rows in the device list.
2. **Admin un-kick** (v45 admin panel, see below): `POST /api/admin/users/:id/devices/
   :deviceId?action=unkick` clears `kicked_at` for a single session. The client
   re-polls within 60 s and gets its UUID back without needing to reimport.

**Abuse vector still covered**: Kicking still HARD-purges the UUID from the pool
(see v41 "Kick Device Flow"), so the cached VLESS config on the kicked device stops
working within ~1 s of the forced Xray restart. The user can't just ignore the kick
by refusing to refresh — their existing connection is physically dropped.

### v45 Expired-Page for Users Without Any Subscription (2026-04-20):
Previously `/api/sub/[token]` returned 404 for users who had never purchased (no
`vpn_keys` row). This broke the signup flow where a user imports the subscription
URL into their VPN client BEFORE purchasing. v45 always returns a valid config for
any resolvable token:
- No active sub AND no vpn_keys → base64 list of two dummy `vless://127.0.0.1`
  entries with remarks `⚠️ Подписка не активна` and `🔄 Оформить: https://t.me/bot`.
  The VPN client UI shows a useful "please buy" banner instead of an empty list.
- 404 is reserved for truly unknown tokens (no matching row in `users`).

### v45 Admin Device Management (2026-04-20):
Admins can list every session a user ever created (including kicked / over-limit /
expired ones) and kick/unkick them individually. All state-changing actions trigger
`triggerXraySync('wait')` for instant propagation.

**Endpoints** (all gated by `lib/admin.ts isAdmin(telegramId)` via `ADMIN_TELEGRAM_IDS`):
- `GET /api/admin/users/:id/devices?telegramId=<admin>` — returns
  `{ user: {id, telegram_id, sub_status, sub_end, max_devices, is_banned},
     devices: [{ id, device_hash, device_name, ip_address, user_agent, created_at,
                 last_seen_at, kicked_at, vpn_key_id, uuid, pool_assigned_at, rank }],
     pool: { assigned } }`.
  Unlike the user-facing `/api/users/devices`, this returns EVERY session (no rank
  filter, no `kicked_at IS NULL` filter), joined with `vpn_keys` and `uuid_pool`
  so the admin sees the actual UUID per device.
- `DELETE /api/admin/users/:id/devices/:deviceId?telegramId=<admin>` — kick. Soft-marks
  `kicked_at = NOW()`, hard-purges the UUID from `uuid_pool` and `vpn_keys`, and fires
  `triggerXraySync('wait')`. Same mechanics as user-facing kick, but an admin can
  target any user.
- `POST /api/admin/users/:id/devices/:deviceId?telegramId=<admin>&action=unkick` —
  clear `kicked_at`, leaving the row otherwise intact. The client's next sub refresh
  (within 60 s) passes the rank check and gets a fresh UUID. Use this to reverse an
  accidental kick or to undo a `kicked_at` marker set by the old soft-kick path.

**Admin UI** (`AdminView` in `app/page.tsx`):
- User row in the Users tab has a `📱 Устройства` button (next to the Ban buttons).
- Clicking opens a bottom-sheet modal (`devicesUser` state) that fetches the devices
  endpoint and renders every session with rank, UA, IP, last-seen, UUID, and a
  `Kick` / `Restore` button per row. Modal auto-reloads after each action and has a
  manual refresh button.
- No `/admin/users/:id` page — everything is inline in the existing `AdminView`
  component so page navigation isn't needed and admin context stays on one screen.

**Legacy fallback for the old unkick path**: `POST /api/admin/migrate` with
`{ telegramId: <admin>, action: 'unkick', targetTelegramId: <user> }` still works
and clears ALL `kicked_at` for a user in one shot (useful for mass-unkick after
an accidental bulk-kick script). The new per-device endpoint is preferred for
targeted unkicks.

### List Devices (`GET /api/users/devices`):
- Query params: `telegramId=<id>` OR `userId=<id>`.
- Returns **only in-limit, non-kicked sessions** (`kicked_at IS NULL`, rank ≤ `max_devices`
  by `created_at ASC, id ASC`), sorted by `last_seen_at DESC`. Kicked + over-limit sessions
  stay in DB (for idempotent enforcement in the subscription endpoint) but are hidden
  from the UI.
- Response shape: `{ ok: true, devices: [{ id, device_name, ip_address, last_seen_at,
  created_at }], maxDevices }`.

### Deploying v41+ (post-deploy migration):
After pushing to main + Timeweb deploy (wait ~2-3 min for build):
1. `POST /api/admin/migrate` with `{ telegramId: <admin_id> }` applies any pending
   `ALTER TABLE` / `CREATE INDEX` migrations (idempotent — safe to re-run).
2. Verify `curl -I https://hundlervpn.xyz/api/sub/TOKEN` shows the latest
   `X-Code-Version` header (current: `v45-persistent-kick-no-ghost-2026-04-20`).
3. For ~1 hour after a v41/v43 deploy, users created pre-v41 who have multiple devices
   may experience SOFT kicks (documented limitation — their old shared UUID is still
   in use by other sessions, so hard purge would break them). New sessions created
   post-deploy always get per-device UUIDs, so HARD kicks work for them immediately.
4. **If you test kick flow and get stuck in the "Устройство отключено" state** on
   pre-v43 clients still cached in v2rayTun / Happ: `POST /api/admin/migrate` with
   `{ telegramId: <admin>, action: 'unkick', targetTelegramId: <your_id> }` clears
   all kicked flags. Then refresh subscription in the client.

### Trial Issuance:
- **Telegram signups** (`/api/users/sync`): 3-day trial via `issueTrialAccess(client,
  userId, telegramId, 3)`. Plan name `Free Trial 3d`, `max_devices=1`.
- **Email signups** (`/api/auth/verify-code`): 1-day trial via `issueTrialAccess(
  client, userId, 0, 1)`. Plan name `Free Trial 1d`, `max_devices=1`. Shorter because
  email signups are lower-friction and higher abuse risk. `telegramId=0` is passed
  because the helper only uses it to build the (unused here) subscription URL.
- Both paths check `userNeedsInitialTrial(client, userId)` first — a user with any
  prior `subscriptions`, paid `payments`, or `vpn_keys` rows NEVER gets a duplicate
  trial. Trial issuance failures are non-fatal: the user still authenticates, admin
  can retrigger via promo code.
- **Known limitation**: email-only users (no linked `telegram_id`) currently can't
  generate a working subscription URL because `lib/sub-token.ts` keys tokens on
  `telegram_id`. The trial row is created in DB but the user has no way to import
  the VLESS config into a client until they link Telegram. TODO: extend sub-token
  to support `user_id`-based tokens for email-only users.

### Cron Sweep (`/api/cron/sweep-expired`, v47):
**Why**: pre-v47 we relied solely on the 5-min cron on every VPN VPS that
calls `/api/xray/clients` to expire subscriptions and rotate UUIDs.
Users whose subscription expired while they weren't using the app saw a
worst-case 5-min delay before getting kicked. v47 adds an explicit
endpoint that performs the same global sweep but is designed to be hit
by a 1-minute external cron.

**Endpoint**: `GET|POST /api/cron/sweep-expired?token=<XRAY_SYNC_TOKEN>`
- Auth: single global token (same `XRAY_SYNC_TOKEN` env used everywhere
  else). No per-row look-up.
- Body: `{ ok: true, purged: N, note: "…" }`. `purged` = number of pool
  rows just deleted (= devices that just got hard-kicked).
- Idempotent: calling it once a second or once an hour produces the same
  end state. Concurrent calls are safe (each transaction gets its own
  snapshot, DELETEs target only currently-orphaned rows).

**Setup options for the 1-min schedule** (pick one, no code change
needed):
1. **External free service** (recommended — zero infra). cron-job.org or
   EasyCron: configure a job to GET
   `https://hundlervpn.xyz/api/cron/sweep-expired?token=hVpN2026sEcReT_xR4y`
   every 1 minute.
2. **Existing VPN VPS cron**. SSH to NL (185.238.169.235) and DE
   (213.182.213.183) and edit the line in `crontab -e` from
   `*/5 * * * * /opt/xray-sync.sh …` to `* * * * * /opt/xray-sync.sh …`
   so the existing GC in `/api/xray/clients` runs every minute. This
   doesn't go through `/api/cron/sweep-expired` but achieves the same
   end-state since the GC also calls `rotateOrphanUuids()`.
3. **GitHub Actions cron** (free for public repos): a workflow with
   `schedule: - cron: '* * * * *'` that curls the endpoint. Note that
   GitHub's minimum effective cadence is ~5 min in practice (they queue
   schedules during peak load), so this is a fall-back only.

**Pick option 1 if you want guaranteed 1-min cadence with zero VPS
admin overhead.**

### Expiring-Subscription Reminder (`/api/cron/remind-expiring`, 2026-05-05):
**Why**: users often forget to renew their subscription. Previously they
silently lost VPN access when `end_date` passed. This cron DMs them via
the Telegram bot exactly ONCE per subscription when `end_date` is within
24 hours, with a button that opens the Mini App on the payment tab.

**Endpoint**: `GET /api/cron/remind-expiring?token=<XRAY_SYNC_TOKEN>`
- Auth: same `XRAY_SYNC_TOKEN` env var used for `/api/cron/sweep-expired`.
- Selects `subscriptions` where `status='active' AND end_date > NOW() AND
  end_date <= NOW() + INTERVAL '24 hours'` and the matching user has
  `telegram_id IS NOT NULL AND is_banned = FALSE` and there is NO row in
  `subscription_reminders` with `(subscription_id, kind='expiring_1d')`.
- Sends a `sendMessage` call to each with an inline button
  `https://t.me/<BOT_USERNAME>?startapp=payment` — the Mini App boot
  effect routes `payment` (or `pay`) to `setActiveTab('payment')`
  automatically (see `app/page.tsx` ~L853).
- Always INSERTs into `subscription_reminders` after the send attempt
  (UNIQUE on `(subscription_id, kind)` prevents duplicates). Failed
  deliveries (user blocked bot, chat deleted, etc.) are recorded with
  `delivered=false` + `error_text` so the cron never retries them.
- Body: `{ ok: true, candidates: N, sent: X, failed: Y, skipped: Z,
  kind: 'expiring_1d' }`.

**DB**: table `subscription_reminders` (`db/schema.sql` ~L355):
- `id`, `subscription_id` (FK subscriptions ON DELETE CASCADE),
  `user_id` (FK users ON DELETE CASCADE), `kind TEXT NOT NULL`,
  `sent_at`, `delivered BOOLEAN`, `error_text TEXT`.
- `UNIQUE(subscription_id, kind)` — single-send guarantee.
- Idempotent migration: `scripts/migrate-subscription-reminders.js`.
  Applied on Timeweb prod DB on 2026-05-05.

**Design notes**:
- "One reminder per SUBSCRIPTION" means that if a user buys a new
  subscription, the new one gets its own reminder. That's intentional —
  each paid period should get exactly one expiration nag.
- Users with overlapping active subs (rare, happens during an upgrade)
  only get ONE DM thanks to `ROW_NUMBER() PARTITION BY user_id` in the
  SELECT picking the latest-expiring row per user.
- Rate-limited to ~20 msg/sec via a 50ms sleep between sends (Telegram
  bot API allows 30/sec for non-broadcast messages).
- Users without `telegram_id` (email-only) are skipped — no mechanism
  to DM them yet. TODO: add an email-based reminder when
  `lib/auth-email.ts` gets an outbound mailer.

**Scheduling**: ideal cadence is every hour. `UNIQUE(subscription_id, kind)`
means running it every minute is safe too, just wastes a DB query. Set
up via cron-job.org (same setup as `sweep-expired`):
```
URL:  https://hundlervpn.xyz/api/cron/remind-expiring?token=<XRAY_SYNC_TOKEN>
Schedule:  Every 1 hour (at :00)
```

**Testing locally**: pick a test user with an active sub, fake the
end_date via SQL, then hit the endpoint:
```sql
-- shorten a test subscription to 12h-left so it matches the candidate query
UPDATE subscriptions SET end_date = NOW() + INTERVAL '12 hours'
WHERE user_id = <TEST_USER_ID> AND status = 'active';

-- clear any reminder that was already sent so we can re-test
DELETE FROM subscription_reminders WHERE subscription_id IN (
  SELECT id FROM subscriptions WHERE user_id = <TEST_USER_ID>
);
```
Then `curl "https://hundlervpn.xyz/api/cron/remind-expiring?token=$XRAY_SYNC_TOKEN"`.
Response should say `candidates: 1, sent: 1`. Check the user's Telegram
for the reminder DM.

### Restart-Storm Fixes (v60-v67, 2026-04-28 → 2026-05-07):
**Symptom**: VPN dropping for 5+ minutes randomly. PC works while phone is dead.
Manual "remove device → re-add device" fixes phone. xray-sync.log on NL/DE
shows `Restarted: clients changed` every 5 min even with no real user
activity (UUID set flapping `975 was 977`, `974 was 975`, etc).

**Root causes (fixed in 5 commits)**:

1. **v60 — `lib/access.ts deactivateExpiredAccess`**: previously fired
   `triggerXraySync()` unconditionally on every call, even when
   `subsExpired=0 && keysDeactivated=0`. Result: `/api/users/sync` (Mini App
   poll) → no-op deactivate → useless webhook → useless Xray restart.
   Fix: only fire webhook when `totalChanged > 0`. Added structured
   `[deactivateExpiredAccess]` log line with all counters + `webhookFired`.

2. **v61 — `/api/xray/clients`**: this READ endpoint hit every 5 min
   by `/opt/xray-sync.sh` was running 2 UPDATEs on every GET (relabelling
   `pool-N` rows + bumping `last_used_at`). Result: every VPN VPS poll
   mutated DB → next VPS poll saw a diff → `systemctl restart xray`.
   Fix: removed both UPDATEs — endpoint is now strictly READ-ONLY. Email
   re-labelling moved to be opportunistic (only when sync.sh actually
   applies a config change).

3. **v62 — `/api/users/state`**: GET endpoint polled by Mini App + admin
   panel was running an UPDATE on `vpn_keys.is_active` based on a
   "candidate key" calculation that occasionally flipped for users with
   multiple legacy `key_uri != 'per-device'` keys.
   Fix: added `AND vk.is_active IS DISTINCT FROM (vk.id = candidate)`
   to the WHERE — UPDATE writes 0 rows when nothing actually changes.

4. **v63 — `/api/sub/[token]`**: hit every 60s by every user's
   Happ/v2rayTun client. Was running 2 UPDATEs on every poll
   (`ensureSessionUuid` for exclusive per-device keys + legacy shared-key
   fallback path), unconditionally setting `is_active=TRUE`. Racing with
   /api/users/state's pre-v62 flapping behaviour created the visible
   `975→977→975` toggle in xray-sync.log.
   Fix: same `IS DISTINCT FROM` pattern on both UPDATEs.

5. **v64 — Self-healing zombie pool state**: even after v60-v63, users
   created during the flapping window still had a zombie state where
   `vpn_keys.is_active=TRUE` but the matching `uuid_pool` row was DELETED
   (purged when is_active was briefly FALSE, then is_active flipped TRUE
   again but the pool row never came back). `/api/xray/clients`'s SELECT
   joins `uuid_pool` on the LEFT, so a missing pool row meant the UUID
   simply wasn't in the snapshot — Xray rejected the user with "invalid
   request user id". The user only recovered by manually deleting +
   re-adding the device (which forced `acquireUuid()` to allocate a
   fresh pool row).
   Fix in 3 parts:
   - `lib/uuid-pool.ts ensurePoolRowForKey` now returns `boolean` —
     `true` when the table was actually mutated.
   - `app/api/sub/[token]` fires `triggerXraySync('fire-and-forget')`
     whenever ensurePoolRowForKey returned true. Effect: zombie state
     heals on the very NEXT Happ poll, ~1s instead of 5 min wait.
   - `app/api/cron/sweep-expired` now also calls `restoreActivePoolEntries()`
     on every run — finds ALL active vpn_keys whose pool row is
     missing/wrong and re-creates them in one query. Combined with the
     1-min cron schedule, any zombie state is fully self-healed within
     60s regardless of user activity.

6. **v67 — `/api/users/state` candidate dedup vs live device sessions**
   (2026-05-07, commit `3d712bb`): a user with phone (iPhone 15) + PC
   reported phone VPN dying while PC stayed alive. Diagnosis via
   `node scripts/debug-user-full.js --tg <id>` showed two `vpn_keys` for
   sub 168 with `key_uri='per-device'` + `is_active=TRUE`, BUT every poll
   of `/api/users/state` flipped `is_active=FALSE` on whichever key was
   not the "first per-device row" picked by the candidate CTE. Both
   keys had a live `device_session` (rank ≤ max_devices, not kicked).
   The CTE deactivated the loser → next `/api/sub/[token]` poll from
   the affected device re-activated it → next `/api/users/state` poll
   deactivated the OTHER one — classic ping-pong. xray-sync.log showed
   the user's UUIDs flapping in/out every 30-60s, and the cached config
   on whichever phone lost the race went to "Ping N/A".
   Fix in `app/api/users/state/route.ts`: the candidate-dedup UPDATE
   now has an extra guard:
   ```sql
   AND NOT EXISTS (
     SELECT 1 FROM device_sessions ds
     WHERE ds.vpn_key_id = vk.id
       AND ds.kicked_at IS NULL
       AND ds.last_seen_at > NOW() - INTERVAL '30 days'
   )
   ```
   so any per-device key that is currently bound to a live device_session
   is **excluded from the candidate UPDATE** entirely. This makes the
   endpoint idempotent for users with N keys + N live devices — none
   of them get flipped, all of them stay `is_active=TRUE`.

   **Companion data hotfix** (`scripts/hotfix-2029065770.js`): one-shot
   migration script that promotes legacy `key_uri != 'per-device'` rows
   to `per-device`, reactivates them, links them to the right
   subscription, heals their `uuid_pool` rows, and fires the Xray
   webhook. Template — copy-and-rename for any future user hitting the
   same legacy state. The v67 SQL fix prevents new users from getting
   into this state in the first place.

7. **v69 — Renewal-cached zombie UUIDs** (2026-05-11, commit `ec3e554`):
   user 1388 (@fallensai) reported "VPN doesn't work, fixed by deleting
   a device + refreshing subscription". Diagnosis via
   `node scripts/diagnose-zombie-uuids.js --user=1388` showed THREE
   vpn_keys for him: a per-device key (id=452, active, iPhone 11) plus
   TWO legacy `vless://...` shared keys (id=270, id=153) both
   `is_active=FALSE` despite an active subscription. Audit across
   prod: 38 active users carried 110 inactive legacy vpn_keys
   (~2.9 per user) — every one a UUID some Happ install could still
   be caching.

   Root cause: `lib/access.ts ensureVpnKey` SELECT used
   `WHERE user_id=$1 AND subscription_id=$2`. Every subscription
   renewal creates a NEW `subscriptions` row (new id), so the SELECT
   never matched on renewal → INSERT new vpn_key → cleanup
   `UPDATE vpn_keys SET is_active=FALSE WHERE id != $2 AND key_uri
   != 'per-device'` deactivated the OLD shared key. The user's Happ
   cache, populated weeks ago, still pointed at the now-dead UUID, so
   Xray rejected it and the user had to either delete a device (which
   forces Happ to re-poll) or hit "Update subscription" in Happ.

   Fix in 3 parts:
   - **Root cause** (`lib/access.ts ensureVpnKey`): new scope is
     `WHERE user_id=$1 AND key_uri != 'per-device' AND key_hash
     IS NOT NULL AND key_hash NOT LIKE 'pending-%'` ordered by
     `is_active DESC, created_at DESC LIMIT 1 FOR UPDATE`. The UPDATE
     branch below still bumps `subscription_id = $4` so the FK migrates
     to the new subscription seamlessly. Effect: renewals stop
     orphaning the previous UUID — the SAME UUID survives across
     renewals so Happ's cache stays valid forever.
   - **Cron auto-heal** (`/api/cron/sweep-expired`): new Type-1 healer
     reactivates `vpn_keys` rows where there's an alive
     `device_session` (`kicked_at IS NULL`) + active subscription but
     the linked key is `is_active=FALSE`. Idempotent (filter
     `is_active=FALSE`). Catches users whose Happ already failed to
     connect and won't re-poll for hours. Repairs within ~60s.
   - **Diagnostic tool** (`scripts/diagnose-zombie-uuids.js`):
     finds 4 zombie types (active session → dead key, pool row
     missing/wrong, session w/o vpn_key_id, legacy shared key w/o
     pool row) + historical analysis (device kicks last 30d,
     "kick+new key within 1h" pattern signature) + per-user deep
     dive (`--user=N`). `--fix` mode applies one-shot repairs.

**Diagnostic**: `node scripts/debug-user-full.js --tg <telegram_id>` (or
`--user <id>`) dumps the user row, all subscriptions, all vpn_keys with
their pool-row + linked-session status, all device_sessions, the live
Xray client snapshot for the user's UUIDs, and a one-line summary
("✅ healthy" / "⚠ <N> issues: …"). Run it as the first step on any
"VPN doesn't work on phone" support ticket — output usually pinpoints
the exact row that needs fixing.

**Net effect**: a user's VPN should NEVER drop from a server-side cause
in steady state. Genuine restarts (signup / payment / kick / sub
expiration) drop connections for 5-15s and clients reconnect normally.
Anything longer is now either WARP / YC bridge / mobile-network
infrastructure (use `scripts/diag-vpn-now.sh` to capture the real cause),
or iOS NetworkExtension client-side caching — both outside our backend.

**Verification after deploy**: `tail -30 /var/log/xray-sync.log` on NL/DE
should show MOSTLY `No changes (N clients)` with rare `Restarted: clients
changed` entries (only on real signup / kick / payment events). Pre-v60
the same window showed `Restarted` on almost every 5-min tick.

### Referral System:
**Two independent bonuses, both go to the INVITER** (the user whose link was used):

1. **Signup bonus (`grantReferralSignupBonus` in `lib/access.ts`)** — fixed
   `REFERRAL_SIGNUP_BONUS_DAYS = 5` days credited the moment a brand-new user
   registers via the link. Triggered from `app/api/users/sync/route.ts` and gated
   on `syncedUser.inserted === true && inviterId !== null && inviterId !== userId`
   so it fires exactly once per new friend. Self-referrals are skipped explicitly.
   Wrapped in a SAVEPOINT so a bonus failure (e.g. inviter already deleted) does
   NOT roll back the new user's own signup + trial issuance.
2. **Recurring payment bonus (`applyReferralReward`, v2 2026-05-04)** — tiered by
   plan duration of EVERY qualifying paid plan the invitee buys (monthly
   renewals included, not just first payment). `getReferralBonusDays`:
   - <30 days   → **0 days** (short plans disqualified to prevent +1 farming)
   - 30–179 d   → +7 days
   - 180–364 d  → +14 days
   - ≥365 days  → +21 days
   Fires from each payment callback (`/api/payments/crypto/callback`,
   `lib/sbp-confirm.ts` from the SBP callback, `/api/telegram/webhook`). All
   three callers now pass `payment.id` as the fourth arg so the per-payment
   idempotency check works (see below).

**Mechanics shared by both bonuses**:
- Look up inviter via `users.referred_by_user_id` (set ONCE on the invitee's first
  INSERT — `upsertTelegramUser` does not touch it on conflict).
- If the inviter has an active subscription and `end_date > NOW()` → extend it
  by `bonusDays` and bump `vpn_keys.expires_at` for any active keys.
- Otherwise create a fresh subscription on the dedicated bonus plan
  (`Referral Signup Bonus 2d` / `Referral Bonus Xd`).

**Referral link format** (v65, 2026-05-03 — extended for non-Telegram users):
`https://t.me/<bot>?startapp=ref_<code>`. The `<code>` lives in
`users.referral_code` (TEXT UNIQUE) and is generated by `lib/referral-code.ts`
in two flavours:

- `u{base36(telegramId)}` — primary identity is Telegram. Written by
  `upsertTelegramUser` (Mini App `/api/users/sync`) and `/api/auth/telegram-login`
  (web Login Widget) at INSERT time.
- `e{base36(userId)}` — primary identity is email or Google OAuth. Written by
  `/api/auth/verify-code` and `/api/auth/google/callback` immediately after the
  INSERT (because `users.id` is BIGSERIAL, not known until the row is created).

Both prefixes are collision-free against each other. Parsing in
`parseReferralCode()` (`app/api/users/sync/route.ts`) is prefix-agnostic — it
just looks the inviter up by `WHERE referral_code = $1`. This means: an email
user with code `e7` can share their link, and when a Telegram user joins via
that link, the inviter is correctly resolved and credited the referral bonus
**even though the inviter has no Telegram account at all**. Acceptance still
happens only via the Mini App (because that's where `parseReferralCode` is
invoked) — the email user just can't be on the *invitee* side, only the
*inviter*.

`/api/users/state` and `/api/auth/account` (GET) both return `referralCode` so
the Mini App's `subscriptionState.referralCode` always carries the canonical
code — `ProfileView` builds the share URL from it directly, no longer derived
from `tgUser.id`. The TG-only bottom-nav button (TG Stars store) still hides
under `authMode !== 'email'`, but the referral row is visible to all auth
modes (telegram / email / google).

**Backfill for existing users**: `scripts/backfill-referral-codes.js`
(idempotent). Scans every row with `referral_code IS NULL` and writes the
canonical code per the rules above. Was run on 2026-05-03; assigned codes to
18/76 pre-existing users (mostly email/google sign-ups from before the format
extension).

**Journal table `referral_bonus_transactions`** (v1 2026-05-03, v2 2026-05-04):
- Every bonus grant is journaled so the Mini App's "my friends" list can show
  per-invitee totals and who earned you how many days.
- Schema: `(inviter_user_id, invitee_user_id, bonus_type, bonus_days,
  payment_id, created_at)`. `bonus_type IN ('signup', 'payment',
  'first_payment')`. 'first_payment' is kept as a legacy value in the CHECK
  constraint so existing v1 rows stay valid; new code never writes it.
- **Idempotency via partial UNIQUE indexes** (v2):
  - `idx_referral_bonus_signup_unique(inviter, invitee) WHERE bonus_type =
    'signup'` — one signup bonus per pair.
  - `idx_referral_bonus_payment_unique(payment_id) WHERE payment_id IS NOT
    NULL AND bonus_type = 'payment'` — one payment bonus per `payments.id`.
    Inside `applyReferralReward`, the journal `INSERT … ON CONFLICT
    (payment_id) … DO NOTHING RETURNING id` fires FIRST; the bonus-days
    subscription extend only runs when `rowCount === 1`, guaranteeing
    retries/replays don't double-credit the inviter.
- Migration: `scripts/migrate-referral-bonus-v2.js` (idempotent, already run
  on Timeweb DB). Drops the v1 tuple UNIQUE, adds `payment_id`, expands the
  CHECK, creates the two partial indexes. Reapplies cleanly if re-run.
- Callsite ordering matters for Telegram Stars: `/api/telegram/webhook`
  inserts the `payments` row BEFORE calling `applyReferralReward` now, so
  the journal FK has a target. SBP and crypto flows already had `payment.id`
  from the pending row they locked.

**Anti-abuse**:
- Self-referrals are skipped (`inviterId !== userId`).
- `referred_by_user_id` is locked in on the invitee's first INSERT and never
  rewritten, so a user can't bait the system by re-syncing under different ref
  codes.
- Signup bonus gates on first INSERT. Payment bonus gates on `payment_id`
  uniqueness — one bonus per `payments` row, retries are no-ops. Plans
  under 30 days earn zero (prevents farming via 3-day trial buys).

**UI** (`components/ReferralModal.tsx`, v2 premium layout 2026-05-04):
- Hero card with big earned-days counter + friend count + one-line pitch.
- Your-link card with Copy / Share.
- "Your friends" button → slide-in inner panel listing every invitee
  (avatar, name, relative-time invited, `+N dn.` pill, "M payments" caption).
- Collapsible "Rules & bonuses" section (signup +5 / payment tiers /
  conditions warning) — default collapsed so the main surface stays airy.
- API: `GET /api/users/referrals` returns
  `{ ok, referrals: [{signupBonus, paymentBonus, paymentCount, totalBonus,
  …}], totalDays, totalPayments }`. Aggregates `SUM(bonus_days)` grouped by
  invitee via `LEFT JOIN referral_bonus_transactions`.
- Translation keys touched: `referralTier7`/`14`/`21` (drop `referralTier1`),
  `referralStatsEarned`, `referralStatsFriends`, `referralDetailsToggle`,
  `referralInviteesButton`, `referralInviteesSummary{,One,Few}`,
  `referralInviteesBack`, `referralInviteesPayments{One,Few,Many}`.
- HomeView CTA: `t.referral` chip now uses the same zinc palette as the
  Promo / My devices chips, positioned right after the Install button.

