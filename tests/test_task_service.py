from datetime import UTC, date, datetime, timedelta
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
    TaskNotScheduledError,
    complete_task,
    create_task,
    list_open_tasks,
)
from app.services.user_service import register_user

TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"
MONDAY = date(2026, 10, 5)
TUESDAY = date(2026, 10, 6)


async def test_one_time_task_requires_deadline_and_completes_once(sessions):
    async with sessions.begin() as session:
        await register_user(session, 1, "owner", "en")
        deadline = datetime.now(UTC) + timedelta(days=1)
        task = await create_task(
            session,
            1,
            "Submit report",
            "high",
            kind="one_time",
            deadline=deadline,
        )
        assert await list_open_tasks(session, 1, occurrence_date=MONDAY) == [task]
        assert await complete_task(session, 1, task.id, occurrence_date=MONDAY) is True
        assert await complete_task(session, 1, task.id, occurrence_date=MONDAY) is False

    async with sessions() as session:
        completed = await session.get(Task, task.id)
        assert completed is not None and completed.completed is True
        history = await session.scalar(select(TaskCompletion))
        assert history is not None and history.occurrence_date == MONDAY


async def test_weekly_task_appears_and_completes_per_scheduled_day(sessions):
    async with sessions.begin() as session:
        await register_user(session, 1, "owner", "en")
        task = await create_task(
            session,
            1,
            "Exercise",
            "medium",
            kind="weekly",
            weekdays=[1, 3, 1],
        )
        assert task.repeat_config == {"weekdays": [1, 3]}
        assert await list_open_tasks(session, 1, occurrence_date=MONDAY) == [task]
        assert await list_open_tasks(session, 1, occurrence_date=TUESDAY) == []
        assert await complete_task(session, 1, task.id, occurrence_date=MONDAY) is True
        assert await complete_task(session, 1, task.id, occurrence_date=MONDAY) is False
        assert await list_open_tasks(session, 1, occurrence_date=MONDAY) == []
        with pytest.raises(TaskNotScheduledError):
            await complete_task(session, 1, task.id, occurrence_date=TUESDAY)

    async with sessions() as session:
        stored = await session.get(Task, task.id)
        assert stored is not None and stored.completed is False
        assert await session.scalar(select(func.count(TaskCompletion.id))) == 1


async def test_task_operations_are_scoped_to_owner(sessions):
    async with sessions.begin() as session:
        await register_user(session, 1, "owner", "en")
        await register_user(session, 2, "other", "en")
        task = await create_task(
            session,
            1,
            "Private",
            "medium",
            kind="one_time",
            deadline=datetime.now(UTC),
        )
        assert await list_open_tasks(session, 2, occurrence_date=MONDAY) == []
        with pytest.raises(TaskNotFoundError):
            await complete_task(session, 2, task.id, occurrence_date=MONDAY)


@pytest.mark.parametrize(
    ("title", "priority", "kind", "deadline", "weekdays"),
    [
        ("", "low", "one_time", datetime.now(UTC), None),
        ("x" * 501, "low", "one_time", datetime.now(UTC), None),
        ("Valid", "urgent", "one_time", datetime.now(UTC), None),
        ("Valid", "low", "one_time", None, None),
        ("Valid", "low", "one_time", datetime.now(), None),
        ("Valid", "low", "weekly", None, []),
        ("Valid", "low", "weekly", None, [0, 8]),
        ("Valid", "low", "weekly", datetime.now(UTC), [1]),
        ("Valid", "low", "unknown", None, None),
    ],
)
async def test_create_task_validates_input(sessions, title, priority, kind, deadline, weekdays):
    async with sessions.begin() as session:
        await register_user(session, 1, None, "en")
        with pytest.raises(ValueError):
            await create_task(
                session,
                1,
                title,
                priority,
                kind=kind,
                deadline=deadline,
                weekdays=weekdays,
            )


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
