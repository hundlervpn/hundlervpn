# Deploying `bot-chat` on the Telegram Bot VPS

The chat-only bot runs alongside the existing Mini-App-launcher bot on
the same VPS. They use different tokens so they can long-poll Telegram
in parallel without conflict.

## One-time setup

1. SSH to the bot VPS as `root`.

2. Pull the latest code:

   ```bash
   cd /root/hundlervpn
   git pull origin main
   ```

3. Create the venv and install deps:

   ```bash
   cd /root/hundlervpn/bot-chat
   python3 -m venv venv
   ./venv/bin/pip install --upgrade pip
   ./venv/bin/pip install -r requirements.txt
   ```

4. Create `/root/hundlervpn/bot-chat/.env` (chmod 600). Use the same
   secrets the Next.js side has — `XRAY_SYNC_TOKEN` MUST match the value
   in Hostman or subscription URLs will be rejected by `/api/sub/[token]`.

   ON THE BOT VPS use the local SSH tunnel for Postgres (host
   `127.0.0.1` port `5433`) — see the `db-tunnel.service` notes in
   `MINIAPP-AGENTS.md`. Direct Timeweb access from the Amsterdam IP is
   silently blocked.

   ```
   TELEGRAM_BOT_TOKEN=8756410167:AAFMeGw9zCe3PMtnKF2_wwRV7y-MXDW-GtE
   TELEGRAM_BOT_USERNAME=hundlervpn_bot
   APP_URL=https://hundlervpn.xyz
   POSTGRESQL_HOST=127.0.0.1
   POSTGRESQL_PORT=5433
   POSTGRESQL_USER=gen_user
   POSTGRESQL_PASSWORD=...
   POSTGRESQL_DBNAME=default_db
   POSTGRESQL_SSLMODE=require
   XRAY_SYNC_TOKEN=...
   # Optional — comma-separated TG IDs that can run admin handlers
   # (currently: emoji-id discovery, see "Custom emoji icons" below).
   ADMIN_TELEGRAM_IDS=
   ```

   Then:

   ```bash
   chmod 600 /root/hundlervpn/bot-chat/.env
   ```

5. Install the systemd unit:

   ```bash
   cp /root/hundlervpn/bot-chat/hundlervpn-bot-chat.service \
      /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable hundlervpn-bot-chat
   systemctl start hundlervpn-bot-chat
   ```

6. Verify it's polling:

   ```bash
   journalctl -u hundlervpn-bot-chat -f
   ```

   You should see:
   ```
   bot-chat: Bot identity: @hundlervpn_bot (id=…, name='Hundler VPN')
   bot-chat: Starting long-polling…
   ```

## Updating after a code change

```bash
cd /root/hundlervpn
git pull origin main
# Re-install deps only if requirements.txt changed:
# /root/hundlervpn/bot-chat/venv/bin/pip install -r /root/hundlervpn/bot-chat/requirements.txt
systemctl restart hundlervpn-bot-chat
```

## Custom emoji icons (Bot API 9.4)

The bot pre-declares slots for animated/styled custom emojis on every
important button (`bot-chat/emoji_icons.py`). Default state is empty,
so buttons render their plain Unicode emoji. To upgrade to animated
Premium emojis on Premium clients (non-Premium silently keep the
Unicode fallback):

1. Set `ADMIN_TELEGRAM_IDS=<your_tg_id>` in `.env` and
   `systemctl restart hundlervpn-bot-chat`.
2. From your Telegram client (Premium required for inserting custom
   emojis), send the bot **any** message that contains the animated
   emojis you want. iOS / Android: long-press the emoji picker tab
   to switch to the animated set. Desktop: click the smiley icon →
   “Premium” tab.
3. The bot replies with one line per emoji:
   `🔑  →  5170734948596768593`.
4. Edit `bot-chat/emoji_icons.py` and paste the IDs into the slots
   you care about (each slot has a comment showing where it appears).
5. `git add bot-chat/emoji_icons.py && git commit -m "chore: enable
   custom emoji on N buttons" && git push`, then on the VPS:
   `cd /root/hundlervpn && git pull && systemctl restart hundlervpn-bot-chat`.

Empty IDs are safe — the bot just keeps the static Unicode emoji.
Nothing breaks if you populate only some keys.

## Bot token

⚠️ **The chat bot uses a SEPARATE Telegram bot token from the Mini App
bot.** Each Telegram bot can only be polled by one process at a time —
two bots on the same token would race on getUpdates and lose messages.

Current tokens (as of 2026-05-06):
- `bot/` (Mini App launcher): see `bot/hundlervpn-bot.service` env
- `bot-chat/` (chat-only, this one): set in `bot-chat/.env`

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `TELEGRAM_BOT_TOKEN env var is required` | `.env` missing or has BOM | Recreate without BOM (see `_set_token.py` for example) |
| `column "language_code" does not exist` | Bot pulled before commit X | `git pull && systemctl restart` |
| Sub URL shows but client errors "user not found" | `XRAY_SYNC_TOKEN` mismatch | Copy the value from Hostman exactly |
| Buttons appear but stay grey | Old Telegram client | Telegram v11.7+ required for Bot API 9.4 colour buttons |
| Bot doesn't respond at all | Polling collision (token shared with Mini App bot) | Use a separate token from BotFather |
