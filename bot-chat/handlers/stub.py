"""Last-resort fallback for callback queries that no concrete handler claimed.

After the routers in main.py are all wired up there should be no
unhandled prefixes. This catches typos in callback_data (e.g. left over
from refactors) so the user gets a friendly nudge instead of a silently-
ignored button.
"""
from __future__ import annotations

import logging

from aiogram import Router, types

import ui

log = logging.getLogger(__name__)

router = Router(name="stubs")


@router.callback_query(lambda cq: bool(cq.data))
async def cb_unknown(callback: types.CallbackQuery) -> None:
    log.warning("Unhandled callback_data: %r (user=%s)",
                callback.data, callback.from_user.id if callback.from_user else None)
    await ui.answer_callback_query(callback.id, "Команда устарела — обновите меню /start")
