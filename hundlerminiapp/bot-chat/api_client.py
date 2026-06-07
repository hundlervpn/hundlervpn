"""Thin async client over the Next.js HTTP API.

Why HTTP and not direct DB writes:
    Payment & promo flows touch many tables (payments, subscriptions,
    vpn_keys, uuid_pool, promo_code_uses) and run inside `lib/access.ts`
    transactions. Re-implementing them in Python would duplicate ~1000
    lines of business logic and is a recipe for split-brain bugs.

    Instead the bot just calls the same endpoints the Mini App uses.
    The endpoints already accept `telegramId` in the JSON body, so no
    auth header is needed for the user-action paths used here.
"""
from __future__ import annotations

import logging
from typing import Any

import aiohttp

from config import get_config

log = logging.getLogger(__name__)


async def _post(path: str, body: dict[str, Any]) -> dict:
    """POST <APP_URL><path> as JSON, return parsed body."""
    cfg = get_config()
    url = f"{cfg.app_url}{path}"
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as s:
        async with s.post(url, json=body) as r:
            data = await r.json(content_type=None)
            if r.status >= 400:
                msg = (data or {}).get("error") if isinstance(data, dict) else None
                raise ApiError(msg or f"HTTP {r.status}", status=r.status, body=data)
            return data or {}


async def _delete(path: str) -> dict:
    cfg = get_config()
    url = f"{cfg.app_url}{path}"
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as s:
        async with s.delete(url) as r:
            data = await r.json(content_type=None)
            if r.status >= 400:
                msg = (data or {}).get("error") if isinstance(data, dict) else None
                raise ApiError(msg or f"HTTP {r.status}", status=r.status, body=data)
            return data or {}


class ApiError(Exception):
    """Raised when the Next.js API returns 4xx/5xx with an error body."""

    def __init__(self, message: str, *, status: int = 0, body: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


# ---------------------------------------------------------------------------
# Endpoints used by the bot.
# ---------------------------------------------------------------------------


async def sync_user(
    *,
    telegram_id: int,
    username: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    photo_url: str | None = None,
    start_param: str | None = None,
) -> dict:
    """POST /api/users/sync — register/upsert user, grant trial + referral bonus.

    This is the SAME endpoint the Mini App calls on launch, so calling
    it from the chat bot makes the two surfaces equivalent for new-user
    setup. Specifically the Next.js side will, INSIDE A SINGLE
    TRANSACTION:
      1. `upsertTelegramUser` — create the row (or refresh names).
      2. `issueTrialAccess` — grant the user a fresh 3-day trial
         subscription if they're brand-new OR `userNeedsInitialTrial`
         is true. THIS is the «+3 дня всем кто с тг заходит» the user
         flagged on 2026-05-07 as missing from the chat-bot path.
      3. `grantReferralSignupBonus` — credit the inviter +5 days
         (`REFERRAL_SIGNUP_BONUS_DAYS` in `lib/access.ts`) once per
         brand-new (telegram_id, inviter) pair, when `start_param`
         starts with `ref_<code>`. THIS is the «+5 дней на тот аккаунт
         с которого я приглашал» the user flagged in the same report.
      4. `deactivateExpiredAccess` — same idempotent expiry sweep the
         Mini App runs.

    Pre-fix the chat bot called `db.get_or_create_user` directly which
    only did step 1 — every chat-bot signup silently lost the trial
    AND broke the referral signup-bonus contract. Returns the parsed
    JSON; callers can ignore the body and rely on the side effects.
    """
    body: dict[str, Any] = {"telegramId": telegram_id}
    if username:
        body["username"] = username
    if first_name:
        body["firstName"] = first_name
    if last_name:
        body["lastName"] = last_name
    if photo_url:
        body["photoUrl"] = photo_url
    if start_param:
        body["startParam"] = start_param
    return await _post("/api/users/sync", body)


def _bot_routing_fields() -> dict[str, Any]:
    """Per-bot routing payload for /api/payments/* create endpoints.

    The Next.js side (`app/api/payments/sbp/create/route.ts`,
    `app/api/crypto-invoice/route.ts`) uses these to:
      1.  Compose the post-payment redirect URL as
          `https://t.me/<chat-bot>?start=paid_<id>` instead of the
          default `?startapp=paid_<id>` against the Mini-App-launcher
          bot — without this, every chat-bot payment lands the user
          back in the SISTER bot's Mini App.
      2.  Tag the payment row with `metadata.notifyVia = 'chat'` so
          the success notification (in `lib/sbp-confirm.ts` /
          `app/api/payments/crypto/callback/route.ts`) is delivered
          via TELEGRAM_BOT_CHAT_TOKEN — i.e. inside the chat thread
          the user actually paid from.
    """
    cfg = get_config()
    return {
        "notifyVia": "chat",
        "botUsername": cfg.bot_username,
    }


async def create_sbp_payment(*, telegram_id: int, days: int, amount_rub: int,
                             promo_id: int | None = None,
                             promo_code: str | None = None) -> dict:
    """POST /api/payments/sbp/create → {paymentId, transactionId, redirect}."""
    body: dict[str, Any] = {
        "telegramId": telegram_id,
        "days": days,
        "amount": amount_rub,
        **_bot_routing_fields(),
    }
    if promo_id is not None:
        body["promoId"] = promo_id
    if promo_code is not None:
        body["promoCode"] = promo_code
    return await _post("/api/payments/sbp/create", body)


async def create_crypto_invoice(*, telegram_id: int, days: int, amount_rub: int,
                                promo_id: int | None = None,
                                promo_code: str | None = None) -> dict:
    """POST /api/crypto-invoice → {paymentId, paymentUrl, trackId}."""
    body: dict[str, Any] = {
        "telegramId": telegram_id,
        "days": days,
        "amount": amount_rub,
        **_bot_routing_fields(),
    }
    if promo_id is not None:
        body["promoId"] = promo_id
    if promo_code is not None:
        body["promoCode"] = promo_code
    return await _post("/api/crypto-invoice", body)


async def apply_promo(*, telegram_id: int, code: str,
                     username: str | None = None,
                     first_name: str | None = None,
                     last_name: str | None = None) -> dict:
    """POST /api/promos/apply → {ok, type, days, endDate, subscriptionUrl, ...}."""
    body: dict[str, Any] = {
        "telegramId": telegram_id,
        "code": code.strip().upper(),
    }
    if username:
        body["username"] = username
    if first_name:
        body["firstName"] = first_name
    if last_name:
        body["lastName"] = last_name
    return await _post("/api/promos/apply", body)


async def delete_device(*, telegram_id: int, device_id: int) -> dict:
    """DELETE /api/users/devices?telegramId=…&deviceId=… → {ok, deletedId}."""
    return await _delete(
        f"/api/users/devices?telegramId={telegram_id}&deviceId={device_id}"
    )
