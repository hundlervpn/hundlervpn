## Telegram Bot (separate VPS):
- VPS hostname: HundlerBOT (Amsterdam, public IP 132.243.242.124)
- Bot code: bot/main.py (aiogram, Python)
- Service: /etc/systemd/system/hundlervpn-bot.service
- Working dir: /root/hundlervpn/bot
- Env vars: defined inline as `Environment=...` in the systemd unit file (NOT in
  a `.env` file — `/root/hundlervpn/bot/.env` does NOT exist on the bot VPS).
  `bot/main.py` calls `load_dotenv()` which silently no-ops, then falls back to
  `os.getenv('POSTGRESQL_*', '<default>')`. To change DB creds / host / port,
  edit the systemd unit and run `systemctl daemon-reload && systemctl restart
  hundlervpn-bot`.
- Manage: `systemctl restart hundlervpn-bot`, `systemctl status hundlervpn-bot`
- IMPORTANT: always check `ps aux | grep main.py` — kill stale processes before restart
- Bot features: /start command (welcome + open Mini App button), broadcast scheduler (checks DB every 10s)
- **psycopg2 requires `sslmode=require`** (v66, 2026-04-28). Default is set in
  `DB_CONFIG` via `os.getenv('POSTGRESQL_SSLMODE', 'require')`. Without it,
  psycopg2 hangs for 10s on every poll because Timeweb hosted Postgres expects
  an `SSLRequest` packet first and silently drops plain-TCP startup payloads.
  The Node `pg` driver auto-negotiates SSL so the web app side never noticed,
  but psycopg2 needs the explicit flag.

### DB Tunnel (v66, 2026-04-28) — REMOVED in v68

Historical: until v68 the bots reached the old Timeweb Postgres through an
SSH tunnel via a cloud VM in RU (workaround for Timeweb's hidden GeoIP
filter that silently dropped SSLRequest from foreign IPs). After the DB
migration to Hostman managed PG (`<DB_HOST>`, `sslmode=require`) the
bots connect directly; the tunnel service and the bridge VM are deleted.
Remaining TODO from that era: rotate the DB password (it appeared in chat
logs and sits in cleartext inside the bot systemd units).

### Broadcast Audience Filter (v65, 2026-04-28; v2 2026-05-05):
Admin can target a Telegram broadcast to a specific user segment instead of
"everyone with telegram_id". Four audience options:

- **`all`** — every user with `telegram_id` (legacy default, backward-compatible)
- **`active`** — users with at least one active, non-expired subscription
  (`subscriptions.status='active' AND end_date > NOW()`)
- **`no_sub`** — users WITHOUT an active subscription (expired,
  canceled, or never had one)
- **`active_no_devices`** (added 2026-05-05) — users with an active
  subscription who have ZERO live `device_sessions` (`kicked_at IS NULL`).
  Targets people who paid but never imported the VLESS link into a VPN
  client. The exact same predicate is what the Mini App uses to count
  bound devices — so this segment exactly mirrors "no devices in the
  user's profile". As of migration time, ~30 users matched on the
  Timeweb prod DB.

**Components**:
- DB: `broadcasts.target_audience TEXT NOT NULL DEFAULT 'all'` with CHECK
  constraint allowing the 4 values (`db/schema.sql` ~L307). Schema also
  includes a one-shot `DO $$ … $$` block that drops the legacy 3-value
  CHECK and re-adds the 4-value one — idempotent for prod migration.
- API: `POST /api/admin/broadcasts` (`@/app/api/admin/broadcasts/route.ts`)
  accepts `targetAudience` field; `buildAudienceCountSql()` computes
  `total_users` for the chosen segment, including the `active_no_devices`
  branch which JOINs against `device_sessions` with `kicked_at IS NULL`.
- Bot: `bot/main.py _fetch_pending_broadcast_sync()` reads `target_audience`
  and runs the matching SELECT (logic kept 1:1 with the API helper).
- UI: `app/page.tsx` Admin → Broadcasts tab has a **2-col grid** of 4
  buttons (`Всем` / `С активной подпиской` / `Без подписки` /
  `Не настроил VPN`).

**Single-user override**: setting `target_telegram_id` (the existing
"Telegram ID" field in the form) takes priority over `target_audience` —
the audience filter is ignored when a specific recipient is set, and the
UI disables the audience buttons in that case.

