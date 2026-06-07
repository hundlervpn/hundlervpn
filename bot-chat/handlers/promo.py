"""Promo code flow.

UX:
    [user clicks 🎁 Промокод]
    bot → "Пришлите промокод одним сообщением:"
    [user sends "FREE7"]
    bot → calls /api/promos/apply → shows result (days granted / discount).

State is FSM-managed (aiogram's MemoryStorage). Any non-/cancel text inside
the state is treated as the code; we strip + uppercase before sending so
"  free7  " and "FREE7" both work.
"""
from __future__ import annotations

import asyncio
import logging

from aiogram import F, Router, types
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

import api_client
import db
import sub_token
import ui

log = logging.getLogger(__name__)

router = Router(name="promo")


class PromoStates(StatesGroup):
    waiting_code = State()


def _back_kb() -> dict:
    return ui.keyboard([ui.btn("⬅️  Назад в меню", callback="menu:home", icon="back")])


def _success_kb() -> dict:
    return ui.keyboard(
        [ui.btn("🔑  Моя подписка", callback="sub:show", style="danger", icon="key")],
        [ui.btn("❓  Как подключить", callback="help:install", style="primary", icon="question")],
        [ui.btn("⬅️  В меню", callback="menu:home", icon="back")],
    )


@router.callback_query(lambda cq: cq.data == "promo:enter")
async def cb_promo_enter(callback: types.CallbackQuery, state: FSMContext) -> None:
    """Show the prompt and stash its (chat_id, message_id, is_photo) in
    FSM data so the typed-input handler can edit-in-place when the user
    sends their code."""
    if not callback.message:
        await ui.answer_callback_query(callback.id)
        return
    text = (
        "🎁  <b>Промокод</b>\n\n"
        "Пришлите код одним сообщением — например, <code>FREE7</code>.\n\n"
        "Активирую сразу же. Промокоды, дающие дни, продлят вашу подписку. "
        "Скидочные промокоды можно применить при следующей оплате.\n\n"
        "Чтобы выйти — /cancel."
    )
    try:
        await ui.smart_edit(callback.message, text, reply_markup=_back_kb())
    except RuntimeError as e:
        log.info("promo:enter edit failed: %s", e)
    await state.set_state(PromoStates.waiting_code)
    await state.update_data(
        prompt_chat_id=callback.message.chat.id,
        prompt_message_id=callback.message.message_id,
        prompt_is_photo=bool(getattr(callback.message, "photo", None)),
    )
    await ui.answer_callback_query(callback.id)


async def _edit_prompt(state: FSMContext, text: str, kb: dict | None) -> bool:
    """Edit the saved prompt message (set in cb_promo_enter) with new
    text + keyboard. Returns False if no prompt was stashed (state lost
    e.g. after a bot restart).
    """
    data = await state.get_data()
    chat_id = data.get("prompt_chat_id")
    msg_id = data.get("prompt_message_id")
    is_photo = data.get("prompt_is_photo")
    if not chat_id or not msg_id:
        return False
    try:
        if is_photo:
            await ui.edit_message_caption(chat_id, msg_id, text, reply_markup=kb)
        else:
            await ui.edit_message_text(chat_id, msg_id, text, reply_markup=kb)
    except RuntimeError as e:
        log.info("promo prompt edit failed: %s", e)
        return False
    return True


@router.message(Command("cancel"), PromoStates.waiting_code)
async def cmd_cancel_promo(message: types.Message, state: FSMContext) -> None:
    """Edit the prompt back to a friendly cancel state and remove the
    user's typed `/cancel` so the chat stays clean."""
    await _edit_prompt(state, "Хорошо, ввод промокода отменён.", _back_kb())
    await state.clear()
    await ui.delete_message(message.chat.id, message.message_id)


@router.message(PromoStates.waiting_code, F.text)
async def on_promo_text(message: types.Message, state: FSMContext) -> None:
    if not message.from_user or not message.text:
        return

    code = message.text.strip()
    if not code or code.startswith("/"):
        # ignore stray commands; /cancel is handled above.
        return

    # Always remove the user's typed code in private chats so the chat
    # bubble count never grows past the original /start photo.
    await ui.delete_message(message.chat.id, message.message_id)

    if len(code) > 32 or " " in code:
        await _edit_prompt(
            state,
            "❌  Похоже на не-промокод. Промокод — короткое слово без пробелов.\n\n"
            "Попробуйте ещё раз или /cancel.",
            _back_kb(),
        )
        return  # stay in state — let the user try another code

    tid = message.from_user.id
    try:
        resp = await api_client.apply_promo(
            telegram_id=tid,
            code=code,
            username=message.from_user.username,
            first_name=message.from_user.first_name,
            last_name=message.from_user.last_name,
        )
    except api_client.ApiError as e:
        await _edit_prompt(
            state,
            f"❌  <b>Промокод не сработал.</b>\n\nПричина: {_html_escape(str(e))}",
            _back_kb(),
        )
        await state.clear()
        return
    except Exception as e:  # noqa: BLE001
        log.exception("apply_promo unexpected: %s", e)
        await _edit_prompt(
            state,
            "⚠️  <b>Не удалось применить промокод.</b>\n\nПопробуйте позже.",
            _back_kb(),
        )
        await state.clear()
        return

    promo_type = resp.get("type")
    promo_code = resp.get("promoCode") or code.upper()

    if promo_type == "discount":
        pct = resp.get("discountPercent") or 0
        text = (
            f"✅  <b>Промокод {_html_escape(promo_code)} принят!</b>\n\n"
            f"Скидка <b>{pct}%</b> на следующую оплату активирована — "
            f"откройте «💳 Купить VPN», и она применится автоматически."
        )
        kb = ui.keyboard(
            [ui.btn("💳  Купить VPN", callback="plans:list", style="danger", icon="card")],
            [ui.btn("⬅️  В меню", callback="menu:home", icon="back")],
        )
        await _edit_prompt(state, text, kb)
        await state.clear()
        return

    # type == "days" (or unknown but with days/endDate)
    days = resp.get("days") or 0
    sub_url = sub_token.get_subscription_url(tid) or resp.get("subscriptionUrl")

    text = (
        f"🎉  <b>Промокод {_html_escape(promo_code)} активирован!</b>\n\n"
        f"📦  Начислено: <b>{days} {_word_days(days)}</b>\n"
    )
    if sub_url:
        text += (
            "\n🔗  Ссылка для подключения:\n"
            f"<code>{_html_escape(sub_url)}</code>\n\n"
            "Скопируйте её и импортируйте в свой VPN-клиент. Не знаете как — "
            "нажмите «Как подключить» ниже."
        )
    await _edit_prompt(state, text, _success_kb())
    await state.clear()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _word_days(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return "день"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return "дня"
    return "дней"


def _html_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
