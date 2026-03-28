import os
import asyncio
import logging
import psycopg2
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo, FSInputFile, URLInputFile
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Get bot token from environment
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
APP_URL = os.getenv("APP_URL", "https://hundlervpn-hundlervpn-f985.twc1.net/")

# Database connection
DB_CONFIG = {
    "host": os.getenv("POSTGRESQL_HOST", "5.42.118.215"),
    "port": int(os.getenv("POSTGRESQL_PORT", "5432")),
    "user": os.getenv("POSTGRESQL_USER", "gen_user"),
    "password": os.getenv("POSTGRESQL_PASSWORD", ""),
    "database": os.getenv("POSTGRESQL_DBNAME", "default_db"),
}

if not BOT_TOKEN:
    raise ValueError("TELEGRAM_BOT_TOKEN environment variable is not set")

# Initialize bot and dispatcher
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)


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


async def process_pending_broadcasts():
    """Check for pending broadcasts and send them"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Get pending broadcast
        cur.execute("""
            SELECT id, title, message, image_url, button_text, button_url
            FROM broadcasts 
            WHERE status = 'pending' 
            ORDER BY created_at ASC 
            LIMIT 1
        """)
        broadcast = cur.fetchone()
        
        if not broadcast:
            cur.close()
            conn.close()
            return
        
        broadcast_id, title, message, image_url, button_text, button_url = broadcast
        
        # Update status to sending
        cur.execute("UPDATE broadcasts SET status = 'sending' WHERE id = %s", (broadcast_id,))
        conn.commit()
        
        # Get all users with telegram_id
        cur.execute("SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL")
        users = cur.fetchall()
        
        sent_count = 0
        failed_count = 0
        
        for (telegram_id,) in users:
            try:
                # Build keyboard if button provided
                keyboard = None
                if button_text and button_url:
                    keyboard = InlineKeyboardMarkup(
                        inline_keyboard=[[
                            InlineKeyboardButton(text=button_text, url=button_url)
                        ]]
                    )
                
                # Build full message
                full_message = ""
                if title:
                    full_message = f"<b>{title}</b>\n\n"
                full_message += message
                
                # Send with or without image
                if image_url:
                    try:
                        await bot.send_photo(
                            chat_id=telegram_id,
                            photo=URLInputFile(image_url),
                            caption=full_message,
                            parse_mode="HTML",
                            reply_markup=keyboard
                        )
                    except Exception:
                        # Fallback to message without image
                        await bot.send_message(
                            chat_id=telegram_id,
                            text=full_message,
                            parse_mode="HTML",
                            reply_markup=keyboard
                        )
                else:
                    await bot.send_message(
                        chat_id=telegram_id,
                        text=full_message,
                        parse_mode="HTML",
                        reply_markup=keyboard
                    )
                
                sent_count += 1
                await asyncio.sleep(0.05)  # Rate limiting
                
            except Exception as e:
                logger.error(f"Failed to send broadcast to {telegram_id}: {e}")
                failed_count += 1
        
        # Update broadcast status
        cur.execute("""
            UPDATE broadcasts 
            SET status = 'sent', sent_count = %s, failed_count = %s, sent_at = NOW()
            WHERE id = %s
        """, (sent_count, failed_count, broadcast_id))
        conn.commit()
        
        logger.info(f"Broadcast {broadcast_id} completed: {sent_count} sent, {failed_count} failed")
        
        cur.close()
        conn.close()
        
    except Exception as e:
        logger.error(f"Error processing broadcasts: {e}")


async def broadcast_scheduler():
    """Background task to check for broadcasts every 10 seconds"""
    while True:
        await process_pending_broadcasts()
        await asyncio.sleep(10)


async def main():
    """Start the bot"""
    # Start broadcast scheduler in background
    asyncio.create_task(broadcast_scheduler())
    
    # Start polling
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