**Deployment steps**:
1. Apply the DB migration on Timeweb Postgres. For an existing prod DB
   that already has the v1 3-value CHECK, run:
   ```bash
   node scripts/migrate-broadcast-audience-v2.js
   ```
   The script drops the old constraint and adds the 4-value one, then
   prints a sanity-check count for `active_no_devices`. Idempotent.
2. Deploy the web app manually on the VPS (no auto-deploy since the 2026-07
   self-host migration): `git pull` + `docker compose ... up -d --build app`
   (see `docs/deployment.md`). Verify the deploy completes.
3. SSH to HundlerBOT VPS, pull the new bot code and restart:
   ```bash
   cd /root/hundlervpn && git pull
   systemctl restart hundlervpn-bot && systemctl status hundlervpn-bot
   ```
4. Open Admin → Broadcasts in the Mini App. The new "Не настроил VPN"
   button should appear in the audience grid.

### Broadcast Button Kinds (2026-05-05):
On top of the audience filter, the admin can choose what kind of inline
button the broadcast sends. Three kinds:

- **`url`** (default, legacy) — plain URL button. `button_url` column holds
  the URL. Click → Telegram opens the URL in the in-app browser.
- **`app`** — opens the HundlerVPN Mini App. Bot builds
  `https://t.me/<BOT_USERNAME>?startapp=open` at send time. Button text
  defaults to "Открыть приложение" if admin leaves it empty.
- **`promo`** — opens the Mini App AND auto-applies a promo code.
  `button_promo_code` column stores the CODE. Bot builds
  `https://t.me/<BOT_USERNAME>?startapp=promo_<CODE>`. Frontend boot effect
  (`app/page.tsx` ~L878) parses the `promo_` prefix from
  `Telegram.WebApp.initDataUnsafe.start_param`, calls `/api/promos/apply`,
  and either:
  - discount promo → `setPendingPromo()` + `setActiveTab('payment')`
  - days promo → refresh subscription state (days already added server-side)
  Button text defaults to "Активировать <CODE>" if left empty.

**Promo kind prerequisite**: the admin MUST create the promo code first
(`promo_codes` table, via the admin promo-codes UI). `/api/admin/broadcasts`
validates at creation time that the code exists, `is_active = TRUE`,
not expired, and not exhausted — rejects the broadcast otherwise so a
bad button never ships.

**Components**:
- DB: `broadcasts.button_kind TEXT NOT NULL DEFAULT 'url' CHECK IN
  ('url', 'app', 'promo')` + `broadcasts.button_promo_code TEXT` (nullable).
  See `db/schema.sql` ~L338.
- Migration: `scripts/migrate-broadcast-button-kind.js` — idempotent
  `ALTER TABLE ADD COLUMN IF NOT EXISTS`, safe to re-run. Already applied
  on Timeweb prod DB on 2026-05-05.
- API: `app/api/admin/broadcasts/route.ts` — `POST` accepts `buttonKind`
  and `buttonPromoCode`, validates the code against `promo_codes` for
  `kind='promo'`, strips `buttonUrl` for non-'url' kinds.
- Bot: `bot/main.py` reads `button_kind` + `button_promo_code` from the
  broadcast row, builds `resolved_url` via `https://t.me/{BOT_USERNAME}?startapp=…`.
  Requires `TELEGRAM_BOT_USERNAME` env var (defaults to `hundlervpnbot`).
- Frontend boot: `app/page.tsx` ~L878 auto-applies the promo code from
  `start_param` when the Mini App launches.
- Admin UI: `app/page.tsx` Broadcasts form has a 3-button radio
  ("Ссылка" / "Открыть приложение" / "Промокод"). URL input shows only
  for kind='url'; promo-code input only for kind='promo'. Button text is
  always editable with kind-aware placeholders. Helper text under the
  promo input reminds admin to create the promo first.

**Bot env var** (HundlerBOT VPS `/etc/systemd/system/hundlervpn-bot.service`
or `.env`):
```
TELEGRAM_BOT_USERNAME=hundlervpnbot
```
Only needed if the bot username ever changes; default matches production.


## Telegram Bot 2 — Chat-only (`bot-chat/`, 2026-05-06):
A second Telegram bot running ALONGSIDE `bot/` on the same VPS. Targets
users who can't or don't want to open the Mini App and prefer to do
everything inside Telegram chat (older Android, low-end devices,
restricted networks where the Mini App webview fails).

