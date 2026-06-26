"""Centralised configuration for the chat-only bot.

All env vars consumed by the bot are documented here so deployment on the
VPS can copy this file as a checklist for the systemd unit Environment=
lines.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load .env that lives next to this file regardless of the CWD the bot was
# launched from (useful when the systemd unit cd's elsewhere).
_env_path = Path(__file__).resolve().parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)
else:
    # Fall back to default lookup (CWD + parents) so production VPS where
    # env comes from systemd Environment= directives still works.
    load_dotenv()


@dataclass(frozen=True)
class Config:
    # Telegram --------------------------------------------------------------
    bot_token: str
    bot_username: str  # without @ — used to render share links
    # Username of the SISTER bot that hosts the Mini App (the original
    # `hundlervpnbot`). The chat-bot links to it from the main menu so users
    # who landed here can switch back to the GUI app with one tap. Must be
    # the bare username (no @, no t.me/ prefix).
    main_bot_username: str

    # Web app (the existing Mini App / API surface) ------------------------
    # The chat bot reuses /api/payments/sbp, /api/payments/crypto,
    # /api/promos/apply, /api/sub/[token] from the Next.js app. APP_URL
    # must point to the production Next.js so callbacks (SBP webhook) can
    # find the user's subscription rows.
    app_url: str
    sub_secret: str  # XRAY_SYNC_TOKEN — used to build subscription URLs

    # PostgreSQL -----------------------------------------------------------
    pg_host: str
    pg_port: int
    pg_user: str
    pg_password: str
    pg_db: str
    pg_sslmode: str

    # Bot-only API auth ----------------------------------------------------
    # When the chat bot calls Next.js API endpoints to create payments /
    # apply promos, it sends X-Bot-Token: <bot_api_secret>. Next.js
    # validates this against BOT_API_SECRET env on its side. This lets the
    # API trust the telegram_id passed by the bot without WebApp init data.
    bot_api_secret: str

    # Owner / admin --------------------------------------------------------
    # Set of telegram_ids that are allowed to use admin-only handlers (e.g.
    # the emoji-id discovery flow in handlers/_admin.py). Configure via
    # ADMIN_TELEGRAM_IDS=12345,67890 (comma-separated) in .env. Empty set
    # disables all admin commands.
    admin_telegram_ids: frozenset[int]

    @classmethod
    def from_env(cls) -> "Config":
        token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        if not token:
            raise RuntimeError("TELEGRAM_BOT_TOKEN env var is required")

        return cls(
            bot_token=token,
            bot_username=os.getenv("TELEGRAM_BOT_USERNAME", "hundlervpn_bot").lstrip("@"),
            main_bot_username=os.getenv("MAIN_BOT_USERNAME", "hundlervpnbot").lstrip("@"),
            app_url=os.getenv("APP_URL", "https://hundlervpn.xyz").rstrip("/"),
            sub_secret=os.getenv("XRAY_SYNC_TOKEN", ""),
            pg_host=os.getenv("POSTGRESQL_HOST", ""),
            pg_port=int(os.getenv("POSTGRESQL_PORT", "5432")),
            pg_user=os.getenv("POSTGRESQL_USER", ""),
            pg_password=os.getenv("POSTGRESQL_PASSWORD", ""),
            pg_db=os.getenv("POSTGRESQL_DBNAME", ""),
            pg_sslmode=os.getenv("POSTGRESQL_SSLMODE", "require"),
            bot_api_secret=os.getenv("BOT_API_SECRET", ""),
            admin_telegram_ids=_parse_admin_ids(
                os.getenv("ADMIN_TELEGRAM_IDS")
                # Backwards compat with the old single-ID env name.
                or os.getenv("ADMIN_TELEGRAM_ID", "")
            ),
        )

    @property
    def pg_dsn(self) -> dict:
        """psycopg2.connect kwargs."""
        return dict(
            host=self.pg_host,
            port=self.pg_port,
            user=self.pg_user,
            password=self.pg_password,
            database=self.pg_db,
            sslmode=self.pg_sslmode,
            connect_timeout=10,
        )

    @property
    def api_base(self) -> str:
        return self.app_url


def _parse_admin_ids(raw: str | None) -> frozenset[int]:
    """Parse comma-separated telegram_ids into a frozenset, dropping junk."""
    if not raw:
        return frozenset()
    out: set[int] = set()
    for piece in raw.split(","):
        piece = piece.strip()
        if not piece:
            continue
        try:
            out.add(int(piece))
        except ValueError:
            # Silently ignore non-numeric tokens; misconfigured env should
            # not crash the bot at startup.
            pass
    return frozenset(out)


# Singleton — lazily instantiated so importing this module never fails on
# missing env vars (useful for unit tests).
_config: Config | None = None


def get_config() -> Config:
    global _config
    if _config is None:
        _config = Config.from_env()
    return _config