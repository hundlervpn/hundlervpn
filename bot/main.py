import os
import asyncio
import logging
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

# Configure logging
logging.basicConfig(level=logging.INFO)

# Get bot token from environment
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
APP_URL = os.getenv("APP_URL", "https://hundler-vpn.vercel.app")

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
            ]
        ]
    )
    
    welcome_text = (
        "👋 **Добро пожаловать в Hundler VPN!**\n\n"
        "🔒 Быстрый и безопасный VPN для ваших устройств\n\n"
        "✨ **Преимущества:**\n"
        "• До 3 устройств\n"
        "• Безлимитный трафик\n"
        "• Минимальные задержки\n\n"
        "Нажмите кнопку ниже, чтобы открыть приложение:"
    )
    
    await message.answer(
        welcome_text,
        parse_mode="Markdown",
        reply_markup=keyboard
    )


@dp.message(F.text.lower().in_(["vpn", "открыть", "open", "app"]))
async def open_app(message: types.Message):
    """Handle messages that request to open the app"""
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🚀 Открыть VPN",
                    web_app=WebAppInfo(url=APP_URL)
                )
            ]
        ]
    )
    
    await message.answer(
        "Нажмите кнопку ниже, чтобы открыть приложение:",
        reply_markup=keyboard
    )


async def main():
    """Start the bot"""
    # Start polling
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