### Why a separate bot (not just /commands on the existing one):
- Each Telegram bot can only be polled by one process at a time. Adding
  more handlers to `bot/` would mean rebuilding it as a full chat client
  and risk breaking the working /start → Mini App flow during
  development.
- A new bot has its own token + username, so we can iterate on the chat
  UX freely. Both bots share the SAME PostgreSQL DB, the SAME Next.js
  API endpoints, and the SAME XRAY_SYNC_TOKEN secret — they're two faces
  of the same product.
- The Mini App is still the recommended path; the chat bot is a
  no-frills fallback.

### Architecture:
- `bot-chat/main.py` — aiogram 3 long-polling entry point with
  `MemoryStorage` for FSM (only the promo flow uses state — restart
  loss is fine, user retypes the code).
- `bot-chat/ui.py` — direct aiohttp wrappers for `sendMessage` /
  `editMessageText` / `sendPhoto`. We CAN'T use aiogram's
  `InlineKeyboardButton` for Bot API 9.4 because aiogram 3.4's Pydantic
  models silently drop unknown fields like `style` and
  `icon_custom_emoji_id`. So we build inline-keyboard payloads as plain
  dicts and POST them directly to api.telegram.org. This is the ONLY
  way to get colour buttons (`primary` blue / `success` green /
  `danger` red) until aiogram 3.5+ adds field passthrough.
- `bot-chat/db.py` — read-only psycopg2 helpers for users / plans /
  subscriptions / device_sessions / referral stats. Sync calls wrapped
  in `asyncio.to_thread()` from handlers. Schema notes: `users` has NO
  `language_code` column (despite aiogram providing it on `from_user`),
  `plans.price` is a single NUMERIC (not `price_rub`/`price_usd`),
  `device_sessions` has `device_name`/`ip_address`/`kicked_at` (NOT the
  `device_label`/`device_os`/`device_platform` columns that live on
  `vpn_keys`).
- `bot-chat/api_client.py` — async aiohttp client to the Next.js side.
  Write paths (SBP/crypto invoice creation, promo apply, device delete)
  go through the existing public endpoints, which already accept
  `telegramId` in the JSON body so no extra auth header is needed. We
  rely on the same business-logic transactions in `lib/access.ts` —
  no split-brain risk.
- `bot-chat/sub_token.py` — Python port of `lib/sub-token.ts`. Same
  HMAC-SHA256 + base64url + 12-char-suffix format. The bot computes the
  subscription URL locally so it can show / copy / QR-render it without
  an extra round-trip.

### Handlers (`bot-chat/handlers/`):
- `start.py` — /start with welcome photo + 8 colour buttons. Layout:
  blue «Моя подписка» (primary CTA), green «Купить VPN» (success),
  default «Промокод», «Устройства», «Друзья», «Как подключить»,
  «Соглашение», «Конфиденциальность».
- `subscription.py` (`sub:show`) — active sub status + days-left + sub
  URL CTA. If no sub: "no sub" copy + buy/promo CTAs.
- `buy.py` (`plans:list` / `buy:d:N` / `buy:pay:N:sbp|crypto`) — flat
  5₽/day pricing matching the Mini App, presets 3/7/14/30/90/180/365.
  Calls `/api/payments/sbp/create` or `/api/crypto-invoice` and returns
  the redirect URL as a "💸 Оплатить" button. Payment activation
  triggers `triggerXraySync('fire-and-forget')` server-side, so VPN
  servers pick up the new UUID within ~1 second (see "Activation Race"
  fix above for `lib/access.ts` `ensureVpnKey`).
- `promo.py` (`promo:enter` + FSM `PromoStates.waiting_code`) — asks
  user to send the code as a message, then POSTs `/api/promos/apply`.
  /cancel exits the state. On success shows days granted + sub URL.
- `devices.py` (`devices:list` / `devices:rm:<id>`) — lists active
  device_sessions (rank-capped at `plan.max_devices`), each row has a
  ❌ button which calls `DELETE /api/users/devices` → triggers HARD
  kick (uuid_pool row deleted + Xray restart via webhook). Re-renders
  the panel after delete via shared `_render_panel` helper to avoid
  double-answering the callback query.
