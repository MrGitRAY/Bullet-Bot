from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from aiogram import Bot, Dispatcher
from aiogram.types import Chat, Message, Update
from aiogram.types import User as TelegramUser
from sqlalchemy import func, select

from app.bot.handlers.tasks import create_router
from app.bot.middlewares.database import DatabaseMiddleware
from app.config.settings import Settings
from app.database.models import Task, TaskCompletion
from app.services.task_service import (
    TaskNotFoundError,
    complete_task,
    create_task,
    list_open_tasks,
)
from app.services.user_service import register_user

TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"


async def test_task_lifecycle_and_completion_history(sessions):
    async with sessions.begin() as session:
        await register_user(session, 1, "owner", "en")
        later = datetime.now(UTC) + timedelta(days=2)
        sooner = datetime.now(UTC) + timedelta(days=1)
        no_deadline = await create_task(session, 1, "No deadline", "low")
        later_task = await create_task(session, 1, "Later", "medium", later)
        sooner_task = await create_task(session, 1, "Sooner", "high", sooner)

        tasks = await list_open_tasks(session, 1)
        assert [task.id for task in tasks] == [sooner_task.id, later_task.id, no_deadline.id]
        assert await complete_task(session, 1, sooner_task.id) is True
        assert await complete_task(session, 1, sooner_task.id) is False

    async with sessions() as session:
        completed = await session.get(Task, sooner_task.id)
        assert completed is not None and completed.completed is True
        assert await session.scalar(select(func.count(TaskCompletion.id))) == 1


async def test_task_operations_are_scoped_to_owner(sessions):
    async with sessions.begin() as session:
        await register_user(session, 1, "owner", "en")
        await register_user(session, 2, "other", "en")
        task = await create_task(session, 1, "Private", "medium")
        assert await list_open_tasks(session, 2) == []
        with pytest.raises(TaskNotFoundError):
            await complete_task(session, 2, task.id)


@pytest.mark.parametrize(
    ("title", "priority", "deadline"),
    [
        ("", "low", None),
        ("x" * 501, "low", None),
        ("Valid", "urgent", None),
        ("Valid", "low", datetime.now()),
    ],
)
async def test_create_task_validates_input(sessions, title, priority, deadline):
    async with sessions.begin() as session:
        await register_user(session, 1, None, "en")
        with pytest.raises(ValueError):
            await create_task(session, 1, title, priority, deadline)


async def test_task_command_opens_task_menu(sessions):
    settings = Settings(_env_file=None, bot_token=TOKEN)
    dispatcher = Dispatcher()
    dispatcher.message.outer_middleware(DatabaseMiddleware(sessions, settings))
    dispatcher.include_router(create_router())
    bot = Bot(TOKEN)
    bot.session = AsyncMock()
    message = Message(
        message_id=1,
        date=0,
        chat=Chat(id=42, type="private"),
        from_user=TelegramUser(id=42, is_bot=False, first_name="Test", language_code="en"),
        text="/task",
    )
    try:
        await dispatcher.feed_update(bot, Update(update_id=1, message=message))
        response = bot.session.call_args.args[1]
        assert response.text.startswith("📋 Tasks")
        assert response.reply_markup.inline_keyboard[0][0].callback_data == "task:add"
    finally:
        await bot.session.close()
