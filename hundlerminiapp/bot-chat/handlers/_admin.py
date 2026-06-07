"""Admin-only handlers — currently only the emoji-id discovery flow.

The handler accepts ANY message (or caption) from a user listed in
`ADMIN_TELEGRAM_IDS` env var and, if that message contains animated
custom emojis, replies with one line per emoji:

    <emoji>  →  <code>5170734948596768593</code>

Use this to harvest the IDs you need to populate `emoji_icons.ICONS`.

Why a function-filter instead of an aiogram magic_filter:
    - We need access to the runtime `Config.admin_telegram_ids` set
      which can change between deploys; a closure-based callable works
      cleanly.
    - We also need to inspect both `entities` AND `caption_entities`
      with a short-circuit "is admin" check first (cheaper than a
      magic_filter chain).

Registration order: this router MUST be registered LAST in main.py so
all the application-level routers (start, sub, buy, promo, devices,
referral, help) get first dibs on every message. Admin handler then
runs only on messages that none of the above claimed.
"""
from __future__ import annotations

import logging

from aiogram import Router, types

import ui
from config import get_config

log = logging.getLogger(__name__)

router = Router(name="_admin")


def _is_admin(message: types.Message) -> bool:
    cfg = get_config()
    if not cfg.admin_telegram_ids:
        return False
    if not message.from_user:
        return False
    return message.from_user.id in cfg.admin_telegram_ids


def _collect_custom_emojis(message: types.Message) -> list[tuple[str, str]]:
    """Return [(emoji_char, custom_emoji_id), ...] from message + caption.

    Empty list = no custom emojis found.
    """
    text = message.text or message.caption or ""
    entities = list(message.entities or []) + list(message.caption_entities or [])
    out: list[tuple[str, str]] = []
    seen: set[str] = set()  # de-dup by emoji-id within one message
    for e in entities:
        if e.type != "custom_emoji" or not e.custom_emoji_id:
            continue
        if e.custom_emoji_id in seen:
            continue
        seen.add(e.custom_emoji_id)
        # text indices in Telegram are UTF-16 code units; Python's str
        # is UTF-32 code points, so for emojis composed of surrogate
        # pairs (like most animated emojis) the slice may include extra
        # code points. The exact emoji char is best-effort here.
        char = text[e.offset : e.offset + e.length] or "?"
        out.append((char, e.custom_emoji_id))
    return out


async def _is_admin_with_custom_emoji(message: types.Message) -> bool:
    """Combined filter — admin AND has at least one custom_emoji entity."""
    return _is_admin(message) and bool(_collect_custom_emojis(message))


@router.message(_is_admin_with_custom_emoji)
async def emoji_id_discovery(message: types.Message) -> None:
    """Reply with the custom_emoji_id list extracted from the message."""
    pairs = _collect_custom_emojis(message)
    if not pairs:
        return  # belt-and-braces; the filter already guards this

    lines = ["<b>\ud83c\udfa8 Custom emoji IDs:</b>", ""]
    for char, emoji_id in pairs:
        lines.append(f"{char}  \u2192  <code>{emoji_id}</code>")
    lines.append("")
    lines.append(
        "\u270f\ufe0f Plug the IDs you want into "
        "<code>bot-chat/emoji_icons.py</code> (key is documented above each "
        "slot), commit, then <code>systemctl restart hundlervpn-bot-chat</code>."
    )

    try:
        await ui.send_message(message.chat.id, "\n".join(lines))
    except Exception as e:  # noqa: BLE001
        log.warning("emoji-discovery reply failed: %s", e)