- `referral.py` (`referral:show`) — shows code + `t.me/<bot>?start=ref_<code>`
  link + invited count + bonus_days_total. Auto-backfills `referral_code`
  if missing.
- `help.py` (`help:install` / `help:os:<ios|android|windows|macos>` /
  `help:client:<happ|v2raytun>` / `help:region:<ios|macos>:<ru|global>`) —
  rewritten 2026-05-07 to mirror the Mini App's client picker
  (`app/page.tsx#getStoreLink`) byte-for-byte. Flow:
    1. **OS picker** (iOS / Android / Windows / macOS).
    2. **Client picker** — only **⭐ Happ (рекомендуем)** + **v2RayTun**.
       Streisand and Hiddify were removed (they were never in the Mini App
       picker; the chat bot was the only place still suggesting them and
       it confused users who installed Streisand and then couldn't find
       a "how to import" guide in the Mini App). The `help.py` docstring
       has an explicit "do not add these back" guard for future devs.
    3. **Per-(client, OS) instructions + sub URL** + buttons:
       `⬇ Скачать` (Happ → GitHub `.exe` / Google Play / App Store;
       v2RayTun → `storage.v2raytun.com` / Google Play / App Store),
       `📋 Скопировать ссылку` (Bot API 9.4 `copy_text` button — falls
       back to `MarkdownV2` `<code>` block on older clients), region
       toggle for Happ on iOS / macOS (`🇷🇺 RU App Store` ↔ `🌍 Global App
       Store` — `happ-proxy-utility-plus` vs `happ-proxy-utility`).
  No PNG QR generation anymore — the QR-flow was removed in 2026-05-06
  because copy-button + redirect-to-store covers every case the QR
  did, with less screen clutter. The text panel stays editable
  throughout for back-navigation (uses `smart_edit` from `ui.py`).
- `stub.py` — last-resort fallback for unhandled callback_data; warns
  the user to refresh via /start. Catches typos in callback strings
  introduced by future refactors.

### Bot API 9.4 colour buttons (brand palette, 2026-05-07):
Each button payload includes `"style": "primary" | "success" | "danger"`.
Visible on Telegram v11.7+ (Android, iOS, macOS, Desktop). Older
clients render them grey but still functional — no breakage. The
feature shipped on Telegram side 2026-02-09; expect rollout to be
complete by mid-2026.

**Palette mapping** (every interactive button has an explicit style;
default-grey is reserved for legal/back/cancel):
- **danger (red)** = brand colour — main re-engagement CTAs
  (`Моя подписка`, `Промокод`, `Купить VPN` from empty states,
  `Продлить`, `СБП`, `Поделиться`, `Скопировать ссылку` in
  install help, `Удалить устройство`).
- **success (green)** = positive money / confirmation actions
  (`Купить VPN` from main menu, `Друзья`, `Скопировать` in sub
  panel, `Оплатить`, `Скачать клиент`, OS picker → Android,
  promo `У меня есть промокод`).
- **primary (blue)** = info / navigation
  (`Устройства`, `Как подключить`, `Криптой`, `Создать новый счёт`,
  `Обновить`, OS picker → iOS / macOS).
- **default (grey)** = legal links + every back/cancel/home button.

The 30-day default plan in the buy picker gets `danger` + ⭐ prefix
to flag it as recommended; other day chips are `primary`.

### Custom emoji icons (`bot-chat/emoji_icons.py`):
Buttons declare a `icon` semantic key (e.g. `"key"`, `"card"`,
`"gift"`) which `ui.btn()` resolves through `emoji_icons.ICONS` to
a Telegram custom_emoji_id and passes as
`icon_custom_emoji_id`. Default state is empty strings → buttons
render the static Unicode emoji embedded in their text. Populating
an entry upgrades the button to an animated/Premium emoji on
Premium clients (non-Premium auto-falls back).

**Discovery flow** (admin only, gated by `ADMIN_TELEGRAM_IDS` env):
1. Set `ADMIN_TELEGRAM_IDS=<tg_id_1>,<tg_id_2>` in `.env`,
   `systemctl restart hundlervpn-bot-chat`.
2. Send the bot any message containing animated custom emojis
   (Premium client required to insert them — long-press the
   emoji pad on iOS/Android, or click the smiley → Premium tab
   on Desktop).
