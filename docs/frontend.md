## Frontend Structure:
- `app/page.tsx` — the main SPA. Historically this one file held everything;
  since 2026-07 it is being **incrementally split** into smaller modules (one
  build-verified PR per step). It still hosts the top-level `App` component
  (routing/tab state, data fetching, shared handlers) plus the views not yet
  extracted (see below).
- `app/login/page.tsx` — login page (Telegram Widget + Email/password)
- `app/_shared/` — code shared between `page.tsx` and extracted components:
  - `translations.ts` — `translations.ru` / `translations.en`
  - `types.ts` — shared TS types (`Tab`, `UserIdentifier`, `AuthMode`, …)
  - `constants.ts` — `pageVariants`, `tabs`, `ADMIN_TELEGRAM_IDS`, animation variants, …
  - `tickets.ts` — support-ticket types + helpers (`fileToTicketAttachment`, `acceptTicketImages`, …)
- `components/views/` — full tab views extracted out of `page.tsx` (default
  exports, `'use client'`). Already extracted: `HomeView`, `PaymentView`,
  `PaymentsHistoryView`, `SupportView`, `DesktopSidebar`, `AdminFragmentView`,
  `ServersView`, `EmailAuthView`, `AdminPasswordGate`.
- `components/ui/` — small reusable leaf components (`NavItem`,
  `PaymentMethodBtn`, `FeatureItem`, `BoxChestImage`, and the ticket UI
  pieces `TicketMessageRow` / `TicketAttachmentGrid` / `TicketImageLightbox` /
  `PendingImagesStrip`).
- `components/*.tsx` — other standalone components (`LandingPage`, `ReferralModal`,
  `WithdrawalModal`, `AdminWithdrawalsView`, icons, background effects, …).
- **Still inline in `page.tsx`** (to be extracted later, they cross-reference
  each other + shared helpers): `ProfileView`, `AccountView`, `ServicesView`,
  `AdminTicketsView`, `AdminView` (+ its admin sub-views), `TgStoreView`,
  `BoxesView`, `BoxesHistoryView`.
- Extraction convention: moved files use `'use client'`, a `default export`,
  and absolute imports (`@/app/_shared/...`, `@/components/...`, `@/lib/...`);
  every step is verified with `tsc --noEmit` + `next build` before merge.
- Desktop: sidebar (lg:w-72) + main content (lg:max-w-[900px])
- Mobile: bottom tab bar, full-width content

### HomeView — subscription hero card (post-2026-05-07):
The top card on `HomeView` is the user's primary status surface. Layout
top-to-bottom:

1. **Header row** — gradient title `Hundler VPN` + status pill
   (`Активна` green dot / `Неактивна` grey).
2. **Days counter block** — when `hasActiveSubscription`: big `daysLeft`
   number (44px / 5xl on lg) + Russian-pluralised noun (`день` / `дня` /
   `дней`) + `📅 до DD.MM.YYYY` line. When inactive: «Подписка не
   активна» + 1-line CTA pointer.
3. **Devices pill** *(2026-05-07 redesign)* — full-width horizontal row:
   `[icon-tile]` (rounded-lg 36px square with `Smartphone` icon) +
   **«Устройства»** label (`t.devices`, font-semibold) + count badge
   (`N/MAX`, bg-white/[0.06] rounded pill, tabular-nums) + chevron-right.
   Replaces the previous 72×72 icon-only chip that lived inline next
   to the days counter — users were missing it / not understanding
   what the smartphone icon meant. Red treatment (`border-red-500/30`,
   `bg-red-500/[0.06]`, red-300 icon, red-300 badge) when at limit.
   Click → opens devices modal (`handleDevicesClick`).
4. **Primary CTA: «Продлить»** — solid red `bg-red-500` with red glow
   `shadow-[0_8px_24px_-8px_rgba(239,68,68,0.5)]`, `Zap` icon,
   chevron-right. Navigates to `payment` view.
5. **Secondary CTA: «Установить и настроить VPN»** — clean glass button,
   `Settings` icon, chevron-right. Opens setup wizard.
6. **Utility rows** — referral + promo, stacked full-width (NOT 2-col
   grid because the RU label «Реферальная система» was being truncated).
   Both `bg-white/[0.03]` with subtle hover.

The whole card lives in a `<motion.div>` with a single subtle red halo
behind it (no shimmer / no glow stripes — keeps the focus on the data,
not on visual noise). Border `border-white/10`, rounded-2xl,
`backdrop-blur` + `bg-zinc-950/40`.


