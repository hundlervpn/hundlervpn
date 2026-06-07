"""Synchronous PostgreSQL helpers shared by all handlers.

Why sync (not asyncpg): the existing `bot/` already uses psycopg2 so we
keep one driver in production. We wrap blocking calls with
`asyncio.to_thread()` from handlers to avoid freezing the aiogram event
loop.

Why so much duplication with the Next.js codebase: the bot reads the
same tables but the SQL is short and the failure modes are different
(bot must degrade gracefully when DB is briefly unreachable rather than
500'ing user-facing endpoints). Keeping its own helpers avoids growing
a Python-from-TypeScript ORM.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterable

import psycopg2
import psycopg2.extras

from config import get_config

log = logging.getLogger(__name__)


@contextmanager
def cursor():
    """Yield a dict-cursor with auto-commit and explicit close.

    Usage:
        with cursor() as cur:
            cur.execute("SELECT 1")
            row = cur.fetchone()

    Raises any psycopg2 error to the caller — handlers catch & show a
    friendly message to the user.
    """
    cfg = get_config()
    conn = psycopg2.connect(**cfg.pg_dsn)
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cur
            conn.commit()
        finally:
            cur.close()
    finally:
        conn.close()


def fetchone(sql: str, params: Iterable[Any] | None = None) -> dict | None:
    with cursor() as cur:
        cur.execute(sql, params or ())
        return cur.fetchone()


def fetchall(sql: str, params: Iterable[Any] | None = None) -> list[dict]:
    with cursor() as cur:
        cur.execute(sql, params or ())
        return cur.fetchall()


def execute(sql: str, params: Iterable[Any] | None = None) -> None:
    with cursor() as cur:
        cur.execute(sql, params or ())


# ---------------------------------------------------------------------------
# Domain helpers — small wrappers per query so handlers stay declarative.
# ---------------------------------------------------------------------------


def get_user_by_telegram_id(telegram_id: int) -> dict | None:
    """Read-only lookup. Returns None if the user has never used /start."""
    return fetchone(
        "SELECT id, telegram_id, username, first_name, last_name, referral_code, is_banned "
        "FROM users WHERE telegram_id = %s LIMIT 1",
        (telegram_id,),
    )


def get_or_create_user(telegram_id: int, username: str | None,
                       first_name: str | None, last_name: str | None,
                       language_code: str | None = None) -> dict:
    """Idempotent user upsert — mirrors `upsertTelegramUser` in lib/access.ts.

    The `language_code` argument is accepted for API symmetry with aiogram's
    User model but ignored: the live schema has no `language_code` column.
    Returns the full users row (RealDictRow). On conflict updates username/
    first_name/last_name + bumps last_seen_at; never overwrites referral_code
    once set.
    """
    referral_code = f"u{_to_base36(telegram_id)}"
    _ = language_code  # currently unused — see docstring
    with cursor() as cur:
        cur.execute(
            """
            INSERT INTO users (
                telegram_id, username, first_name, last_name,
                referral_code, auth_type, last_seen_at
            )
            VALUES (%s, %s, %s, %s, %s, 'telegram', NOW())
            ON CONFLICT (telegram_id) DO UPDATE SET
                username = EXCLUDED.username,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                last_seen_at = NOW(),
                referral_code = COALESCE(users.referral_code, EXCLUDED.referral_code),
                updated_at = NOW()
            RETURNING *
            """,
            (telegram_id, username, first_name, last_name, referral_code),
        )
        return cur.fetchone()


def _to_base36(n: int) -> str:
    """Match the Mini App's referral-code format: lowercase base36 of telegram_id."""
    if n < 0:
        return "-" + _to_base36(-n)
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        return "0"
    out: list[str] = []
    while n:
        n, rem = divmod(n, 36)
        out.append(chars[rem])
    return "".join(reversed(out))


def get_active_subscription(user_id: int) -> dict | None:
    """Latest active+non-expired subscription with plan info, or None."""
    return fetchone(
        """
        SELECT s.id, s.status, s.start_date, s.end_date,
               p.name AS plan_name, p.duration_days, p.price,
               p.max_devices
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        WHERE s.user_id = %s
          AND s.status = 'active'
          AND s.end_date > NOW()
        ORDER BY s.end_date DESC
        LIMIT 1
        """,
        (user_id,),
    )


def list_plans() -> list[dict]:
    """All publicly-purchaseable plans, ordered by duration ASC.

    `price` is NUMERIC in rubles (no separate USD column — crypto invoices
    convert on-the-fly via the payment provider).
    """
    return fetchall(
        """
        SELECT id, name, duration_days, price, max_devices, traffic_limit
        FROM plans
        WHERE is_active = TRUE
        ORDER BY duration_days ASC
        """
    )


def list_servers() -> list[dict]:
    """Active VPN servers in display order — same ORDER BY as /api/sub/[token]."""
    return fetchall(
        """
        SELECT id, name, host, port, country
        FROM servers
        WHERE is_active = TRUE
        ORDER BY sort_order ASC, country ASC, name ASC
        """
    )


def list_devices(user_id: int, max_devices: int = 3) -> list[dict]:
    """Active device sessions for the user, capped to first <max_devices>.

    Mirrors the GET /api/users/devices logic: only devices seen in the last
    30 days, never kicked, ranked by created_at ASC, capped at the
    subscription's max_devices.
    """
    return fetchall(
        """
        WITH ranked AS (
            SELECT id, device_name, ip_address, last_seen_at, created_at,
                   ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rank
            FROM device_sessions
            WHERE user_id = %s
              AND last_seen_at > NOW() - INTERVAL '30 days'
              AND kicked_at IS NULL
        )
        SELECT id, device_name, ip_address, last_seen_at, created_at
        FROM ranked
        WHERE rank <= %s
        ORDER BY last_seen_at DESC NULLS LAST
        """,
        (user_id, max_devices),
    )


def get_max_devices(user_id: int) -> int:
    """Return the user's max_devices from their active plan, or 3 by default."""
    row = fetchone(
        """
        SELECT COALESCE(p.max_devices, 3) AS max_devices
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        WHERE s.user_id = %s AND s.status = 'active' AND s.end_date > NOW()
        ORDER BY s.end_date DESC LIMIT 1
        """,
        (user_id,),
    )
    return int((row or {}).get("max_devices") or 3)


def get_referral_stats(user_id: int) -> dict:
    """Returns {code, invited_count, bonus_days_total}."""
    user = fetchone("SELECT referral_code FROM users WHERE id = %s", (user_id,))
    code = (user or {}).get("referral_code")
    invited = fetchone(
        "SELECT COUNT(*) AS n FROM users WHERE referred_by_user_id = %s",
        (user_id,),
    )
    bonus = fetchone(
        """
        SELECT COALESCE(SUM(bonus_days), 0) AS total
        FROM referral_bonus_transactions
        WHERE inviter_user_id = %s
        """,
        (user_id,),
    )
    return {
        "code": code,
        "invited_count": int((invited or {}).get("n", 0) or 0),
        "bonus_days_total": int((bonus or {}).get("total", 0) or 0),
    }