3. `handlers/_admin.py` matches messages where the user is in
   `ADMIN_TELEGRAM_IDS` AND `entities` / `caption_entities`
   contain at least one `custom_emoji` entity. It replies with
   `<emoji>  →  <code>5170734948596768593</code>` lines.
4. Paste IDs into `emoji_icons.ICONS` (each slot has a comment
   showing where it appears), commit, push, restart.

The admin router is registered LAST in `main.py`, after `stub`,
so it never intercepts ordinary user flows. The filter is a plain
`async def` callable (`_is_admin_with_custom_emoji`) — aiogram 3
auto-detects coroutine filters and awaits them.

### Cross-bot payment routing (2026-05-07):
A user can pay from EITHER the Mini-App-launcher bot (`hundlervpnbot`)
OR the chat-only bot — and they expect the post-payment redirect AND
the success notification to come back through the SAME bot they paid
from. Without this routing the chat-bot user lands on the sister bot's
Mini App after Platega returns them to Telegram, and the success DM
arrives in the wrong thread (or not at all if the user blocked the
sister bot). User report 2026-05-07: «оплачивал с чат бота почему там
не отобразилось успешное пополнение … после оплаты с чатбота не
возвращает в чат бот а в мини апку».

**End-to-end flow** (replicated for SBP and crypto):

1. **Bot-chat → Next.js create endpoint**
   `bot-chat/api_client.py:_bot_routing_fields()` injects
   `notifyVia: 'chat'` + `botUsername: <chat_bot_username>` into every
   POST body for `/api/payments/sbp/create` and `/api/crypto-invoice`.

2. **Create endpoints**
   `app/api/payments/sbp/create/route.ts` and
   `app/api/crypto-invoice/route.ts` accept both fields, sanitise
   `botUsername` against `^[a-zA-Z][a-zA-Z0-9_]{2,30}[a-zA-Z0-9]$` to
   prevent open-redirect, then:
   - Persist `{ botUsername, notifyVia }` into `payment.metadata`.
   - Compose the Platega/OxaPay return URL as
     `https://t.me/<bot>?<key>=paid_<id>` where `<key>` is `start` for
     `notifyVia='chat'` (chat bot has no Mini App, deep-link via
     `/start` arg) and `startapp` for `notifyVia='main'` (Mini App
     handles the `paid_X` start-param automatically).

3. **Confirmation notifier**
   `lib/sbp-confirm.ts:notifySbpSuccessViaTelegram` and
   `app/api/payments/crypto/callback/route.ts:notifyUserViaTelegram`
   look up the most recent `paid` payment for the user, read
   `metadata.notifyVia`, and pick the matching bot token via
   `pickNotifyToken()` /  `pickCryptoNotifyToken()`:
   - `chat` → `process.env.TELEGRAM_BOT_CHAT_TOKEN`
   - else → `process.env.TELEGRAM_BOT_TOKEN`
   If the chat-bot token is missing on the server, the helper falls
   back to `TELEGRAM_BOT_TOKEN` so we never silently drop the
   notification — that's the same single-bot behaviour the deploy
   had pre-2026-05-07.

4. **Premium emoji + MSK timestamps**
   The same notifier helpers wrap key emojis in `<tg-emoji>` HTML tags
   so Premium Telegram clients render the brand-styled animated icons
   while non-Premium clients see the plain Unicode glyph (✅ → check,
   🎉 → party, 🔗 → link). Expiry date is formatted with
   `Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' })` so
   the bot, the SBP/crypto notification, and the chat-bot's
   subscription panel all show the SAME date — incident 2026-05-07
   had Mini App + main-bot notification displaying `17.05.2026` while
   the chat bot showed `18.05.2026` because its `_fmt_end_date` was
   doing a naive `+timedelta(hours=3)` on top of an
   already-MSK-aware datetime returned by psycopg2 (Postgres connection
   default TZ on Timeweb is `Europe/Moscow`). The chat-bot fix swaps to
   `astimezone(ZoneInfo("Europe/Moscow"))` which is a no-op for
   already-MSK datetimes.

5. **Migration**
   No DB migration needed — `metadata` is JSONB, both new keys default
   to `'main'` / `hundlervpnbot` if absent, so old rows continue to
   notify through the main bot. Required Timeweb env addition:
   ```
   TELEGRAM_BOT_CHAT_TOKEN=<chat-bot's BotFather token>
   ```
   Without it everything still works — chat-bot users just get the
   notification through the main bot (which is harmless because they
   have to have started both bots to be in this state anyway).