## Telegram:
- Bot username: hundlervpnbot (NO underscore; canonical after April 2026 rename)
- Login Widget Client ID: 8649972278
- Admin Telegram IDs: [2029065770, 1483598839]
- Webhook handler: app/api/telegram/webhook/route.ts


## Account Linking (Telegram + Google + Email):

### Model
- `users.auth_type` — 'telegram' | 'email' | 'google' (the method used at registration).
- `users.telegram_id` (nullable, unique) — set if linked.
- `users.google_id` (nullable, unique) — set if Google linked; Google `sub` claim.
- `users.email` / `users.email_verified` — email can come from Google (always verified)
  or from manual email-login (verified via 6-digit code sent by Resend).
- Unique index `idx_users_email` on `email WHERE email IS NOT NULL` enforces one email per user.

### Sign-in
Three ways to sign in, all supported in `/login` + Mini App:
1. Telegram WebApp (inside `hundlervpnbot` Mini App) or Telegram Login Widget (web).
2. Google OAuth 2.0 — `app/api/auth/google/start` → Google consent → callback.
3. Email + password with 6-digit verification code.

### Login Flow (Google): `app/api/auth/google/callback`
When user signs in with Google, the callback attempts to reuse an existing account:
1. Find by `google_id` → log in.
2. Else find by verified `email` → attach `google_id` to that user and log in.
3. Else create a fresh user with `auth_type='google'`.
Result: a Telegram/email user who signs in with the same Gmail later ends up
in the SAME account (no duplicates).

### Link Flow (adding Google to an existing account)
From `AccountView` in `app/page.tsx` ("Sign-in methods" section):
- Telegram users: click "Link Google" → `tg.openLink('/api/auth/google/start?linkTg=<id>')`.
  **Critical**: Google rejects OAuth in Telegram's embedded WebView with `disallowed_useragent` (403),
  so we MUST open it in the system browser via `Telegram.WebApp.openLink()`.
- Email/Google users: click "Link Google" → `/api/auth/google/start?link=<session>`.
- `/api/auth/google/start` stores the resolved `userId` in cookie `g_oauth_link_user`,
  origin ('tg' | 'web') in `g_oauth_link_origin`, and redirects to Google.
- Callback detects link flow via cookie, then:
  - If `google_id` already bound to another user → error `gl_err_google`.
  - If `email` on another user with `email_verified=TRUE` → error `gl_err_email`.
  - If `email` on another user with `email_verified=FALSE` → **reclaim**
    (`UPDATE ... SET email=NULL` on the other user), then link here.
    Rationale: Google verified the email, which trumps an unverified self-claim.
  - Otherwise: `UPDATE users SET google_id=<sub>, email=<gmail>, email_verified=TRUE`.
- Return paths:
  - `origin='tg'` → redirect to `https://t.me/hundlervpnbot/app?startapp=<code>` where code is
    `gl_ok` / `gl_err_email` / `gl_err_google` / `gl_err_cancel` / `gl_err_token` /
    `gl_err_state` / `gl_err_unverified` / `gl_err_other`.
    Mini App reads `initDataUnsafe.start_param` and maps the code to a localized banner.
  - `origin='web'` → redirect to `/?account_success=<msg>` or `/?account_error=<msg>`,
    which `page.tsx`'s root effect picks up and shows in the banner.

### Link Flow (adding Telegram to an email/google account)
From `AccountView` in `app/page.tsx` — "Link Telegram" button visible ONLY when `authType !== 'telegram'`:
- Click "Link Telegram" → `/api/auth/telegram/start-link?link=<session>`.
- `start-link` resolves userId from session, sets `tg_link_user` cookie, redirects to Telegram OAuth.
- Telegram callback (`/api/auth/telegram/callback`) detects link flow via `tg_link_user` cookie:
  - If `telegram_id` already bound to another user → error.
  - Otherwise: `UPDATE users SET telegram_id=<tgId>` on the linking user.
  - Redirect to `/?account_success=Telegram+привязан`.
- **Important**: `oauth.telegram.org` is blocked in Russia — users may need VPN to link.
  UI shows a warning hint below the link button.

### Unlink Telegram: POST `/api/auth/account` with `action='unlink_telegram'`
Restrictions:
- **Blocked** if `auth_type = 'telegram'` → returns `CANNOT_UNLINK_PRIMARY`.
  Users who registered via Telegram CANNOT unlink it (they have no link/unlink UI at all).
