import os
import asyncio
import json
import logging
import aiohttp
import psycopg2
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo, FSInputFile, URLInputFile
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Get bot token from environment
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
APP_URL = os.getenv("APP_URL", "https://hundlervpn.xyz/")
# 2026-05-05: bot username used to build deep-link URLs for inline broadcast
# buttons of kind 'app' / 'promo'. Format: https://t.me/<USERNAME>?startapp=...
# Tapping such a link opens the Mini App and forwards the value as
# Telegram.WebApp.initDataUnsafe.start_param. Override via env if needed.
BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "hundlervpnbot")
# 2026-05-07: parallel chat-only bot (lives in bot-chat/). Linked from /start
# as a fallback for users whose Telegram client refuses to launch the Mini
# App (older clients, web Telegram on certain browsers, work-managed devices,
# etc). The chat-bot exposes the SAME purchase / subscription / promo flow
# entirely through inline keyboards so users never need a Mini App at all.
CHAT_BOT_USERNAME = os.getenv("CHAT_BOT_USERNAME", "hundlervpn_bot").lstrip("@")

# Database connection.
#
# v66 (2026-04-28): `sslmode=require` default. Originally needed because the
# old Timeweb-hosted Postgres silently DROPPED plain-TCP startup packets and
# psycopg2 hung for 10s on every poll. v68 (2026-05-17): we migrated off
# Timeweb to Hostman managed PG at 132.243.242.196, which still requires
# `sslmode=require` (TLSv1.3 mandatory at the listener). Keep the default
# even if you swap hosts — it's free at this point and prevents accidental
# plaintext connections on any future managed-PG move.
DB_CONFIG = {
    "host": os.getenv("POSTGRESQL_HOST", "132.243.242.196"),
    "port": int(os.getenv("POSTGRESQL_PORT", "5432")),
    "user": os.getenv("POSTGRESQL_USER", "gen_user"),
    "password": os.getenv("POSTGRESQL_PASSWORD", ""),
    "database": os.getenv("POSTGRESQL_DBNAME", "default_db"),
    "sslmode": os.getenv("POSTGRESQL_SSLMODE", "require"),
}

if not BOT_TOKEN:
    raise ValueError("TELEGRAM_BOT_TOKEN environment variable is not set")

# Initialize bot and dispatcher
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# ---------------------------------------------------------------------------
# Direct Bot API helpers for /start.
#
# aiogram 3.4's Pydantic models for `InlineKeyboardButton` reject unknown
# fields like `style` (Bot API 9.4 colour buttons) and `icon_custom_emoji_id`
# (Bot API 9.4 custom-emoji button icons) — they get silently dropped during
# JSON serialisation. The chat-bot (`bot-chat/ui.py`) solves the same problem
# the same way: build the payload as a plain dict and POST it directly. We
# keep the helpers tiny here because the main bot only emits ONE rich
# message (the /start welcome card); broadcasts still go through aiogram
# because they don't need styled buttons.
# ---------------------------------------------------------------------------
_TG_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

# Custom-emoji IDs from the public `tgiosicons` Telegram pack — same source
# as bot-chat. Keep this list narrow: only the icons /start actually uses.
# Premium clients render the iOS-styled animated emoji; non-Premium clients
# fall back to the plain Unicode glyph that's still inside the <tg-emoji>
# tag, so this is a zero-risk progressive enhancement.
# 2026-05-11: replaced with user's own custom-emoji pack IDs.
# Same icons reused across welcome bullets + button icons (so e.g. 🔒 ID
# appears both in EMOJI_IDS and BTN_ICON_LOCK — that's intentional).
EMOJI_IDS: dict[str, str] = {
    "\U0001F44B": "5330250874730082574",   # 👋 waving hand — "Добро пожаловать"
    "\U0001F512": "5330194932781050507",   # 🔒 lock — "Быстрый и безопасный VPN…"
    "\u2728":     "5330094327467113707",   # ✨ sparkles — "Что вы получаете"
    "\u26A1":     "5332752267978239415",   # ⚡ lightning — "Минимальные задержки"
    "\U0001F310": "5330250874730082574",   # 🌐 globe (kept — used by chat-bot button)
}

