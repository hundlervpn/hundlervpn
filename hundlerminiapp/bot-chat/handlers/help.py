"""'Как подключить' — OS + client install instructions.

Mirrors the Mini App's setup flow (`app/page.tsx#getStoreLink()`):
the only supported clients are **Happ** (recommended) and **v2RayTun**.
Streisand and Hiddify are NOT offered — keep the bot in lockstep with
the in-app picker so users get the same experience everywhere.

Flow:
    [user clicks ❓ Как подключить]
    bot → "Выбери ОС:" (iOS / Android / Windows / macOS)
    [user picks an OS]
    bot → "Выбери клиент:" (Happ / v2RayTun)
    [user picks a client]
    bot → install steps + sub URL + 📋 Скопировать ссылку + ⬇ Скачать
          (+ App Store region toggle for Happ on iOS/macOS — matches the
           Mini App's russia/global picker that swaps between
           `app/happ-proxy-utility-plus` (RU) and `happ-proxy-utility` (US))

No QR code on this screen — the user copies the subscription link via
Bot API 9.4 `copy_text` button and pastes it into their VPN client.
"""
from __future__ import annotations

import logging

from aiogram import Router, types

import sub_token
import ui

log = logging.getLogger(__name__)

router = Router(name="help")


# ---------------------------------------------------------------------------
# Catalogue (kept in sync with `app/page.tsx#getStoreLink()`)
# ---------------------------------------------------------------------------

OS_INFO: dict[str, dict] = {
    "ios":     {"title": "📱  iPhone / iPad", "label": "iOS"},
    "android": {"title": "🤖  Android",        "label": "Android"},
    "windows": {"title": "💻  Windows",        "label": "Windows"},
    "macos":   {"title": "🍎  macOS",          "label": "macOS"},
}

CLIENT_HAPP = "happ"
CLIENT_V2RAYTUN = "v2raytun"

# iOS/macOS Happ comes in two App Store flavours (RU vs the rest of the
# world). Mirrors the Mini App's `setupRegion` toggle.
HAPP_IOS_RU     = "https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973"
HAPP_IOS_GLOBAL = "https://apps.apple.com/us/app/happ-proxy-utility/id6504287215"

CLIENT_INFO: dict[str, dict] = {
    CLIENT_HAPP: {
        "title": "Happ",
        # Per-OS download URL. iOS/macOS resolved at runtime via region.
        "store": {
            "android": "https://play.google.com/store/apps/details?id=com.happproxy&pli=1",
            "windows": "https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe",
            # iOS/macOS handled in _get_store
        },
        "store_label": {
            "ios":     "App Store",
            "android": "Google Play",
            "windows": "Скачать .exe",
            "macos":   "App Store",
        },
        "import_step": "➕ → <b>Добавить из буфера обмена</b>",
    },
    CLIENT_V2RAYTUN: {
        "title": "v2RayTun",
        "store": {
            "ios":     "https://apps.apple.com/us/app/v2raytun/id6476628951",
            "android": "https://play.google.com/store/apps/details?id=com.v2raytun.android",
            "windows": "https://storage.v2raytun.com/v2RayTun_Setup.exe",
            "macos":   "https://apps.apple.com/us/app/v2raytun/id6476628951",
        },
        "store_label": {
            "ios":     "App Store",
            "android": "Google Play",
            "windows": "Скачать .exe",
            "macos":   "App Store",
        },
        "import_step": "➕ в правом верхнем углу → <b>Импорт из буфера</b>",
    },
}


def _get_store(client: str, os_key: str, region: str) -> tuple[str | None, str]:
    """Return (download_url, button_label).

    `region` (`russia` | `global`) only matters for Happ on iOS/macOS — for
    every other (client, OS) pair it's ignored and the static URL wins.
    """
    info = CLIENT_INFO[client]
    label = info["store_label"].get(os_key, "")
    if client == CLIENT_HAPP and os_key in ("ios", "macos"):
        return (HAPP_IOS_RU if region == "russia" else HAPP_IOS_GLOBAL), label
    return info["store"].get(os_key), label


# ---------------------------------------------------------------------------
# Keyboards
# ---------------------------------------------------------------------------


def _os_picker_kb() -> dict:
    return ui.keyboard(
        [
            ui.btn("📱  iOS", callback="help:os:ios", style="primary", icon="ios"),
            ui.btn("🤖  Android", callback="help:os:android", style="success", icon="android"),
        ],
        [
            ui.btn("💻  Windows", callback="help:os:windows", style="danger", icon="windows"),
            ui.btn("🍎  macOS", callback="help:os:macos", style="primary", icon="apple"),
        ],
        [ui.btn("⬅️  В меню", callback="menu:home", icon="back")],
    )