### Bot env reference (post-2026-05-07):
| Var | Required | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Different from `bot/`, no shared polls |
| `TELEGRAM_BOT_USERNAME` | ✅ | `hundlervpn_bot` (with underscore) |
| `APP_URL` | ✅ | `https://hundlervpn.xyz` (no trailing slash) |
| `POSTGRESQL_*` | ✅ | Point at the current DB host — see "self-host migration (CONFIRM)" note below; the old `127.0.0.1:5433` tunnel is gone |
| `XRAY_SYNC_TOKEN` | ✅ | MUST match the web app + VPN VPS value |
| `BOT_API_SECRET` | optional | Reserved for future X-Bot-Token auth |
| `ADMIN_TELEGRAM_IDS` | optional | Comma-separated TG IDs for emoji discovery & future admin tools. Falls back to `ADMIN_TELEGRAM_ID` (singular) for backwards compat |

### Deployment (`bot-chat/DEPLOY.md`):
- Lives at `/root/hundlervpn/bot-chat` on the same Telegram-bot VPS as
  `bot/`.
- Systemd unit `bot-chat/hundlervpn-bot-chat.service` (Type=simple,
  EnvironmentFile=-/root/hundlervpn/bot-chat/.env, Restart=always).
  Starts AFTER `hundlervpn-bot.service` for log readability.
- Required env in `.env` (chmod 600):
  ```
  TELEGRAM_BOT_TOKEN=<separate token from BotFather, NOT the Mini-App bot's>
  TELEGRAM_BOT_USERNAME=hundlervpn_bot
  APP_URL=https://hundlervpn.xyz
  POSTGRESQL_HOST=127.0.0.1     # via db-tunnel.service (SAME tunnel as bot/)
  POSTGRESQL_PORT=5433
  POSTGRESQL_USER=<DB_USER>
  POSTGRESQL_PASSWORD=...
  POSTGRESQL_DBNAME=<DB_NAME>
  POSTGRESQL_SSLMODE=require
  XRAY_SYNC_TOKEN=...           # MUST match the web app + VPN-VPS value
  ```
- **DB connection history**: v66 the bots tunneled to Timeweb Postgres over an
  SSH bridge (`127.0.0.1:5433`); v68 (2026-05-17) they moved to Hostman managed
  PG at `<DB_HOST>:5432` (`sslmode=require`), tunnel removed.
- ⚠️ **2026-07 self-host migration (CONFIRM):** the DB is now a Postgres
  **container on the web VPS** (`159.195.58.174`, `docker-compose.selfhosted.yml`)
  and is only exposed on the internal Docker network — the compose file does
  **not** publish `5432` to the host. The bots run on a **separate** VPS, so
  they cannot reach `POSTGRESQL_HOST=postgres`. Whoever ran the migration must
  confirm how the bots now connect (e.g. publish/firewall `159.195.58.174:5432`
  and point the bots at it, or co-locate/tunnel) and update the bot `.env`
  accordingly. Do not assume the old Hostman/Timeweb hosts — both are dead.
- Update flow: `git pull && systemctl restart hundlervpn-bot-chat`.
- Logs: `journalctl -u hundlervpn-bot-chat -f`.

### Local dev quirks:
- `bot-chat/run.bat` — workaround for a Windows shell that strips
  uppercase letters from interactive commands (PSReadLine glitch).
  The .bat avoids the issue with `%~dp0` placeholders.
- `bot-chat/_smoke_test.py` — DB sanity (lists plans, servers,
  referral stats); run before any longer iteration.
- `bot-chat/.env` is gitignored — never commit it.

### Known gotchas:
- Telegram disallows two `answerCallbackQuery` calls for the same
  query → in `devices.py` we extracted `_render_panel` so `cb_devices_list`
  and `cb_device_remove` share rendering logic without double-answering.
- The Mini App's SBP redirect hardcodes `t.me/hundlervpnbot` (no
  underscore), but the chat bot's username is `hundlervpn_bot` (with
  underscore). Pre-existing inconsistency — irrelevant for the chat
  bot's flow but worth knowing if we ever consolidate the two.