# Button-icon IDs (override the leading button text emoji on Premium clients).
# 2026-05-11: replaced with user's own custom-emoji pack IDs.
BTN_ICON_LOCK = "5330194932781050507"     # «Конфиденциальность» (same id as 🔒 above)
BTN_ICON_FOLDER = "5330094327467113707"   # «Соглашение»          (same id as ✨ above)
BTN_ICON_GLOBE = "5330250874730082574"    # «Полная версия в чате» (same id as 👋 above)
BTN_ICON_ROCKET = "5332289648460853008"   # «Открыть VPN»


def _wrap_emojis(text: str) -> str:
    """Replace each known Unicode emoji with the Telegram <tg-emoji> tag
    so Premium clients render the styled animated icon. Non-Premium clients
    silently see the plain emoji thanks to the inner text fallback."""
    out = text
    for ch, emoji_id in EMOJI_IDS.items():
        out = out.replace(ch, f'<tg-emoji emoji-id="{emoji_id}">{ch}</tg-emoji>')
    return out


async def _tg_post(method: str, payload: dict, *, files: dict | None = None) -> dict:
    """POST `payload` to api.telegram.org/bot<TOKEN>/<method>. When `files`
    is set, switches to multipart/form-data and serialises any non-string
    payload values as JSON (Telegram's standard convention for media
    uploads). Raises `RuntimeError` on Telegram-reported errors so the
    caller's try/except logs a useful diagnostic."""
    url = f"{_TG_API}/{method}"
    async with aiohttp.ClientSession() as session:
        if files:
            data = aiohttp.FormData()
            for k, v in payload.items():
                if v is None:
                    continue
                data.add_field(k, v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
            for fname, (filename, content, mime) in files.items():
                data.add_field(fname, content, filename=filename, content_type=mime)
            async with session.post(url, data=data, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                body = await resp.json()
        else:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                body = await resp.json()
    if not body.get("ok"):
        raise RuntimeError(f"Telegram {method} failed: {body}")
    return body["result"]


def _start_keyboard() -> dict:
    """Build the /start inline keyboard as a plain dict so we can attach
    Bot API 9.4 fields (`style`, `icon_custom_emoji_id`) that aiogram
    would otherwise drop during Pydantic serialisation.

    Layout (rendered top-down on the welcome card, 2026-05-07):
        [ 🚀 Открыть VPN ]                          (full-width, danger red)
        [ 🌐 Полная версия в чате ]                  (full-width, danger red)
        [ 🔒 Политика ] [ 📄 Соглашение ]              (50/50 split, neutral grey)

    Bot API 9.4 only ships three accent colours (`primary`/`success`/
    `danger`); there is no "black" style, so the bottom utility row stays
    on the default neutral background — that's still the closest thing
    to the user-asked "чёрный" available today.
    """
    return {
        "inline_keyboard": [
            [
                {
                    "text": "Открыть VPN",
                    "web_app": {"url": APP_URL},
                    "style": "danger",
                    "icon_custom_emoji_id": BTN_ICON_ROCKET,
                }
            ],
            [
                {
                    "text": "Полная версия в чате",
                    "url": f"https://t.me/{CHAT_BOT_USERNAME}?start=from_main",
                    "style": "danger",
                    "icon_custom_emoji_id": BTN_ICON_GLOBE,
                }
            ],
            [
                {
                    "text": "Конфиденциальность",
                    "url": "https://telegra.ph/Politika-konfidencialnosti-Hundler-VPN-03-21",
                    "icon_custom_emoji_id": BTN_ICON_LOCK,
                },
                {
                    "text": "Соглашение",
                    "url": "https://telegra.ph/Polzovatelskoe-soglashenie-Hundler-VPN-03-21",
                    "icon_custom_emoji_id": BTN_ICON_FOLDER,
                },
            ],
        ]
    }


def get_db_connection():
    # connect_timeout prevents hangs if the DB IP is firewalled or
    # the server is unreachable mid-handshake — without it psycopg2 waits forever.
    return psycopg2.connect(**DB_CONFIG, connect_timeout=10)


# Welcome caption (2026-05-07, second iteration): user explicitly asked
# to bring back the marketing bullets ("оставь то с должными уникальными
# эмодзи") but keep the fallback line short — only the original prose
# `…нажмите «Полная версия в чате» или откройте @hundlervpn_bot, все
# функции работают прямо в чате.` was the "длинное дибильное" they hated,
# not the bullet list. Each bullet leads with a unique custom-emoji-mapped
# glyph (👋 🔒 ✨ ⚡) so Premium clients render styled icons via
# `_wrap_emojis()`; non-Premium clients see the same plain glyphs.
WELCOME_TEXT = (
    "👋 <b>Добро пожаловать в Hundler VPN!</b>\n\n"
    "🔒 Быстрый и безопасный VPN для ваших устройств.\n\n"
    "✨ <b>Что вы получаете:</b>\n"
    "• До 3 устройств одновременно\n"
    "• Безлимитный трафик\n"
    "• Минимальные задержки\n\n"
    "<i>Если приложение не работает @{chat_bot}</i>"
).format(chat_bot=CHAT_BOT_USERNAME)


@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    """Send the welcome card.

    Goes through direct HTTP (not aiogram) so we can pin
    `style: "primary"` and `icon_custom_emoji_id` on the buttons —
    aiogram 3.4 silently drops both of those fields during Pydantic
    serialisation, which is why the chat-bot uses the same trick.
    Falls back to the previous aiogram path on any error so a
    partial Telegram outage can't keep new users from seeing /start.
    """
    chat_id = message.chat.id
    photo_path = Path(__file__).parent / 'welcome.png'
    caption = _wrap_emojis(WELCOME_TEXT)
    keyboard = _start_keyboard()

    try:
        if photo_path.exists():
            with open(photo_path, "rb") as fp:
                photo_bytes = fp.read()
            await _tg_post(
                "sendPhoto",
                {
                    "chat_id": chat_id,
                    "caption": caption,
                    "parse_mode": "HTML",
                    "reply_markup": keyboard,
                },
                files={"photo": ("welcome.png", photo_bytes, "image/png")},
            )
        else:
            await _tg_post(
                "sendMessage",
                {
                    "chat_id": chat_id,
                    "text": caption,
                    "parse_mode": "HTML",
                    "reply_markup": keyboard,
                    "link_preview_options": {"is_disabled": True},
                },
            )
        return
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "direct /start send failed (%s) — falling back to aiogram default keyboard",
            e,
        )

    # ---- Fallback path: plain aiogram keyboard, no styled buttons. -------
    fallback_kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🚀 Открыть VPN", web_app=WebAppInfo(url=APP_URL))],
            [InlineKeyboardButton(
                text="💬 Полная версия в чате",
                url=f"https://t.me/{CHAT_BOT_USERNAME}?start=from_main",
            )],
            [
                InlineKeyboardButton(
                    text="🔒 Конфиденциальность",
                    url="https://telegra.ph/Politika-konfidencialnosti-Hundler-VPN-03-21",
                ),
                InlineKeyboardButton(
                    text="📄 Соглашение",
                    url="https://telegra.ph/Polzovatelskoe-soglashenie-Hundler-VPN-03-21",
                ),
            ],
        ]
    )
    if photo_path.exists():
        await message.answer_photo(
            photo=FSInputFile(photo_path),
            caption=caption,
            parse_mode="HTML",
            reply_markup=fallback_kb,
        )
    else:
        await message.answer(caption, parse_mode="HTML", reply_markup=fallback_kb)


