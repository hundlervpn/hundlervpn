"""'Устройства' — list active devices + remove buttons.

Mirrors the Mini App devices modal:
    - shows up to `plan.max_devices` rows (rank-capped),
    - each row: name, "last seen" delta, ❌ remove button,
    - removing calls DELETE /api/users/devices which also fires
      triggerXraySync('wait') on the server, so the kicked device drops
      within ~1 second.

Callback data:
    devices:list             — show panel
    devices:rm:<deviceId>    — remove and refresh panel
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from aiogram import Router, types

import api_client
import db
import ui

log = logging.getLogger(__name__)

router = Router(name="devices")

# Animated phone icon for body-text headers in the devices panel — same
# `window-variant` ID the main-menu "📱 Устройства" button uses, so the
# header icon matches the button the user just tapped. We don't add
# 📱 to `EMOJI_TO_ID` globally because help.py uses 📱 for iOS
# install instructions where a window emoji would be wrong.
_PHONES_EMOJI = '<tg-emoji emoji-id="6033070647213560346">📱</tg-emoji>'


def _fmt_last_seen(last_seen) -> str:
    if last_seen is None:
        return "никогда"
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - last_seen
    secs = int(delta.total_seconds())
    if secs < 60:
        return "только что"
    if secs < 3600:
        return f"{secs // 60} мин. назад"
    if secs < 86400:
        return f"{secs // 3600} ч. назад"
    return f"{secs // 86400} дн. назад"


def _device_label(d: dict) -> str:
    raw = (d.get("device_name") or "").strip()
    return raw if raw else f"Устройство #{d['id']}"


@router.callback_query(lambda cq: cq.data == "devices:list")
async def cb_devices_list(callback: types.CallbackQuery) -> None:
    if not callback.message or not callback.from_user:
        await ui.answer_callback_query(callback.id)
        return
    await _render_panel(callback)
    await ui.answer_callback_query(callback.id)


async def _render_panel(callback: types.CallbackQuery) -> None:
    """Render the devices panel for the given callback's user.

    Extracted helper so devices:rm can re-render after a delete without
    double-answering the callback query (Telegram disallows that).
    """
    if not callback.message or not callback.from_user:
        return
    tid = callback.from_user.id
    try:
        user = await asyncio.to_thread(db.get_user_by_telegram_id, tid)
        if not user:
            await _show_empty(callback, has_sub=False)
            return
        max_devices = await asyncio.to_thread(db.get_max_devices, user["id"])
        sub = await asyncio.to_thread(db.get_active_subscription, user["id"])
        devices = await asyncio.to_thread(db.list_devices, user["id"], max_devices)
    except Exception as e:  # noqa: BLE001
        log.exception("devices panel DB error: %s", e)
        await ui.smart_edit(
            callback.message,
            "⚠️  Не удалось получить список устройств. Попробуйте позже.",
            reply_markup=ui.keyboard([ui.btn("⬅️  Назад в меню", callback="menu:home", icon="back")]),
        )
        return

    if not sub:
        await _show_empty(callback, has_sub=False)
        return

    if not devices:
        await _show_empty(callback, has_sub=True, max_devices=max_devices)
        return

    lines = [
        f"{_PHONES_EMOJI}  <b>Ваши устройства</b>",
        "",
        f"Подключено: <b>{len(devices)} / {max_devices}</b>",
        "",
    ]
    rows: list[list] = []
    for d in devices:
        label = _device_label(d)
        seen = _fmt_last_seen(d.get("last_seen_at"))
        lines.append(f"•  <b>{_html_escape(label)}</b> — {seen}")
        rows.append([
            ui.btn(
                f"❌  Удалить «{_truncate(label, 24)}»",
                callback=f"devices:rm:{d['id']}",
                style="danger",
                icon="remove",
            )
        ])

    rows.append([ui.btn("🔄  Обновить", callback="devices:list", style="primary", icon="refresh")])
    rows.append([ui.btn("⬅️  В меню", callback="menu:home", icon="back")])

    await ui.smart_edit(callback.message, "\n".join(lines), reply_markup=ui.keyboard(*rows))


@router.callback_query(lambda cq: (cq.data or "").startswith("devices:rm:"))
async def cb_device_remove(callback: types.CallbackQuery) -> None:
    if not callback.message or not callback.from_user or not callback.data:
        await ui.answer_callback_query(callback.id)
        return
    try:
        device_id = int(callback.data.rsplit(":", 1)[-1])
    except ValueError:
        await ui.answer_callback_query(callback.id, "Некорректный id")
        return

    tid = callback.from_user.id
    try:
        await api_client.delete_device(telegram_id=tid, device_id=device_id)
    except api_client.ApiError as e:
        log.warning("devices:rm api error: %s", e)
        await ui.answer_callback_query(callback.id, f"Не удалось удалить: {e}", show_alert=True)
        return
    except Exception as e:  # noqa: BLE001
        log.exception("devices:rm unexpected: %s", e)
        await ui.answer_callback_query(callback.id, "Ошибка сети", show_alert=True)
        return

    await ui.answer_callback_query(callback.id, "Устройство удалено ✓")
    # Re-render the panel so the removed device disappears.
    await _render_panel(callback)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


async def _show_empty(callback: types.CallbackQuery, *, has_sub: bool,
                      max_devices: int = 3) -> None:
    if not has_sub:
        text = (
            f"{_PHONES_EMOJI}  <b>Устройства</b>\n\n"
            "У вас пока нет активной подписки — оформите её, и подключите "
            "до 3 устройств одновременно."
        )
        kb = ui.keyboard(
            [ui.btn("💳  Купить VPN", callback="plans:list", style="danger", icon="card")],
            [ui.btn("⬅️  В меню", callback="menu:home", icon="back")],
        )
    else:
        text = (
            f"{_PHONES_EMOJI}  <b>Устройства</b>\n\n"
            f"Лимит вашего тарифа: <b>{max_devices}</b>.\n\n"
            "Подключённых устройств пока нет. Импортируйте подписку в "
            "VPN-клиент — устройство появится здесь после первого подключения."
        )
        kb = ui.keyboard(
            [ui.btn("❓  Как подключить", callback="help:install", style="primary", icon="question")],
            [ui.btn("🔑  Моя подписка", callback="sub:show", style="danger", icon="key")],
            [ui.btn("⬅️  В меню", callback="menu:home", icon="back")],
        )
    await ui.smart_edit(callback.message, text, reply_markup=kb)


def _html_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )


def _truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"
