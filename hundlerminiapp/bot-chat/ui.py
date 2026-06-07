"""UI helpers — Bot API 9.4 colour buttons + custom emoji + formatting.

Why direct HTTP instead of aiogram:
    aiogram 3.4's Pydantic models for `InlineKeyboardButton` reject unknown
    fields like `style` and `icon_custom_emoji_id` — they get silently
    dropped during JSON serialisation. We therefore call sendMessage /
    editMessageText directly via aiogram's underlying aiohttp session
    when buttons need a `style`. For plain replies we still use aiogram
    methods (Markdown helpers, FSInputFile, etc).

Style values (Bot API 9.4):
    "primary"  → blue   (main CTA — "Купить", "Подключить")
    "success"  → green  (positive confirm — "Активировать", "Применить")
    "danger"   → red    (destructive — "Удалить устройство", "Отменить")
    None       → default app-specific (~translucent grey)
"""
from __future__ import annotations

import logging
from typing import Any, TypedDict

import aiohttp

from config import get_config
from emoji_icons import EMOJI_TO_ID as _EMOJI_TO_ID
from emoji_icons import ICON_KEY_TO_EMOJI as _ICON_KEY_TO_EMOJI
from emoji_icons import ICONS as _ICONS

log = logging.getLogger(__name__)


def emoji(name: str) -> str | None:
    """Return custom_emoji_id for a semantic name, or None if not configured.

    Reading from `emoji_icons.ICONS` (a hand-edited dict). Empty strings are
    treated as None so partially populated dicts don't accidentally send empty
    strings to Telegram (which would be rejected as invalid emoji IDs).
    """
    val = _ICONS.get(name)
    return val if val else None


# ---------------------------------------------------------------------------
# Custom emoji helper for HTML-formatted messages.
#
# Telegram supports the `<tg-emoji emoji-id="…">…</tg-emoji>` HTML tag
# (Bot API + Telegram clients ≥ Q1 2023). When a Premium client renders
# a message that uses this tag, it replaces the inner emoji with the
# styled custom emoji from the referenced pack. Non-Premium clients
# silently fall back to whatever sits between the open / close tags —
# i.e. the original Unicode glyph — so this is a strictly additive
# upgrade with no regressions.
#
# We pre-sort by length DESC so longer multi-codepoint sequences (like
# "⬅️" with U+FE0F selector) match before their shorter siblings.
# ---------------------------------------------------------------------------
_EMOJIS_BY_LENGTH = sorted(
    (em for em, eid in _EMOJI_TO_ID.items() if eid),
    key=len,
    reverse=True,
)


def _wrap_emojis_html(text: str) -> str:
    """Replace each known emoji in `text` with a `<tg-emoji>` tag.

    Operates on already-HTML-escaped text (we don't escape input — callers
    pass strings that already include `<b>`, `<code>` etc.). We naively
    skip tag interiors via a single-pass scanner to avoid wrapping emojis
    that happen to sit inside another tag's attribute (rare but possible).
    """
    if not text or not _EMOJIS_BY_LENGTH:
        return text
    out: list[str] = []
    i = 0
    n = len(text)
    in_tag = False
    while i < n:
        ch = text[i]
        if ch == "<":
            in_tag = True
            out.append(ch)
            i += 1
            continue
        if ch == ">":
            in_tag = False
            out.append(ch)
            i += 1
            continue
        if in_tag:
            out.append(ch)
            i += 1
            continue
        # Try to match the longest known emoji at this position
        matched = False
        for em in _EMOJIS_BY_LENGTH:
            if text.startswith(em, i):
                eid = _EMOJI_TO_ID[em]
                out.append(f'<tg-emoji emoji-id="{eid}">{em}</tg-emoji>')
                i += len(em)
                matched = True
                break
        if not matched:
            out.append(ch)
            i += 1
    return "".join(out)


def _strip_leading_emoji(text: str, emoji_char: str) -> str:
    """Remove `emoji_char` (and any trailing whitespace) from the start of `text`.

    Used by `btn()` to avoid duplicate icons when a button has both a
    leading Unicode emoji in its label AND an `icon_custom_emoji_id`
    (Telegram renders both side-by-side, which looks bad).
    """
    if emoji_char and text.startswith(emoji_char):
        return text[len(emoji_char):].lstrip()
    return text


class Button(TypedDict, total=False):
    text: str
    style: str  # "primary" | "success" | "danger"
    callback_data: str
    url: str
    icon_custom_emoji_id: str
    copy_text: dict  # {"text": "..."}
    switch_inline_query: str
    switch_inline_query_current_chat: str


