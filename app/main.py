import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.types import BotCommand
from sqlalchemy import text

from app.bot.handlers.start import create_router
from app.bot.handlers.tasks import create_router as create_task_router
from app.bot.middlewares.database import DatabaseMiddleware
from app.config.logging import configure_logging
from app.config.settings import Settings
from app.database.session import create_engine, session_factory
from app.scheduler.jobs import create_scheduler


def create_bot(settings: Settings) -> Bot:
    proxy = (
        settings.telegram_proxy_url.get_secret_value()
        if settings.telegram_proxy_url is not None
        else None
    )
    return Bot(
        token=settings.bot_token.get_secret_value(),
        session=AiohttpSession(proxy=proxy),
    )


async def main() -> None:
    settings = Settings()
    configure_logging(settings.log_level)
    engine = create_engine(settings.database_url)
    bot = create_bot(settings)
    scheduler = create_scheduler(settings.timezone)
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1 FROM users LIMIT 1"))
        dispatcher = Dispatcher()
        middleware = DatabaseMiddleware(session_factory(engine), settings)
        dispatcher.message.outer_middleware(middleware)
        dispatcher.callback_query.outer_middleware(middleware)
        dispatcher.include_router(create_router())
        dispatcher.include_router(create_task_router())
        await bot.set_my_commands(
            [
                BotCommand(command="start", description="Open Bullet Journal"),
                BotCommand(command="menu", description="Show main menu"),
                BotCommand(command="task", description="Manage tasks"),
                BotCommand(command="cancel", description="Cancel current action"),
            ]
        )
        scheduler.start()
        logging.getLogger(__name__).info("Starting bullet-bot")
        await dispatcher.start_polling(bot, close_bot_session=False)
    finally:
        if scheduler.running:
            scheduler.shutdown(wait=False)
        await bot.session.close()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
