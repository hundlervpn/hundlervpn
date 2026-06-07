## Environment Variables (Timeweb — names only, never values):
- APP_URL (public origin of the web app, e.g. https://hundlervpn.xyz)
- XRAY_SYNC_TOKEN (shared secret for /api/xray/* sync + sub token HMAC signing)
- TELEGRAM_BOT_TOKEN (Mini-App-launcher bot, `hundlervpnbot` — set via @BotFather)
- TELEGRAM_BOT_CHAT_TOKEN *(NEW 2026-05-07)* — chat-only bot's BotFather
  token. Used by `lib/sbp-confirm.ts` and
  `app/api/payments/crypto/callback/route.ts` to deliver payment-success
  notifications through the SAME bot the user paid from (read from
  `payment.metadata.notifyVia === 'chat'`). Falls back to
  `TELEGRAM_BOT_TOKEN` if missing — so existing single-bot deploys keep
  working without a config change.
- NEXT_PUBLIC_TELEGRAM_BOT_USERNAME (public bot handle, e.g. hundlervpnbot)
- OXAPAY_API_KEY (crypto payment provider)
- RESEND_API_KEY (transactional email provider)
- GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (OAuth; GitHub Push Protection blocks committing)
- PLATEGA_MERCHANT_ID / PLATEGA_SECRET_KEY (SBP RU payments)
- VPN_WEBHOOK_SECRET (shared secret between web app and xray-webhook.py on NL VPS)
- POSTGRESQL_HOST / POSTGRESQL_PORT / POSTGRESQL_USER / POSTGRESQL_PASSWORD / POSTGRESQL_DBNAME

**SECURITY NOTE (2026-04-20):** Earlier commits in this repo (4be5546, 64d1b80, 85dd8e0)
accidentally committed REAL secret values into this file. All of those secrets MUST be
considered compromised and rotated. Git history needs to be rewritten (git filter-repo)
to remove them from every reachable commit, followed by a force-push. Until then, anyone
who ever cloned the public repo has the old secrets in their local history.