def btn(
    text: str,
    *,
    callback: str | None = None,
    url: str | None = None,
    style: str | None = None,
    icon: str | None = None,
    emoji_id: str | None = None,
    copy_text: str | None = None,
) -> Button:
    """Build one inline-keyboard button dict, suitable for sendMessage payloads.

    Exactly one of callback / url / copy_text must be set.

    Parameters
    ----------
    text : str
        Button label including a leading Unicode emoji (e.g. "🔑  Моя подписка").
        The Unicode emoji is the safe fallback for non-Premium clients.
    style : 'primary' | 'success' | 'danger' | None
        Bot API 9.4 colour. None = default (translucent grey).
    icon : str | None
        Semantic key looked up in `emoji_icons.ICONS`. If a value is configured
        for this key, the button's leading emoji is replaced with the animated
        custom variant on Premium clients. If the key is missing or empty,
        falls back to the plain Unicode emoji baked into `text`.
    emoji_id : str | None
        Direct override for `icon_custom_emoji_id` (rarely used; prefer `icon`).
    """
    b: Button = {}
    if callback is not None:
        b["callback_data"] = callback
    if url is not None:
        b["url"] = url
    if copy_text is not None:
        b["copy_text"] = {"text": copy_text}
    if style is not None:
        if style not in ("primary", "success", "danger"):
            raise ValueError(f"invalid style: {style}")
        b["style"] = style
    resolved_emoji = emoji_id
    if resolved_emoji is None and icon is not None:
        resolved_emoji = emoji(icon)
    if resolved_emoji is not None:
        b["icon_custom_emoji_id"] = resolved_emoji
        # Telegram renders both the leading text emoji AND the icon side
        # by side, which looks doubled. Strip the leading emoji from the
        # button label whenever we know which one this icon represents.
        leading_char = _ICON_KEY_TO_EMOJI.get(icon or "")
        if leading_char:
            text = _strip_leading_emoji(text, leading_char)
    b["text"] = text
    return b


def keyboard(*rows: list[Button]) -> dict:
    """Wrap rows of buttons into the inline_keyboard payload shape."""
    return {"inline_keyboard": [list(r) for r in rows]}


# ---------------------------------------------------------------------------
# Direct Bot-API HTTP wrappers (bypass aiogram models so style passes through).
# ---------------------------------------------------------------------------


async def _api(method: str, payload: dict) -> dict:
    """POST application/json to https://api.telegram.org/bot<token>/<method>.

    Returns the `result` field on success, raises RuntimeError otherwise.
    """
    cfg = get_config()
    url = f"https://api.telegram.org/bot{cfg.bot_token}/{method}"
    timeout = aiohttp.ClientTimeout(total=20)
    async with aiohttp.ClientSession(timeout=timeout) as s:
        async with s.post(url, json=payload) as r:
            data = await r.json()
            if not data.get("ok"):
                raise RuntimeError(f"tg {method} failed: {data}")
            return data.get("result", {})


def _maybe_wrap(text: str | None, parse_mode: str | None) -> str | None:
    """Wrap known emojis in `<tg-emoji>` tags when sending HTML."""
    if text is None or parse_mode != "HTML":
        return text
    return _wrap_emojis_html(text)


async def send_message(
    chat_id: int,
    text: str,
    *,
    reply_markup: dict | None = None,
    parse_mode: str | None = "HTML",
    disable_web_page_preview: bool = True,
) -> dict:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": _maybe_wrap(text, parse_mode),
        "disable_web_page_preview": disable_web_page_preview,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return await _api("sendMessage", payload)


async def send_photo(
    chat_id: int,
    photo_url_or_file_id: str,
    *,
    caption: str | None = None,
    reply_markup: dict | None = None,
    parse_mode: str | None = "HTML",
) -> dict:
    payload: dict[str, Any] = {"chat_id": chat_id, "photo": photo_url_or_file_id}
    if caption is not None:
        payload["caption"] = _maybe_wrap(caption, parse_mode)
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return await _api("sendPhoto", payload)


async def edit_message_text(
    chat_id: int,
    message_id: int,
    text: str,
    *,
    reply_markup: dict | None = None,
    parse_mode: str | None = "HTML",
    disable_web_page_preview: bool = True,
) -> dict:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": _maybe_wrap(text, parse_mode),
        "disable_web_page_preview": disable_web_page_preview,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return await _api("editMessageText", payload)


async def edit_message_caption(
    chat_id: int,
    message_id: int,
    caption: str,
    *,
    reply_markup: dict | None = None,
    parse_mode: str | None = "HTML",
) -> dict:
    """Edit the caption of a media message (photo / video / etc).

    Use this when the message you want to edit was originally sent via
    `send_photo` / `send_photo_file` — `editMessageText` returns
    `MESSAGE_CANT_BE_EDITED` for media messages, but `editMessageCaption`
    works fine.
    """
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "message_id": message_id,
        "caption": _maybe_wrap(caption, parse_mode),
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return await _api("editMessageCaption", payload)


