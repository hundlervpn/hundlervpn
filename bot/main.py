import os
import asyncio
import logging
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo, FSInputFile
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)

# Get bot token from environment
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
APP_URL = os.getenv("APP_URL", "https://hundlervpn-hundlervpn-f985.twc1.net/")

if not BOT_TOKEN:
    raise ValueError("TELEGRAM_BOT_TOKEN environment variable is not set")

# Initialize bot and dispatcher
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    """Handle /start command - send welcome message with web app button"""
    
    # Create inline keyboard with Web App button
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🚀 Открыть VPN",
                    web_app=WebAppInfo(url=APP_URL)
                )
            ],
            [
                InlineKeyboardButton(
                    text="🔒 Политика конфиденциальности",
                    url="https://telegra.ph/Politika-konfidencialnosti-Hundler-VPN-03-21"
                )
            ],
            [
                InlineKeyboardButton(
                    text="📄 Пользовательское соглашение",
                    url="https://telegra.ph/Polzovatelskoe-soglashenie-Hundler-VPN-03-21"
                )
            ]
        ]
    )
    
    welcome_text = (
        "👋 <b>Добро пожаловать в Hundler VPN!</b>\n\n"
        "🔒 Быстрый и безопасный VPN для ваших устройств\n\n"
        "✨ <b>Преимущества:</b>\n"
        "• До 3 устройств\n"
        "• Безлимитный трафик\n"
        "• Минимальные задержки\n\n"
        "Нажмите кнопку ниже, чтобы открыть приложение:"
    )
    
    photo_path = Path(__file__).parent / 'welcome.png'
    if photo_path.exists():
        await message.answer_photo(
            photo=FSInputFile(photo_path),
            caption=welcome_text,
            parse_mode="HTML",
            reply_markup=keyboard
        )
    else:
        await message.answer(
            welcome_text,
            parse_mode="HTML",
            reply_markup=keyboard
        )


async def main():
    """Start the bot"""
    # Start polling
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