- Safety: at least one other auth method must remain (`google_id` OR verified email login),
  otherwise returns `LAST_AUTH_METHOD`.
- UI: "Unlink Telegram" button in Telegram card (only for email/google-registered users).

### Unlink Email: POST `/api/auth/account` with `action='unlink_email'`
Restrictions:
- **Blocked** if `auth_type = 'email'` → returns `CANNOT_UNLINK_PRIMARY`.
  Users who registered via email CANNOT unlink it (removing would orphan the account).
- Safety: at least one other auth method must remain (`telegram_id` OR `google_id`),
  otherwise returns `LAST_AUTH_METHOD`.
- Sets `email = NULL` and `email_verified = FALSE`.
- UI: "Unlink email" button in Email card (only for telegram/google-registered users).
  Works even for verified emails.

### Unlink Google: POST `/api/auth/account` with `action='unlink_google'`
Safety rule: at least one other auth method must remain, otherwise server returns
`LAST_AUTH_METHOD`. Specifically, unlink is allowed only if:
- `telegram_id IS NOT NULL`, OR
- `auth_type = 'email' AND email_verified = TRUE`.

If `auth_type` was `'google'`, switch it to the remaining method (telegram > email).
UI: "Unlink Google" button in Google card (AccountView), confirm dialog via `window.confirm`.

### Delete Account: POST `/api/auth/account` with `action='delete_account'`
Permanently removes the user and ALL associated data via cascade.

**Restriction**: Only allowed if `auth_type === 'email'`. Telegram-registered and
Google-registered users cannot delete from this endpoint (returns
`CANNOT_DELETE_NON_EMAIL`). Rationale per product spec: only email signups have a
strong "GDPR/erasure" expectation; Telegram/Google users can simply unlink and
abandon the account.

**Cascade**: A single `DELETE FROM users WHERE id = $1` removes:
- `subscriptions` (CASCADE)
- `vpn_keys` (CASCADE) — `uuid_pool.assigned_to_key_id` SETs NULL → UUID returns to free pool
- `payments` (CASCADE)
- `promo_code_uses` (CASCADE)
- `email_sessions` (CASCADE)
- `support_tickets` + `support_ticket_messages` (CASCADE → CASCADE)
- `fragment_orders` (CASCADE)
- `service_requests` + `service_request_messages` (CASCADE → CASCADE)
- `device_sessions` (CASCADE)

Preserved (`SET NULL`):
- `users.referred_by_user_id` (referral history kept for the referrer)
- `logs.user_id` (audit history anonymized)
- `promo_codes.created_by`, `broadcasts.created_by` (admin attribution)

After delete, calls `triggerXraySync('fire-and-forget')` so the NL VPS reads the
new `/api/xray/clients` list and re-labels the released UUIDs as `pool-N`.

**UI** (`AccountView` in `app/page.tsx` — "Danger zone" section, only visible when
`account.authType === 'email'`):
- Red-tinted card with `Trash2` icon and warning copy.
- Click → `window.prompt(t.accountDeleteConfirmPrompt)` → user must type
  `УДАЛИТЬ` (ru) / `DELETE` (en) verbatim.
- On success: `localStorage.removeItem('hvpn_session')` + redirect to `/login`.

Translations: `accountDangerTitle`, `accountDeleteTitle`,
`accountDeleteDescription`, `accountDeleteButton`, `accountDeleting`,
`accountDeleteConfirmPrompt`, `accountDeleteConfirmWord`,
`accountDeleteCancelled`, `accountDeleteSuccess`, `accountDeleteError`.

### Important env vars
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — set in the server `.env`; Google Console redirect URI
  must include `https://hundlervpn.xyz/api/auth/google/callback`.
- `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` — used to build the `t.me/<bot>/app?startapp=...`
  deep-link for returning Telegram users to the Mini App after OAuth.


## UI Architecture:
- app/page.tsx — single mega-component (~5400 lines), all views inside
- Telegram Mini App: calls tg.ready(), tg.expand(), tg.requestFullscreen()
- Safe area: viewport-fit=cover, CSS vars --sat/--sab for notch padding
- Header padding: calc(safe-area-inset-top + 2.5rem)
- Bottom nav padding: max(0.75rem, safe-area-inset-bottom)
- Animations: framer-motion (motion/react) with page slide variants
- Particles background: components/ParticlesBackground.tsx
- Haptic feedback: lib/haptic.ts
- Auth modes: telegram (Mini App), email (login page with Telegram Widget)

