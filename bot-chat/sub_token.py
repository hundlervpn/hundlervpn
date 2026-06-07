"""Port of `lib/sub-token.ts` — HMAC-signed subscription URLs.

The bot needs to hand the user a clickable subscription link
(`https://hundlervpn.xyz/api/sub/<token>`). The token is HMAC-signed with
the same XRAY_SYNC_TOKEN secret used by the Next.js side, so we just
re-implement the format here in Python and avoid an extra round-trip.

Token format (legacy telegram-id flavour, used by the bot):
    base64url(str(telegramId))  +  HMAC_SHA256_base64url(secret, "sub:<id>")[:12]

Where base64url means standard base64 with `+/` replaced by `-_` and
padding (`=`) stripped — same as Node's `Buffer.toString('base64url')`.
"""
from __future__ import annotations

import base64
import hashlib
import hmac

from config import get_config


def _b64url_encode(data: bytes) -> str:
    """base64url with padding stripped — matches Node's 'base64url' encoding."""
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def generate_sub_token(telegram_id: int, secret: str) -> str:
    id_part = _b64url_encode(str(telegram_id).encode("utf-8"))
    sig_full = hmac.new(
        secret.encode("utf-8"),
        f"sub:{telegram_id}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    sig = _b64url_encode(sig_full)[:12]
    return f"{id_part}{sig}"


def get_subscription_url(telegram_id: int) -> str | None:
    """Build the public /api/sub/<token> URL for this Telegram user.

    Returns None if XRAY_SYNC_TOKEN is missing — caller must handle that
    by falling back to the Mini App link.
    """
    cfg = get_config()
    if not cfg.sub_secret or not cfg.app_url:
        return None
    token = generate_sub_token(telegram_id, cfg.sub_secret)
    return f"{cfg.app_url}/api/sub/{token}"
