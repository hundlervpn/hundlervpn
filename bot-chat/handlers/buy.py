"""'Купить VPN' flow — preset days picker + SBP / crypto payment.

Mirrors the Mini App's PaymentView:
    - flat PRICE_PER_DAY model (7₽/day)
    - preset durations: 3, 7, 14, 30, 90, 180, 365 days
    - SBP (instant card) / crypto (OxaPay) — both endpoints accept
      `telegramId + days + amount` and return a URL to open in browser.

Callback data scheme:
    plans:list          → step 1: preset day picker
    buy:d:<N>           → step 2: chosen <N> days, show pay-method buttons
    buy:pay:<N>:sbp     → step 3a: create SBP transaction, send "Оплатить" URL
    buy:pay:<N>:crypto  → step 3b: create OxaPay invoice, send "Оплатить" URL
"""
from __future__ import annotations

import asyncio
import logging

from aiogram import Router, types

import api_client
import db
import ui

log = logging.getLogger(__name__)

router = Router(name="buy")

PRICE_PER_DAY = 7
PRESET_DAYS = [3, 7, 14, 30, 90, 180, 365]
DEFAULT_DAYS = 30


# ---------------------------------------------------------------------------
# Duration auto-discount tiers (mirrored verbatim from `lib/pricing.ts`).
#
#   6 months  (180 ≤ days < 365)  → 10 % off
#   1 year+   (days ≥ 365)        → 15 % off
#
# The Next.js back-end (/api/payments/sbp/create + /api/crypto-invoice)
# recomputes the price server-side from `days` + applicable promo
# discount_percent, so this Python copy is purely cosmetic — it just
# makes the inline-keyboard button labels show the right pre-discount
# numbers. If the server numbers ever drift from these, the user pays
# the SERVER-COMPUTED amount, not what the button promised. Keep the
# two in sync; the source of truth is `lib/pricing.ts`.
# ---------------------------------------------------------------------------


def _duration_discount_percent(days: int) -> int:
    if days >= 365:
        return 15
    if days >= 180:
        return 10
    return 0


def _fmt_days(d: int) -> str:
    if d == 1:
        return "1 день"
    if 2 <= d <= 4:
        return f"{d} дня"
    if d % 30 == 0 and d >= 30:
        m = d // 30
        if m == 1:
            return "1 месяц"
        if 2 <= m <= 4:
            return f"{m} месяца"
        if m == 12:
            return "1 год"
        return f"{m} месяцев"
    return f"{d} дней"


def _raw_amount_for(days: int) -> int:
    """Pre-discount subtotal — `days × PRICE_PER_DAY`."""
    return days * PRICE_PER_DAY


def _amount_for(days: int) -> int:
    """Final price after the auto-duration discount (no promo applied here).

    Promo codes apply on top of this server-side — the chat-bot doesn't
    expose a "enter promo code at checkout" flow today, so the button
    labels show duration-discounted price only.
    """
    pct = _duration_discount_percent(days)
    raw = _raw_amount_for(days)
    return round(raw * (100 - pct) / 100)


def _plans_kb() -> dict:
    rows: list[list] = []
    # 2 buttons per row for compact layout. All preset chips share the
    # same blue (primary) style and carry no icon — the user explicitly
    # asked to drop the ⭐ highlight on the 30-day default (2026-05-07),
    # so every plan now reads as a clean "<N> дн. — <price>₽" pill.
    #
    # 2026-05-08 update: long durations carry an automatic discount tag
    # ("180 дн. — 810₽ −10%", "365 дн. — 1551₽ −15%"). The discount is
    # applied to the displayed price already.
    chunk: list = []
    for d in PRESET_DAYS:
        pct = _duration_discount_percent(d)
        if pct > 0:
            label = f"{d} дн. — {_amount_for(d)}₽  −{pct}%"
        else:
            label = f"{d} дн. — {_amount_for(d)}₽"
        chunk.append(
            ui.btn(
                label,
                callback=f"buy:d:{d}",
                style="primary",
            )
        )
        if len(chunk) == 2:
            rows.append(chunk)
            chunk = []
    if chunk:
        rows.append(chunk)
    rows.append([ui.btn("⬅️  Назад в меню", callback="menu:home", icon="back")])
    return ui.keyboard(*rows)


def _pay_kb(days: int) -> dict:
    return ui.keyboard(
        [ui.btn("💳  Картой (СБП)", callback=f"buy:pay:{days}:sbp", style="danger", icon="card_pay")],
        [ui.btn("🪙  Криптой (USDT/TON/BTC)", callback=f"buy:pay:{days}:crypto", style="primary", icon="coin")],
        [ui.btn("⬅️  Другой период", callback="plans:list", icon="back")],
    )


@router.callback_query(lambda cq: cq.data == "plans:list")
async def cb_plans_list(callback: types.CallbackQuery) -> None:
    if not callback.message:
        await ui.answer_callback_query(callback.id)
        return
    text = (
        "💳  <b>Купить VPN</b>\n\n"
        f"Тариф: <b>{PRICE_PER_DAY}₽ за день</b>, до 3 устройств, безлимитный трафик.\n\n"
        "Выберите длительность:"
    )
    await ui.smart_edit(callback.message, text, reply_markup=_plans_kb())
    await ui.answer_callback_query(callback.id)


