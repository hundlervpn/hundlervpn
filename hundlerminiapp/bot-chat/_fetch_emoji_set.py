"""Fetch a Telegram custom-emoji sticker set and print emoji → ID pairs.

Telegram's `getStickerSet` Bot API endpoint returns the full list of
stickers in a public emoji pack including each one's `custom_emoji_id`,
which is exactly what we need to populate `emoji_icons.ICONS`.

Usage:
    cd bot-chat
    python _fetch_emoji_set.py                 # default: tgiosicons
    python _fetch_emoji_set.py tgmacicons      # any other public pack

Output:
    1) A human-readable table of `<emoji>  →  <id>` pairs (one per line).
    2) A ready-to-paste Python dict literal — copy the relevant lines
       into `emoji_icons.ICONS` and replace the empty strings.

The set name is whatever follows `t.me/addemoji/` in the share link, e.g.
    https://t.me/addemoji/tgiosicons   →   tgiosicons
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import aiohttp
from dotenv import load_dotenv

# Load .env that lives next to this file (same convention as config.py).
load_dotenv(Path(__file__).resolve().parent / ".env")

DEFAULT_SET = "tgiosicons"


async def fetch_set(token: str, name: str) -> list[dict]:
    url = f"https://api.telegram.org/bot{token}/getStickerSet"
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json={"name": name}, timeout=15) as resp:
            data = await resp.json()
    if not data.get("ok"):
        raise SystemExit(f"Telegram API error for set '{name}': {data!r}")
    return data["result"]["stickers"]


def print_table(stickers: list[dict], name: str) -> None:
    print(f"\n# Emoji set: {name}  ({len(stickers)} stickers)\n")
    print(f"{'#':>3}  {'emoji':<6}  custom_emoji_id")
    print(f"{'-'*3}  {'-'*6}  {'-'*25}")
    for i, st in enumerate(stickers):
        emoji = st.get("emoji") or "?"
        cid = st.get("custom_emoji_id") or ""
        print(f"{i:>3}  {emoji:<6}  {cid}")


def print_dict_literal(stickers: list[dict]) -> None:
    print("\n# --- copy/paste into emoji_icons.ICONS ---")
    print("ICONS_FROM_SET: dict[str, str] = {")
    for st in stickers:
        emoji = st.get("emoji") or "?"
        cid = st.get("custom_emoji_id") or ""
        print(f'    "{emoji}": "{cid}",')
    print("}")


async def main() -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit(
            "TELEGRAM_BOT_TOKEN is missing — make sure bot-chat/.env is "
            "present (or export the variable manually)."
        )
    name = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SET
    stickers = await fetch_set(token, name)
    print_table(stickers, name)
    print_dict_literal(stickers)


if __name__ == "__main__":
    asyncio.run(main())
