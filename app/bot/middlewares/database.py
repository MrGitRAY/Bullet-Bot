from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config.settings import Settings


class DatabaseMiddleware(BaseMiddleware):
    def __init__(self, sessions: async_sessionmaker[AsyncSession], settings: Settings) -> None:
        self.sessions = sessions
        self.settings = settings

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        if isinstance(event, Message):
            chat = event.chat
        elif isinstance(event, CallbackQuery) and event.message:
            chat = event.message.chat
        else:
            return None
        if chat.type != "private" or not event.from_user:
            return None
        allowed = self.settings.allowed_user_ids
        if allowed and event.from_user.id not in allowed:
            return None
        async with self.sessions.begin() as session:
            data["session"] = session
            data["settings"] = self.settings
            return await handler(event, data)