@router.callback_query(lambda cq: (cq.data or "").startswith("buy:d:"))
async def cb_buy_days(callback: types.CallbackQuery) -> None:
    if not callback.message or not callback.data:
        await ui.answer_callback_query(callback.id)
        return
    try:
        days = int(callback.data.rsplit(":", 1)[-1])
    except ValueError:
        await ui.answer_callback_query(callback.id, "Некорректный период")
        return
    if days not in PRESET_DAYS:
        await ui.answer_callback_query(callback.id, "Этот тариф не доступен")
        return

    amount = _amount_for(days)
    raw = _raw_amount_for(days)
    pct = _duration_discount_percent(days)

    if pct > 0:
        # Show the strike-through raw price + the discount line so the
        # user understands the saving instead of seeing only one number.
        cost_lines = (
            f"Стоимость: <s>{raw}₽</s> → <b>{amount}₽</b>\n"
            f"Скидка за длительность: <b>−{pct}%</b> (−{raw - amount}₽)"
        )
    else:
        cost_lines = (
            f"Стоимость: <b>{amount}₽</b>\n"
            f"({PRICE_PER_DAY}₽ × {days} дн.)"
        )

    text = (
        f"🛒  <b>{_fmt_days(days)}</b>\n\n"
        f"{cost_lines}\n\n"
        "Выберите способ оплаты:\n"
        "•  💳  <b>СБП</b> — мгновенно, российские карты\n"
        "•  🪙  <b>Криптой</b> — USDT, TON, BTC и др.\n\n"
        "После оплаты подписка активируется автоматически."
    )
    await ui.smart_edit(callback.message, text, reply_markup=_pay_kb(days))
    await ui.answer_callback_query(callback.id)


@router.callback_query(lambda cq: (cq.data or "").startswith("buy:pay:"))
async def cb_buy_pay(callback: types.CallbackQuery) -> None:
    if not callback.message or not callback.from_user or not callback.data:
        await ui.answer_callback_query(callback.id)
        return
    parts = callback.data.split(":")
    if len(parts) != 4:
        await ui.answer_callback_query(callback.id, "Некорректные параметры")
        return
    _, _, days_str, method = parts
    try:
        days = int(days_str)
    except ValueError:
        await ui.answer_callback_query(callback.id, "Некорректный период")
        return
    if method not in ("sbp", "crypto"):
        await ui.answer_callback_query(callback.id, "Неизвестный способ оплаты")
        return

    tid = callback.from_user.id
    amount = _amount_for(days)

    # Best-effort: ensure user row exists so /api/payments/* finds them.
    try:
        await asyncio.to_thread(
            db.get_or_create_user,
            tid,
            callback.from_user.username,
            callback.from_user.first_name,
            callback.from_user.last_name,
            callback.from_user.language_code,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("buy:pay user upsert failed: %s", e)

    # Show "creating…" right away so the user gets feedback while the API
    # provider is contacted (SBP can take 1-3s, OxaPay similar).
    await ui.answer_callback_query(callback.id, "Создаю счёт…")
    await ui.smart_edit(
        callback.message,
        f"⏳  Создаю счёт на <b>{amount}₽</b> за <b>{_fmt_days(days)}</b>…",
        reply_markup=ui.keyboard([ui.btn("⬅️  Отмена", callback="plans:list", icon="back")]),
    )

    try:
        if method == "sbp":
            resp = await api_client.create_sbp_payment(
                telegram_id=tid, days=days, amount_rub=amount,
            )
            url = resp.get("redirect")
            payment_id = resp.get("paymentId")
            method_label = "СБП"
        else:
            resp = await api_client.create_crypto_invoice(
                telegram_id=tid, days=days, amount_rub=amount,
            )
            url = resp.get("paymentUrl")
            payment_id = resp.get("paymentId")
            method_label = "Криптой"
    except api_client.ApiError as e:
        log.warning("buy:pay api error (%s): %s", method, e)
        await ui.smart_edit(
            callback.message,
            f"⚠️  <b>Не удалось создать счёт.</b>\n\nПричина: {_html_escape(str(e))}\n\nПопробуйте ещё раз или другим способом.",
            reply_markup=_pay_kb(days),
        )
        return
    except Exception as e:  # noqa: BLE001
        log.exception("buy:pay unexpected error (%s): %s", method, e)
        await ui.smart_edit(
            callback.message,
            "⚠️  <b>Не удалось создать счёт.</b>\n\nПопробуйте ещё раз через минуту.",
            reply_markup=_pay_kb(days),
        )
        return

    if not url:
        await ui.smart_edit(
            callback.message,
            "⚠️  <b>Платёжная система вернула пустую ссылку.</b>\n\nПопробуйте ещё раз.",
            reply_markup=_pay_kb(days),
        )
        return

    text = (
        f"✅  <b>Счёт создан</b>\n\n"
        f"💳  Способ: <b>{method_label}</b>\n"
        f"💰  Сумма: <b>{amount}₽</b> за <b>{_fmt_days(days)}</b>\n"
        f"🆔  №{payment_id}\n\n"
        "Нажмите «Оплатить» — откроется страница оплаты. После оплаты вернётесь "
        "сюда автоматически, подписка активируется в течение нескольких секунд."
    )
    kb = ui.keyboard(
        [ui.btn("💸  Оплатить", url=url, style="success", icon="money")],
        [ui.btn("🔁  Создать новый счёт", callback=f"buy:d:{days}", style="primary", icon="loop")],
        [ui.btn("⬅️  В меню", callback="menu:home", icon="back")],
    )
    await ui.smart_edit(callback.message, text, reply_markup=kb)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _html_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
