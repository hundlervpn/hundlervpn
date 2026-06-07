"""Referral / 'Друзья' panel.

Shows the user's invite code, a clickable t.me link, and stats:
    - invited friends count
    - total bonus days earned

Bonus rules (matches Mini App copy):
    +5 дней за регистрацию друга по твоей ссылке
    +7 дней за каждый платёж друга на 1 месяц
    +14 дней — на 6 месяцев
    +21 день — на 1 год
"""
from __future__ import annotations

import asyncio
import logging

from aiogram import Router, types

import db
import ui
from config import get_config

log = logging.getLogger(__name__)

router = Router(name="referral")


def _share_link(code: str) -> str:
    cfg = get_config()
    return f"https://t.me/{cfg.bot_username}?start=ref_{code}"


@router.callback_query(lambda cq: cq.data == "referral:show")
async def cb_referral_show(callback: types.CallbackQuery) -> None:
    if not callback.message or not callback.from_user:
        await ui.answer_callback_query(callback.id)
        return

    tid = callback.from_user.id
    try:
        user = await asyncio.to_thread(db.get_user_by_telegram_id, tid)
        if not user:
            # Brand-new user (never sent /start) — upsert so referral_code exists.
            user = await asyncio.to_thread(
                db.get_or_create_user,
                tid,
                callback.from_user.username,
                callback.from_user.first_name,
                callback.from_user.last_name,
                callback.from_user.language_code,
            )
        stats = await asyncio.to_thread(db.get_referral_stats, user["id"])
    except Exception as e:  # noqa: BLE001
        log.exception("referral:show DB error: %s", e)
        await ui.smart_edit(
            callback.message,
            "⚠️  Не удалось загрузить реферальную статистику.",
            reply_markup=ui.keyboard([ui.btn("⬅️  Назад в меню", callback="menu:home", icon="back")]),
        )
        await ui.answer_callback_query(callback.id)
        return

    code = stats.get("code")
    if not code:
        # If a legacy account is missing referral_code, generate one inline.
        # `lib/access.ts` uses `u<base36(telegramId)>` — match that format.
        code = f"u{_to_base36(tid)}"
        try:
            await asyncio.to_thread(
                db.execute,
                "UPDATE users SET referral_code = %s WHERE id = %s AND referral_code IS NULL",
                (code, user["id"]),
            )
        except Exception as e:  # noqa: BLE001
            log.warning("Failed to backfill referral_code: %s", e)

    link = _share_link(code)
    invited = stats.get("invited_count", 0)
    bonus = stats.get("bonus_days_total", 0)

    text = (
        "👥  <b>Реферальная программа</b>\n\n"
        "Зови друзей — получай бесплатные дни VPN:\n"
        "•  <b>+5 дней</b> — за регистрацию друга\n"
        "•  <b>+7 дней</b> — за оплату 1 месяца\n"
        "•  <b>+14 дней</b> — за оплату 6 месяцев\n"
        "•  <b>+21 день</b> — за оплату 1 года\n\n"
        f"📊  Приглашено: <b>{invited}</b>\n"
        f"🎁  Получено бонусных дней: <b>{bonus}</b>\n\n"
        "🔗  <b>Твоя ссылка:</b>\n"
        f"<code>{_html_escape(link)}</code>\n\n"
        "Бонусы за оплату начисляются с подписок от 30 дней."
    )

    share_text = (
        f"Подключи Hundler VPN по моей ссылке и получи бонусные дни 🚀\n{link}"
    )
    kb = ui.keyboard(
        [ui.btn("📋  Скопировать ссылку", copy_text=link, style="success", icon="copy")],
        [ui.btn("📤  Поделиться в Telegram", url=f"https://t.me/share/url?url={_url_quote(link)}&text={_url_quote('Подключи Hundler VPN — быстрый и безопасный VPN 🚀')}", style="danger", icon="share")],
        [ui.btn("⬅️  В меню", callback="menu:home", icon="back")],
    )
    _ = share_text  # kept here for grep when we add a 'switch_inline' button later
    await ui.smart_edit(callback.message, text, reply_markup=kb)
    await ui.answer_callback_query(callback.id)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _to_base36(n: int) -> str:
    if n < 0:
        return "-" + _to_base36(-n)
    if n < 36:
        return "0123456789abcdefghijklmnopqrstuvwxyz"[n]
    return _to_base36(n // 36) + _to_base36(n % 36)


def _url_quote(s: str) -> str:
    from urllib.parse import quote
    return quote(s, safe="")


def _html_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
