"""'Моя подписка' panel — sub:show callback.

Pulls the user's active subscription row (if any) from the DB and shows
either:
    - active panel: plan name, days left, end date, sub URL CTA;
    - empty panel: "у вас нет активной подписки" + buy CTA.

The sub URL is the SAME canonical link the Mini App shows — fetched from
`/api/users/state` (the Remnawave panel-direct URL for the default backend,
matching what the panel itself serves). We fall back to the locally-built
`sub_token.get_subscription_url` legacy proxy link only if that call fails,
and hide the button if neither yields a URL (rare — misconfigured deploy).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

try:
    # Python 3.9+ — IANA timezone DB. We use it instead of a hard-coded
    # `+timedelta(hours=3)` so DST switches and Postgres-side TZ settings
    # don't double-shift the displayed date (incident 2026-05-07: chat
    # bot showed `18.05.2026` for a sub Mini App + main-bot notification
    # both displayed as `17.05.2026` because psycopg2 was already
    # returning MSK-aware datetimes and the +3h pushed past midnight).
    from zoneinfo import ZoneInfo
    _MSK = ZoneInfo("Europe/Moscow")
except Exception:  # pragma: no cover — only if zoneinfo is missing
    _MSK = timezone.utc

from aiogram import Router, types

import api_client
import db
import sub_token
import ui

log = logging.getLogger(__name__)

router = Router(name="subscription")


def _back_kb_active(sub_url: str | None) -> dict:
    rows = []
    if sub_url:
        rows.append([ui.btn("📋  Скопировать ссылку", copy_text=sub_url, style="success", icon="copy")])
    rows.append([ui.btn("❓  Как подключить", callback="help:install", style="primary", icon="question")])
    rows.append([
        ui.btn("📱  Устройства", callback="devices:list", style="primary", icon="phones"),
        ui.btn("➕  Продлить", callback="plans:list", style="danger", icon="plus"),
    ])
    rows.append([ui.btn("⬅️  Назад в меню", callback="menu:home", icon="back")])
    return ui.keyboard(*rows)


def _back_kb_empty() -> dict:
    return ui.keyboard(
        [ui.btn("💳  Купить VPN", callback="plans:list", style="danger", icon="card")],
        [ui.btn("🎁  У меня есть промокод", callback="promo:enter", style="success", icon="gift")],
        [ui.btn("⬅️  Назад в меню", callback="menu:home", icon="back")],
    )


def _fmt_end_date(end_date: datetime | None) -> str:
    """Format a subscription end date for display, in Moscow time.

    Uses `astimezone(Europe/Moscow)` so the result matches whatever the
    Mini App's `toLocaleDateString('ru-RU')` produces for an MSK browser
    AND whatever `lib/sbp-confirm.ts` sends in the Telegram payment
    notification — all three surfaces should always agree on the date.

    Naive UTC datetimes are tagged as UTC first; aware datetimes (the
    common case from psycopg2 on a TIMESTAMPTZ column) are converted
    cleanly with no double-shift.
    """
    if end_date is None:
        return "—"
    if end_date.tzinfo is None:
        end_date = end_date.replace(tzinfo=timezone.utc)
    msk = end_date.astimezone(_MSK)
    return msk.strftime("%d.%m.%Y, %H:%M")


@router.callback_query(lambda cq: cq.data == "sub:show")
async def cb_sub_show(callback: types.CallbackQuery) -> None:
    if not callback.message or not callback.from_user:
        await ui.answer_callback_query(callback.id)
        return

    tid = callback.from_user.id

    try:
        user = await asyncio.to_thread(db.get_user_by_telegram_id, tid)
        sub = (
            await asyncio.to_thread(db.get_active_subscription, user["id"])
            if user
            else None
        )
    except Exception as e:  # noqa: BLE001
        log.exception("sub:show DB error: %s", e)
        await ui.smart_edit(
            callback.message,
            "⚠️  <b>Не удалось получить данные подписки.</b>\n\nПопробуйте ещё раз через минуту.",
            reply_markup=ui.keyboard([ui.btn("⬅️  Назад в меню", callback="menu:home", icon="back")]),
        )
        await ui.answer_callback_query(callback.id)
        return

    # Manually wrap 🔑 and 📱 in `<tg-emoji>` so Premium clients render the
    # SAME styled icons we use as button overrides (`key` → globe,
    # `phones` → window-variant). They're not in `EMOJI_TO_ID` because
    # the iOS pack doesn't ship a key/phone glyph and adding them
    # globally would also retag 📱 in `OS_INFO['ios']` (help.py) where a
    # window icon would be wrong. Inline tags here keep the change
    # scoped to this panel + the devices header.
    KEY_EMOJI = '<tg-emoji emoji-id="5776233299424843260">🔑</tg-emoji>'
    PHONES_EMOJI = '<tg-emoji emoji-id="6033070647213560346">📱</tg-emoji>'

    if not sub:
        text = (
            f"{KEY_EMOJI}  <b>Моя подписка</b>\n\n"
            "У вас пока нет активной подписки.\n\n"
            "Оформите её, чтобы получить доступ к серверам в "
            "🇳🇱 Нидерландах и 🇩🇪 Германии — до 3 устройств одновременно, "
            "безлимитный трафик."
        )
        await ui.smart_edit(callback.message, text, reply_markup=_back_kb_empty())
        await ui.answer_callback_query(callback.id)
        return

    sub_url = await api_client.fetch_subscription_url(telegram_id=tid) or sub_token.get_subscription_url(tid)
    days_left_text = ui.fmt_days_left(sub["end_date"])
    end_str = _fmt_end_date(sub["end_date"])
    max_devices = sub.get("max_devices") or 3

    # Plan name (e.g. `Premium 3d`) intentionally OMITTED — `subscriptions.
    # plan_name` is the original purchase label and stops reflecting reality
    # the moment a user tops up, applies a promo, or stacks plans. The user
    # said it best on 2026-05-07: «зачем писать тариф это же бред полный …
    # если я активирую промокод на один день у меня будет показываться
    # тариф 1day типо или что». The honest signal is `end_date` + days-left,
    # both of which are already shown.
    text = (
        f"{KEY_EMOJI}  <b>Моя подписка</b>\n\n"
        f"📅  Активна до: <b>{end_str}</b> (МСК)\n"
        f"⏳  {days_left_text}\n"
        f"{PHONES_EMOJI}  Устройств: до <b>{max_devices}</b> одновременно\n"
    )
    if sub_url:
        text += (
            "\n🔗  <b>Ссылка для импорта в VPN-клиент:</b>\n"
            f"<code>{_html_escape(sub_url)}</code>\n\n"
            "Нажмите «Скопировать ссылку» ниже, либо «Как подключить» — там пошаговая инструкция."
        )
    else:
        text += (
            "\n⚠️  Ссылка для подключения временно недоступна. Попробуйте позже "
            "или используйте Mini App."
        )

    await ui.smart_edit(callback.message, text, reply_markup=_back_kb_active(sub_url))
    await ui.answer_callback_query(callback.id)


def _html_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
