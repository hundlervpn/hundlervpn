"""Custom emoji ID mapping for inline-keyboard buttons.

Bot API 9.4 (Feb 2026) added the field `icon_custom_emoji_id` to
`InlineKeyboardButton`. When set, Telegram replaces the leading text
emoji of the button with the corresponding animated/styled custom emoji
on Premium clients. Non-Premium clients fall back to the plain Unicode
emoji that's still in the button text — so populating this dict is a
zero-risk progressive enhancement.

How to populate:
    1. Add your Telegram user ID to ADMIN_TELEGRAM_IDS in
       /root/hundlervpn/bot-chat/.env  (comma-separated, e.g.
       `ADMIN_TELEGRAM_IDS=5476263651,1234567890`).
    2. `systemctl restart hundlervpn-bot-chat`
    3. Send the bot ANY message that contains the animated custom
       emojis you want (works only from Telegram Premium clients —
       on iOS/Android long-press an emoji to switch to its animated
       variant; on Desktop click the smiley → "Premium" tab).
       You can also forward a message that already has them.
    4. The bot will reply with a list of `<emoji>: <id>` pairs.
    5. Edit THIS file — paste the IDs into the matching keys below.
    6. `systemctl restart hundlervpn-bot-chat` — done.

The keys below are referenced by name from the handlers via
`ui.emoji("key")`. Empty string = no custom emoji = plain Unicode shows.
"""
from __future__ import annotations

# Maps a Unicode emoji character → Telegram custom_emoji_id (string of
# digits) from the public `tgiosicons` Telegram pack
# (https://t.me/addemoji/tgiosicons). Used by `ui` to:
#   1) Wrap matching emojis in <tg-emoji emoji-id="…"> in HTML messages,
#      so Premium clients render the iOS-styled icon while non-Premium
#      clients keep seeing the plain Unicode glyph.
#   2) Resolve `icon_custom_emoji_id` for inline-keyboard buttons via the
#      semantic-key indirection in ICON_KEY_TO_EMOJI below.
#
# Run `python _fetch_emoji_set.py` to refresh the full mapping. Add new
# entries here whenever a handler introduces a new emoji it wants
# upgraded.
# ---------------------------------------------------------------------------
# Maps Unicode emoji → tgiosicons custom_emoji_id, populated from the
# actual sticker-set dump (`python _fetch_emoji_set.py`, run 2026-05-07).
#
# Only 1:1 EXACT matches are kept here: every iOS-styled icon represents
# the same emoji concept as the Unicode glyph it replaces, so Premium
# clients see a stylised version of exactly the right emoji.
#
# Glyphs without an exact match are intentionally absent — tgiosicons
# does NOT ship 🔑 💳 📱 📜 📋 💸 🛒 ⏳ 🚀 💻 🍎 ⚠️ 🔥, and the
# closest neighbours that DO exist (🛡 / 💎 / 🖥 / 📄) all looked
# apple-shaped in iOS rendering and were rejected by the user. Buttons /
# messages using any of these glyphs render as plain Unicode on every
# client.
EMOJI_TO_ID: dict[str, str] = {
    "\U0001F381":   "5773677501825945508",   # gift
    "\U0001F465":   "6032609071373226027",   # people
    "\u2753":       "6030848053177486888",   # question
    "\U0001F512":   "6037249452824072506",   # lock
    "\U0001F4CE":   "6039451237743595514",   # paperclip
    "\u2795":       "6032924188828767321",   # plus
    "\u2B05\uFE0F": "5960671702059848143",   # back arrow
    "\U0001F3E0":   "6042137469204303531",   # home
    "\U0001FA99":   "5778613750688911681",   # coin
    "\U0001F4B0":   "5778421276024509124",   # money bag
    "\U0001F911":   "5902206159095339799",   # money mouth
    "\U0001F501":   "6030657343744644592",   # repeat
    "\U0001F4E6":   "5778672437122045013",   # box
    "\u231B\uFE0F": "5891211339170326418",   # hourglass
    "\u2705":       "5774022692642492953",   # check
    "\U0001F389":   "6041731551845159060",   # party
    "\u274C":       "5774077015388852135",   # cross
    "\U0001F5D1":   "6039522349517115015",   # trash
    "\U0001F504":   "5769248574499983619",   # arrows-circle
    "\U0001F4E4":   "6039573425268201570",   # outbox
    "\U0001F4CA":   "5936143551854285132",   # bar chart
    "\U0001F916":   "6030400221232501136",   # robot
    "\u2B07\uFE0F": "6037157012242960559",   # down arrow
    "\U0001F4F7":   "6030506650522096180",   # camera
    "\U0001F34F":   "5775870512127283512",   # green apple — used for iOS / macOS
    "\u2757\uFE0F": "6030563507299160824",   # heavy exclamation
    "\U0001F44B":   "6041921818896372382",   # waving hand
    "\u2728":       "5778226250149532337",   # sparkles
    "\u26A1":       "5884428842780594914",   # lightning
    "\U0001F310":   "5776233299424843260",   # globe — also used as "Моя подписка" button icon
    "\U0001F31F":   "5805331990618053402",   # gold star
    # User-picked text-body icons (2026-05-07):
    "\U0001F4C5":   "5890937706803894250",   # calendar — for "Активна до"
    "\u23F3":       "6032625495328165724",   # ⏳ remapped to theater mask — for "Осталось N дней"
    "\U0001F517":   "6028171274939797252",   # link — for "Ссылка для импорта VPN"
    # User-picked card / cart icons for body text in buy.py screens —
    # match the same IDs used as button icon overrides (`card_pay`, `cart`):
    "\U0001F4B3":   "5904462880941545555",   # 💳 card — used in "💳 СБП", "💳 Способ:" lines
    "\U0001F6D2":   "5879814368572478751",   # 🛒 shopping cart — used in "🛒 N дней" header
}