def _fetch_pending_broadcast_sync():
    """Fetch one pending broadcast + target users, mark it as 'sending'.

    Runs in a worker thread via asyncio.to_thread so the blocking psycopg2
    calls never freeze the aiogram event loop.

    v65: target_audience filter — 'all' / 'active' / 'no_sub'. SQL must
    stay in sync with `buildAudienceCountSql` in
    `app/api/admin/broadcasts/route.ts` so the count shown to the admin
    matches the actual recipients.
    """
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, title, message, image_url, button_text, button_url,
                   target_telegram_id, target_audience,
                   button_kind, button_promo_code
            FROM broadcasts
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
            """
        )
        row = cur.fetchone()
        if not row:
            return None

        (broadcast_id, title, message, image_url, button_text, button_url,
         target_telegram_id, target_audience,
         button_kind, button_promo_code) = row
        cur.execute("UPDATE broadcasts SET status = 'sending' WHERE id = %s", (broadcast_id,))
        conn.commit()

        if target_telegram_id:
            # Single-user override — audience filter ignored.
            users = [target_telegram_id]
        else:
            audience = target_audience or 'all'
            if audience == 'active':
                # Users with at least one active, non-expired subscription.
                cur.execute(
                    """
                    SELECT u.telegram_id
                    FROM users u
                    WHERE u.telegram_id IS NOT NULL
                      AND EXISTS (
                        SELECT 1 FROM subscriptions s
                        WHERE s.user_id = u.id
                          AND s.status = 'active'
                          AND s.end_date > NOW()
                      )
                    """
                )
            elif audience == 'no_sub':
                # Users WITHOUT an active subscription (expired or never had).
                cur.execute(
                    """
                    SELECT u.telegram_id
                    FROM users u
                    WHERE u.telegram_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM subscriptions s
                        WHERE s.user_id = u.id
                          AND s.status = 'active'
                          AND s.end_date > NOW()
                      )
                    """
                )
            elif audience == 'active_no_devices':
                # 2026-05-05: users with a live subscription but ZERO non-kicked
                # device_sessions. Targets people who paid but never imported
                # the VLESS subscription into a VPN client (=> "still no app
                # connected" reminder). Mirror of buildAudienceCountSql in
                # app/api/admin/broadcasts/route.ts — keep in sync.
                cur.execute(
                    """
                    SELECT u.telegram_id
                    FROM users u
                    WHERE u.telegram_id IS NOT NULL
                      AND EXISTS (
                        SELECT 1 FROM subscriptions s
                        WHERE s.user_id = u.id
                          AND s.status = 'active'
                          AND s.end_date > NOW()
                      )
                      AND NOT EXISTS (
                        SELECT 1 FROM device_sessions ds
                        WHERE ds.user_id = u.id
                          AND ds.kicked_at IS NULL
                      )
                    """
                )
            else:
                # 'all' — every user with telegram_id.
                cur.execute("SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL")
            users = [r[0] for r in cur.fetchall()]

        cur.close()
        return {
            "id": broadcast_id,
            "title": title,
            "message": message,
            "image_url": image_url,
            "button_text": button_text,
            "button_url": button_url,
            "button_kind": button_kind or 'url',
            "button_promo_code": button_promo_code,
            "target_audience": target_audience or 'all',
            "users": users,
        }
    finally:
        conn.close()


def _finish_broadcast_sync(broadcast_id: int, sent_count: int, failed_count: int):
    """Mark the broadcast as completed. Runs in a worker thread."""
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE broadcasts
            SET status = 'sent', sent_count = %s, failed_count = %s, sent_at = NOW()
            WHERE id = %s
            """,
            (sent_count, failed_count, broadcast_id),
        )
        conn.commit()
        cur.close()
    finally:
        conn.close()