async def smart_edit(
    message: Any,
    text: str,
    *,
    reply_markup: dict | None = None,
    parse_mode: str | None = "HTML",
) -> dict:
    """Edit the given message in place — text body OR photo caption.

    Detects whether `message` was originally sent as a photo (has a
    truthy `.photo` attribute) and routes to `editMessageCaption`;
    otherwise falls back to `editMessageText`. Keeps everything in one
    Telegram bubble — no fresh `sendMessage` follow-up.

    `message` is duck-typed: anything with `.chat.id`, `.message_id`,
    and optionally `.photo` works (aiogram `types.Message` does).
    """
    chat_id = message.chat.id
    message_id = message.message_id
    if getattr(message, "photo", None):
        return await edit_message_caption(
            chat_id, message_id, text, reply_markup=reply_markup, parse_mode=parse_mode,
        )
    return await edit_message_text(
        chat_id, message_id, text, reply_markup=reply_markup, parse_mode=parse_mode,
    )


async def delete_message(chat_id: int, message_id: int) -> bool:
    """Best-effort `deleteMessage`. Returns True on success, False on any
    error (message too old, no permission, etc). Used by typed-input flows
    to clean up the user's input after the bot has already edited the
    prompt with the result — keeps the chat to a single bubble.
    """
    try:
        await _api("deleteMessage", {"chat_id": chat_id, "message_id": message_id})
        return True
    except Exception as e:  # noqa: BLE001
        log.debug("deleteMessage failed: %s", e)
        return False


async def answer_callback_query(
    callback_query_id: str,
    text: str | None = None,
    *,
    show_alert: bool = False,
) -> None:
    payload: dict[str, Any] = {"callback_query_id": callback_query_id}
    if text is not None:
        payload["text"] = text
    if show_alert:
        payload["show_alert"] = True
    await _api("answerCallbackQuery", payload)


# ---------------------------------------------------------------------------
# Multi-part upload (sendPhoto with local file) — used for QR codes.
# ---------------------------------------------------------------------------


async def send_photo_file(
    chat_id: int,
    file_bytes: bytes,
    filename: str,
    *,
    caption: str | None = None,
    reply_markup: dict | None = None,
    parse_mode: str | None = "HTML",
) -> dict:
    cfg = get_config()
    url = f"https://api.telegram.org/bot{cfg.bot_token}/sendPhoto"
    form = aiohttp.FormData()
    form.add_field("chat_id", str(chat_id))
    form.add_field("photo", file_bytes, filename=filename, content_type="image/png")
    if caption is not None:
        form.add_field("caption", _maybe_wrap(caption, parse_mode) or caption)
    if parse_mode:
        form.add_field("parse_mode", parse_mode)
    if reply_markup is not None:
        import json
        form.add_field("reply_markup", json.dumps(reply_markup))
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as s:
        async with s.post(url, data=form) as r:
            data = await r.json()
            if not data.get("ok"):
                raise RuntimeError(f"sendPhoto failed: {data}")
            return data.get("result", {})


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def fmt_days_left(end_date) -> str:
    """Human-readable 'осталось N дней' from a datetime.

    Uses `math.ceil` (round UP) so the chat bot matches the Mini App,
    which derives `daysLeft` via `CEIL(EXTRACT(EPOCH FROM (end_date -
    NOW())) / 86400)::int` in `app/api/users/state/route.ts`. Pre-fix
    the chat bot used `delta.days` (floor) and showed `10 дней` for the
    same row the Mini App rendered as `11 дней` — user reported
    `в чатботе отображается осталось 10 дней в мини апп 11 дней` on
    2026-05-07. Both surfaces now agree.
    """
    from datetime import datetime, timezone
    import math

    if end_date is None:
        return "—"
    now = datetime.now(timezone.utc)
    if end_date.tzinfo is None:
        end_date = end_date.replace(tzinfo=timezone.utc)
    total_seconds = (end_date - now).total_seconds()
    if total_seconds <= 0:
        return "истекла"
    if total_seconds < 86400:
        # Sub-day remainder — show hours instead of "1 день" so a user
        # whose sub expires in 4 hours doesn't get a "осталось 1 день"
        # stale-looking line. Mini App caps `daysLeft` at 0 here too.
        hours = max(1, int(total_seconds // 3600))
        return f"осталось {hours} ч."
    days = math.ceil(total_seconds / 86400)
    if days == 1:
        return "остался 1 день"
    if 2 <= days <= 4:
        return f"осталось {days} дня"
    return f"осталось {days} дней"


def fmt_price_rub(price_rub) -> str:
    if price_rub is None:
        return "—"
    return f"{int(price_rub)} ₽"


def fmt_duration(days: int) -> str:
    """Convert plan duration to a short label like '1 мес', '12 мес'."""
    if days % 365 == 0:
        years = days // 365
        return f"{years} {'год' if years == 1 else 'года' if 2 <= years <= 4 else 'лет'}"
    months = round(days / 30)
    if months == 1:
        return "1 месяц"
    if 2 <= months <= 4:
        return f"{months} месяца"
    return f"{months} месяцев"