# Semantic icon key → leading Unicode emoji used in button text. `ui.btn`
# strips this character from the label whenever a custom_emoji_id is
# attached, so Premium clients don't render two icons in a row.
ICON_KEY_TO_EMOJI: dict[str, str] = {
    # main menu
    "key":      "🔑",
    "card":     "💳",
    "gift":     "🎁",
    "phones":   "📱",
    "people":   "👥",
    "question": "❓",
    "scroll":   "📜",
    "lock":     "🔒",
    # subscription / nav
    "copy":     "📋",
    "plus":     "➕",
    "back":     "⬅️",
    "home":     "🏠",
    # buy / payments
    "card_pay": "💳",
    "coin":     "🪙",
    "money":    "💸",
    "loop":     "🔁",
    "cart":     "🛒",
    "hourglass": "⏳",
    "check":    "✅",
    # promo / status
    "party":    "🎉",
    "cross":    "❌",
    # devices
    "remove":   "❌",
    "refresh":  "🔄",
    # referral
    "share":    "📤",
    "rocket":   "🚀",
    "stats":    "📊",
    # install / help
    "ios":      "📱",
    "android":  "🤖",
    "windows":  "💻",
    "apple":    "🍎",
    "download": "⬇️",
    "camera":   "📷",
    # decorative
    "warn":     "⚠️",
    "wave":     "👋",
    "spark":    "✨",
    "fire":     "🔥",
    "lightning": "⚡",
    "shield":   "🛡",
    "globe":    "🌐",
}


# Explicit overrides — these IDs were chosen by the admin directly via
# the emoji-discovery handler (see handlers/_admin.py). They DO NOT have
# to match the Unicode glyph the button uses today (e.g. "key" maps to
# the globe icon despite the button starting with 🔑) — the user picked
# what they wanted in Telegram, so we trust their pick verbatim.
_ICON_OVERRIDES: dict[str, str] = {
    "key":      "5776233299424843260",   # globe — Моя подписка
    "card":     "5769126056262898415",   # purse — Купить VPN
    "card_pay": "5904462880941545555",   # user-picked card icon for "Картой (СБП)" — 2026-05-07
    "scroll":   "6037475557082403885",   # folder — Соглашение
    "phones":   "6033070647213560346",   # window-variant — Устройства
    "ios":      "5775870512127283512",   # green apple — iOS install
    "apple":    "5775870512127283512",   # green apple — macOS install
    "windows":  "6044356915029348425",   # TV — Windows install
    "copy":     "6034969813032374911",   # document — Скопировать ссылку
    "rocket":   "6048723247501938454",   # user-picked rocket — used for "Open Mini App" cross-link
}


# Derived: semantic key → custom_emoji_id, used by ui.btn. Overrides take
# precedence; otherwise auto-derived from EMOJI_TO_ID via ICON_KEY_TO_EMOJI.
ICONS: dict[str, str] = {
    key: _ICON_OVERRIDES.get(key) or EMOJI_TO_ID.get(em, "")
    for key, em in ICON_KEY_TO_EMOJI.items()
}