async def process_pending_broadcasts():
    """Check for pending broadcasts and send them"""
    try:
        logger.info("Checking for pending broadcasts...")
        data = await asyncio.to_thread(_fetch_pending_broadcast_sync)

        if data is None:
            logger.info("No pending broadcasts found")
            return

        logger.info(
            f"Found broadcast {data['id']}: {data['title']} "
            f"(targets: {len(data['users'])})"
        )

        # 2026-05-05: build the inline button URL based on button_kind.
        #   'url'   — use the raw button_url field (legacy behaviour).
        #   'app'   — https://t.me/<bot>?startapp=open — opens the Mini App.
        #   'promo' — https://t.me/<bot>?startapp=promo_<CODE> — opens the
        #              Mini App; frontend boot effect (app/page.tsx) parses
        #              the start_param prefix and auto-applies the promo via
        #              /api/promos/apply.
        # If button_text is set but the resolved URL ends up empty (e.g.
        # 'url' kind with no button_url, or 'promo' kind with no code), we
        # silently drop the button rather than fail the whole broadcast.
        button_kind = data.get("button_kind") or 'url'
        if button_kind == 'app':
            # `open` is just an arbitrary marker so Telegram routes to the
            # Mini App; the frontend ignores it. Any non-empty value works.
            resolved_url = f"https://t.me/{BOT_USERNAME}?startapp=open"
            # Provide a sensible default text if admin left it empty.
            resolved_text = data["button_text"] or "Открыть приложение"
        elif button_kind == 'promo' and data.get("button_promo_code"):
            code = str(data["button_promo_code"]).strip().upper()
            resolved_url = f"https://t.me/{BOT_USERNAME}?startapp=promo_{code}"
            resolved_text = data["button_text"] or f"Активировать {code}"
        else:
            resolved_url = data["button_url"]
            resolved_text = data["button_text"]

        keyboard = None
        if resolved_text and resolved_url:
            keyboard = InlineKeyboardMarkup(
                inline_keyboard=[[
                    InlineKeyboardButton(text=resolved_text, url=resolved_url)
                ]]
            )

        full_message = ""
        if data["title"]:
            full_message = f"<b>{data['title']}</b>\n\n"
        full_message += data["message"]

        sent_count = 0
        failed_count = 0

        for telegram_id in data["users"]:
            try:
                if data["image_url"]:
                    try:
                        await bot.send_photo(
                            chat_id=telegram_id,
                            photo=URLInputFile(data["image_url"]),
                            caption=full_message,
                            parse_mode="HTML",
                            reply_markup=keyboard,
                        )
                    except Exception:
                        await bot.send_message(
                            chat_id=telegram_id,
                            text=full_message,
                            parse_mode="HTML",
                            reply_markup=keyboard,
                        )
                else:
                    await bot.send_message(
                        chat_id=telegram_id,
                        text=full_message,
                        parse_mode="HTML",
                        reply_markup=keyboard,
                    )

                sent_count += 1
                await asyncio.sleep(0.05)  # Rate limiting

            except Exception as e:
                logger.error(f"Failed to send broadcast to {telegram_id}: {e}")
                failed_count += 1

        await asyncio.to_thread(_finish_broadcast_sync, data["id"], sent_count, failed_count)
        logger.info(
            f"Broadcast {data['id']} completed: {sent_count} sent, {failed_count} failed"
        )

    except Exception as e:
        logger.error(f"Error processing broadcasts: {e}")


async def broadcast_scheduler():
    """Background task to check for broadcasts every 10 seconds"""
    while True:
        await process_pending_broadcasts()
        await asyncio.sleep(10)


async def main():
    """Start the bot"""
    # Broadcast scheduler can be disabled by setting BROADCASTS_ENABLED=0.
    # Useful when the DB is temporarily unreachable — /start keeps working.
    if os.getenv("BROADCASTS_ENABLED", "1") != "0":
        asyncio.create_task(broadcast_scheduler())
    else:
        logger.warning("Broadcast scheduler disabled via BROADCASTS_ENABLED=0")

    # Start polling
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
