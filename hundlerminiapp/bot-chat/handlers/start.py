"""/start handler + main menu.

Layout (Bot API 9.4 colour buttons — symmetric red/blue pairs):

    ┌──────────────────────────────────────┐
    │           🔑 Моя подписка             │  RED  full
    ├──────────────────┬───────────────────┤
    │  💳 Купить VPN   │  🎁 Промокод       │  RED  | RED
    ├──────────────────┼───────────────────┤
    │  📱 Устройства   │  👥 Друзья         │  BLUE | BLUE
    ├──────────────────┴───────────────────┤
    │           ❓ Как подключить            │  BLUE full
    ├──────────────────┬───────────────────┤
    │  📜 Соглашение   │ 🔒 Конфиденциальн. │  grey | grey
    └──────────────────┴───────────────────┘

Callback data scheme: `<section>:<action>[:<arg>]`
    sub:show          — show subscription panel
    plans:list        — show available tariffs
    promo:enter       — prompt for promo code
    devices:list      — show device list
    referral:show     — show referral panel
    help:install      — show install instructions menu
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from aiogram import Router, types
from aiogram.filters import CommandStart, CommandObject

import api_client
import db
import ui
from config import get_config

log = logging.getLogger(__name__)

router = Router(name="start")

WELCOME_PHOTO = Path(__file__).resolve().parent.parent.parent / "bot" / "welcome.png"


def main_menu_kb() -> dict:
    """Build the inline-keyboard payload for the home screen.

    Symmetric layout — pairs share a colour:
        Row 1 (full)  — Моя подписка                          RED
        Row 2 (pair)  — Купить + Промокод                     RED  | RED
        Row 3 (pair)  — Устройства + Друзья                   BLUE | BLUE
        Row 4 (full)  — Как подключить                        BLUE
        Row 5 (full)  — 🚀 Открыть мини-приложение            BLUE  (cross-link to @hundlervpnbot)
        Row 6 (pair)  — Соглашение + Конфиденциальность       grey | grey
    """
    cfg = get_config()
    # Sister-bot deep link. `?start=from_chat` lets the receiving bot tag
    # the visitor as having come from us (currently it just lands on /start
    # like everyone else; the param is forward-compatible for future
    # analytics — the main bot's CommandStart() handler ignores unknown
    # parameters, so this is safe to ship without coordinating a deploy).
    main_bot_url = f"https://t.me/{cfg.main_bot_username}?start=from_chat"
    return ui.keyboard(
        [ui.btn("🔑  Моя подписка", callback="sub:show", style="danger", icon="key")],
        [
            ui.btn("💳  Купить VPN", callback="plans:list", style="danger", icon="card"),
            ui.btn("🎁  Промокод", callback="promo:enter", style="danger", icon="gift"),
        ],
        [
            ui.btn("📱  Устройства", callback="devices:list", style="primary", icon="phones"),
            ui.btn("👥  Друзья", callback="referral:show", style="primary", icon="people"),
        ],
        [ui.btn("❓  Как подключить", callback="help:install", style="primary", icon="question")],
        [ui.btn("🚀  Открыть мини-приложение", url=main_bot_url, style="primary", icon="rocket")],
        [
            ui.btn(
                "📜  Соглашение",
                url="https://telegra.ph/Polzovatelskoe-soglashenie-Hundler-VPN-03-21",
                icon="scroll",
            ),
            ui.btn(
                "🔒  Конфиденциальность",
                url="https://telegra.ph/Politika-konfidencialnosti-Hundler-VPN-03-21",
                icon="lock",
            ),
        ],
    )


# Minimal welcome caption — the photo carries the brand, buttons are
# self-explanatory, no need for a wall of marketing copy.
WELCOME_TEXT = "<b>Добро пожаловать в Hundler VPN</b>"


@router.message(CommandStart())
async def cmd_start(message: types.Message, command: CommandObject) -> None:
    """Greet the user and show the main menu.

    Calls the SAME `/api/users/sync` endpoint the Mini App hits on
    launch, so a chat-bot user gets the identical onboarding contract:
    auto-created user row, +3 days trial subscription on first sign-in,
    AND +5 days referral signup bonus credited to the inviter when the
    user lands via `?start=ref_<code>`. Pre-fix this handler called
    `db.get_or_create_user` directly which skipped both bonuses — user
    report 2026-05-07: «где мои +3 дня которые всем должны даваться кто
    с тг заходит??? Где мои 5 дней на тот аккаунт с которого я
    приглашал этого пользователя?? Мини апка и этот бот это одна
    экосистема». Now they ARE one ecosystem.

    The `command` parameter is auto-injected by aiogram's CommandStart
    filter and exposes `command.args` which is everything after the
    `/start` keyword (e.g. `ref_uXX9` from `https://t.me/<bot>?start=
    ref_uXX9`). We forward it verbatim to `/api/users/sync?startParam=…`
    where the Next.js endpoint parses `ref_*` deep-links.
    """
    if not message.from_user:
        return

    # Hit /api/users/sync — same contract as the Mini App. Falls back to
    # `db.get_or_create_user` if the HTTP call fails so the menu still
    # renders and the user can navigate (other handlers re-sync on demand
    # via their own paths). Sync happens BEFORE we send the welcome card
    # so a brand-new user can immediately tap "Моя подписка" and see
    # their freshly issued +3-day trial.
    start_param = (command.args or "").strip() or None
    try:
        await api_client.sync_user(
            telegram_id=message.from_user.id,
            username=message.from_user.username,
            first_name=message.from_user.first_name,
            last_name=message.from_user.last_name,
            start_param=start_param,
        )
    except Exception as e:  # noqa: BLE001 — broad on purpose, see below
        log.warning("sync_user failed (start_param=%r): %s", start_param, e)
        # Network / API hiccup — fall back to a local upsert so the menu
        # still works. The user will miss the +3 days/+5 days on this
        # /start, but a future /start once the API is reachable again
        # will retroactively grant them via `userNeedsInitialTrial` (the
        # Mini App's contract is idempotent — trial only fires once
        # per (user, ever) so re-sync is safe).
        try:
            await asyncio.to_thread(
                db.get_or_create_user,
                message.from_user.id,
                message.from_user.username,
                message.from_user.first_name,
                message.from_user.last_name,
                message.from_user.language_code,
            )
        except Exception as e2:
            log.exception("fallback get_or_create_user also failed: %s", e2)

    kb = main_menu_kb()

    # Try to send with welcome.png; fall back to text-only if file missing
    # (e.g. when running outside the repo root).
    if WELCOME_PHOTO.exists():
        try:
            with open(WELCOME_PHOTO, "rb") as f:
                photo_bytes = f.read()
            await ui.send_photo_file(
                message.chat.id,
                photo_bytes,
                "welcome.png",
                caption=WELCOME_TEXT,
                reply_markup=kb,
            )
            return
        except Exception as e:
            log.warning("Failed to send welcome photo, falling back to text: %s", e)

    await ui.send_message(message.chat.id, WELCOME_TEXT, reply_markup=kb)


@router.callback_query(lambda cq: cq.data == "menu:home")
async def cb_home(callback: types.CallbackQuery) -> None:
    """'Назад в меню' from any sub-screen — edits the message back to the home view."""
    if not callback.message:
        await ui.answer_callback_query(callback.id)
        return
    try:
        await ui.smart_edit(
            callback.message, WELCOME_TEXT, reply_markup=main_menu_kb(),
        )
    except RuntimeError as e:
        log.info("home edit failed: %s", e)
    await ui.answer_callback_query(callback.id)