def _client_picker_kb(os_key: str) -> dict:
    # No leading emoji on either button — the `phones` custom-emoji icon
    # already renders a phone glyph on Premium clients, so a second
    # static emoji in the text would double-up. Happ is flagged as the
    # default via the `(рекомендуем)` suffix + the brand-red `danger`
    # style, no star needed (the user asked to drop ⭐ on 2026-05-07).
    return ui.keyboard(
        [ui.btn("Happ  (рекомендуем)", callback=f"help:c:{os_key}:happ:russia", style="danger", icon="phones")],
        [ui.btn("v2RayTun", callback=f"help:c:{os_key}:v2raytun:global", style="primary", icon="phones")],
        [
            ui.btn("⬅️  Другая ОС", callback="help:install", icon="back"),
            ui.btn("🏠  Меню", callback="menu:home", icon="home"),
        ],
    )


def _instructions_kb(
    os_key: str,
    client: str,
    region: str,
    store_url: str | None,
    store_label: str,
    sub_url: str,
) -> dict:
    rows: list[list[dict]] = []
    if store_url:
        rows.append([ui.btn(f"⬇️  {store_label}", url=store_url, style="success", icon="download")])
    rows.append([ui.btn("📋  Скопировать ссылку", copy_text=sub_url, style="danger", icon="copy")])
    # App Store region toggle — only meaningful for Happ on iOS/macOS.
    if client == CLIENT_HAPP and os_key in ("ios", "macos"):
        if region == "russia":
            rows.append([ui.btn("🌍  Версия App Store (вне РФ)", callback=f"help:c:{os_key}:happ:global", icon="phones")])
        else:
            rows.append([ui.btn("🇷🇺  Версия App Store (РФ)", callback=f"help:c:{os_key}:happ:russia", icon="phones")])
    rows.append([
        ui.btn("⬅️  Другой клиент", callback=f"help:os:{os_key}", icon="back"),
        ui.btn("🏠  Меню", callback="menu:home", icon="home"),
    ])
    return ui.keyboard(*rows)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


@router.callback_query(lambda cq: cq.data == "help:install")
async def cb_help_install(callback: types.CallbackQuery) -> None:
    if not callback.message:
        await ui.answer_callback_query(callback.id)
        return
    text = (
        "❓  <b>Как подключить</b>\n\n"
        "Выбери операционную систему — пришлю инструкцию и ссылку для импорта в клиент:"
    )
    await ui.smart_edit(callback.message, text, reply_markup=_os_picker_kb())
    await ui.answer_callback_query(callback.id)


@router.callback_query(lambda cq: (cq.data or "").startswith("help:os:"))
async def cb_help_os(callback: types.CallbackQuery) -> None:
    if not callback.message or not callback.data:
        await ui.answer_callback_query(callback.id)
        return
    os_key = callback.data.rsplit(":", 1)[-1]
    info = OS_INFO.get(os_key)
    if not info:
        await ui.answer_callback_query(callback.id, "Неизвестная ОС")
        return
    text = (
        f"{info['title']}\n\n"
        "Выбери клиент:\n"
        "• <b>Happ</b> — основной, рекомендуем по умолчанию.\n"
        "• <b>v2RayTun</b> — на случай, если Happ не подойдёт."
    )
    await ui.smart_edit(callback.message, text, reply_markup=_client_picker_kb(os_key))
    await ui.answer_callback_query(callback.id)


@router.callback_query(lambda cq: (cq.data or "").startswith("help:c:"))
async def cb_help_client(callback: types.CallbackQuery) -> None:
    if not callback.message or not callback.from_user or not callback.data:
        await ui.answer_callback_query(callback.id)
        return

    # callback_data shape: help:c:<os>:<client>:<region>
    parts = callback.data.split(":")
    if len(parts) != 5:
        await ui.answer_callback_query(callback.id, "Bad request")
        return
    _, _, os_key, client, region = parts
    if os_key not in OS_INFO or client not in CLIENT_INFO:
        await ui.answer_callback_query(callback.id, "Неизвестная комбинация")
        return

    tid = callback.from_user.id
    sub_url = sub_token.get_subscription_url(tid)

    if not sub_url:
        await ui.smart_edit(
            callback.message,
            "⚠️  Ссылка подписки временно недоступна (XRAY_SYNC_TOKEN не настроен).",
            reply_markup=ui.keyboard([ui.btn("⬅️  Назад", callback="help:install", icon="back")]),
        )
        await ui.answer_callback_query(callback.id)
        return

    store_url, store_label = _get_store(client, os_key, region)
    info = CLIENT_INFO[client]
    os_info = OS_INFO[os_key]

    install_line = (
        f"1.  Установи <b>{info['title']}</b>"
        + (f" ({store_label})." if store_label else ".")
    )
    steps = "\n".join([
        install_line,
        "2.  Нажми «📋  Скопировать ссылку» под этим сообщением.",
        f"3.  Открой {info['title']} → {info['import_step']}.",
        "4.  Включи туннель.",
    ])

    text = (
        f"{os_info['title']} · <b>{info['title']}</b>\n\n"
        f"<b>Шаги:</b>\n{steps}\n\n"
        "🔗  <b>Ссылка подписки:</b>\n"
        f"<code>{_html_escape(sub_url)}</code>"
    )

    kb = _instructions_kb(os_key, client, region, store_url, store_label, sub_url)
    await ui.smart_edit(callback.message, text, reply_markup=kb)
    await ui.answer_callback_query(callback.id)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _html_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
