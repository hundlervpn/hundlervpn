# Deploying `bot-chat` (Docker container on the main VPS)

The chat-only bot runs as the `hundler-bot-chat` **container**, built from
`./bot-chat` by the root `docker-compose.yml`, on the SAME VPS as the web app,
Postgres and the main launcher bot (`159.195.58.174`). It replaced the old host
`systemd` unit that used to live on a separate "HundlerBOT" VPS (retired).

Because it shares the compose `web` network with everything else, it reaches
Postgres directly at `postgres:5432` — no SSH tunnel, no Timeweb/Hostman, no
host-published DB port.

> Both bots long-poll Telegram, so each MUST use a DIFFERENT bot token
> (`TELEGRAM_BOT_TOKEN` for `bot`, `TELEGRAM_BOT_CHAT_TOKEN` for `bot-chat`).

## Environment (root `/root/hundlervpn/.env`, gitignored, chmod 600)

Compose feeds env into the containers from the SINGLE root `.env` — there is no
`bot-chat/.env` anymore. Keys the chat bot needs:

```
TELEGRAM_BOT_CHAT_TOKEN=<chat bot token from BotFather — NOT the Mini-App bot's>
CHAT_BOT_USERNAME=hundlervpn_bot
APP_URL=https://hundlervpn.xyz
XRAY_SYNC_TOKEN=...            # MUST match the web app + VPN-node value
ADMIN_TELEGRAM_IDS=           # optional — TG IDs allowed to run admin handlers
# DB creds are shared with the app:
POSTGRESQL_USER=...
POSTGRESQL_PASSWORD=...
POSTGRESQL_DBNAME=...
# POSTGRESQL_HOST / PORT / SSLMODE are forced to postgres / 5432 / disable
# for the bots by docker-compose.selfhosted.yml — do NOT override them per-bot.
```

Never commit real secrets — they live only in the server's `.env`.

## Deploy / update

From the repo root on the VPS (same command that deploys the app):

```bash
cd /root/hundlervpn
git pull origin main
docker compose -f docker-compose.yml -f docker-compose.selfhosted.yml up -d --build bot-chat
```

Deploying the whole stack (omit the trailing `bot-chat`) rebuilds it too.

Verify it's polling:

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhosted.yml logs -f bot-chat
```

You should see:
```
bot-chat: Bot identity: @hundlervpn_bot (id=…, name='Hundler VPN')
bot-chat: Starting long-polling…
```

## Custom emoji icons (Bot API 9.4)

The bot pre-declares slots for animated/styled custom emojis on every important
button (`bot-chat/emoji_icons.py`). Default state is empty, so buttons render
their plain Unicode emoji. To upgrade to animated Premium emojis on Premium
clients (non-Premium silently keep the Unicode fallback):

1. Set `ADMIN_TELEGRAM_IDS=<your_tg_id>` in the root `.env` and redeploy
   `bot-chat` (see above).
2. From your Telegram client (Premium required for inserting custom emojis),
   send the bot **any** message that contains the animated emojis you want.
   iOS / Android: long-press the emoji picker tab to switch to the animated
   set. Desktop: click the smiley icon → “Premium” tab.
3. The bot replies with one line per emoji:
   `🔑  →  5170734948596768593`.
4. Edit `bot-chat/emoji_icons.py` and paste the IDs into the slots you care
   about (each slot has a comment showing where it appears).
5. `git add bot-chat/emoji_icons.py && git commit && git push`, then on the
   VPS `git pull origin main` and redeploy `bot-chat` (see above).

Empty IDs are safe — the bot keeps the static Unicode emoji. Nothing breaks if
you populate only some keys.

## Bot token

⚠️ **The chat bot uses a SEPARATE Telegram bot token from the Mini App bot.**
Each Telegram bot can only be polled by one process at a time — two bots on the
same token would race on `getUpdates` and lose messages.

- `bot/` (Mini App launcher): container `hundler-bot`, token `TELEGRAM_BOT_TOKEN`.
- `bot-chat/` (chat-only, this one): container `hundler-bot-chat`, token
  `TELEGRAM_BOT_CHAT_TOKEN`. Both come from the root `.env`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `TELEGRAM_BOT_TOKEN env var is required` | `TELEGRAM_BOT_CHAT_TOKEN` missing/empty in root `.env` | Set it, then redeploy `bot-chat` |
| Sub URL shows but client errors "user not found" | `XRAY_SYNC_TOKEN` mismatch | Copy the exact value the web app + VPN nodes use |
| DB connection hangs / refused | Wrong `POSTGRESQL_SSLMODE` | Must be `disable` for the in-network container (set by the overlay) |
| Buttons appear but stay grey | Old Telegram client | Telegram v11.7+ required for Bot API 9.4 colour buttons |
| Bot doesn't respond at all | Polling collision (token shared with the main bot) | Give `bot-chat` its own BotFather token |
