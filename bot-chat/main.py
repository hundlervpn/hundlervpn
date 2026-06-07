"""HundlerVPN chat-only bot — entry point.

Runs as a long-polling aiogram 3 bot. Designed to live alongside the
existing Mini-App-launcher bot (`bot/main.py`) on the same VPS — the
two never share a token so getUpdates can never collide.

Architecture:
    - aiogram 3 Router-based handlers live in `handlers/`.
    - `ui.py` exposes direct Bot-API HTTP wrappers because aiogram 3.4
      drops `style` / `icon_custom_emoji_id` (Bot API 9.4 fields) during
      Pydantic serialisation.
    - `db.py` reads PostgreSQL directly via psycopg2 (mirroring `bot/`).
    - Write operations (creating SBP/crypto invoices, applying promos)
      go through the Next.js API via `api_client.py`.

Run locally:
    python -m pip install -r requirements.txt
    $env:TELEGRAM_BOT_TOKEN="123:abc"; python main.py
"""
from __future__ import annotations

import asyncio
import logging
import sys

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage

from config import get_config
from handlers import _admin as h_admin
from handlers import buy as h_buy
from handlers import devices as h_devices
from handlers import help as h_help
from handlers import promo as h_promo
from handlers import referral as h_referral
from handlers import start as h_start
from handlers import stub as h_stub
from handlers import subscription as h_sub


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stdout,
    )
    # aiogram is chatty at DEBUG — keep it at INFO so our logs stay readable.
    logging.getLogger("aiogram").setLevel(logging.INFO)
    logging.getLogger("aiohttp").setLevel(logging.WARNING)


async def main() -> None:
    setup_logging()
    log = logging.getLogger("bot-chat")

    cfg = get_config()
    bot = Bot(token=cfg.bot_token)

    # Verify token + log identity before polling so misconfiguration shows
    # immediately instead of in the first user message.
    me = await bot.get_me()
    log.info("Bot identity: @%s (id=%s, name=%r)", me.username, me.id, me.first_name)
    if me.username and me.username.lower() != cfg.bot_username.lower():
        log.warning(
            "Configured BOT_USERNAME=%r does not match actual @%s — "
            "share-links will be wrong",
            cfg.bot_username, me.username,
        )

    # MemoryStorage is fine for the current single-process deploy. Switch to
    # RedisStorage if/when we shard or restart the bot frequently — promo
    # entry state would be lost on restart, but it's only relevant for ~30s
    # so the user just retypes the code.
    dp = Dispatcher(storage=MemoryStorage())

    # Order matters: stub matches everything with a known prefix, so it
    # MUST come AFTER any concrete handler that wants to claim a callback.
    dp.include_router(h_start.router)
    dp.include_router(h_sub.router)
    dp.include_router(h_buy.router)
    dp.include_router(h_promo.router)
    dp.include_router(h_devices.router)
    dp.include_router(h_referral.router)
    dp.include_router(h_help.router)
    dp.include_router(h_stub.router)  # catches any leftover unknown sections
    # Admin router runs LAST. It only fires for messages from
    # ADMIN_TELEGRAM_IDS that contain custom emoji entities, so it never
    # interferes with regular user flows.
    dp.include_router(h_admin.router)

    log.info("Starting long-polling…")
    await dp.start_polling(bot, allowed_updates=["message", "callback_query"])


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
