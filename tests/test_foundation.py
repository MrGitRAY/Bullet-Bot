import logging
from datetime import date
from unittest.mock import AsyncMock

import pytest
from aiogram import Bot, Dispatcher
from aiogram.types import Chat, Message, Update
from aiogram.types import User as TelegramUser
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.bot.handlers.start import create_router
from app.bot.i18n import messages
from app.bot.keyboards.main_menu import main_menu
from app.bot.middlewares.database import DatabaseMiddleware
from app.config.logging import RedactingFormatter
from app.config.settings import Settings
from app.database.models import Habit, HabitLog, Project, Task, TaskCompletion, User, XPHistory
from app.main import create_bot
from app.services.user_service import register_user

TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"


def test_configuration_and_secrets():
    settings = Settings(_env_file=None, bot_token=TOKEN)
    assert TOKEN not in repr(settings)
    with pytest.raises(ValueError):
        Settings(_env_file=None, bot_token=TOKEN, database_url="sqlite:///bad.db")
    with pytest.raises(ValueError):
        Settings(_env_file=None, bot_token=TOKEN, timezone="invalid/timezone")
    settings = Settings(
        _env_file=None,
        bot_token=TOKEN,
        telegram_proxy_url="socks5://user:password@127.0.0.1:1080",
    )
    assert "password" not in repr(settings)
    with pytest.raises(ValueError):
        Settings(
            _env_file=None,
            bot_token=TOKEN,
            telegram_proxy_url="mtproto://proxy.example:443",
        )
    with pytest.raises(ValueError):
        Settings(
            _env_file=None,
            bot_token=TOKEN,
            telegram_proxy_url="socks5://127.0.0.1",
        )


async def test_bot_uses_configured_proxy():
    proxy = "socks5://user:password@127.0.0.1:1080"
    settings = Settings(_env_file=None, bot_token=TOKEN, telegram_proxy_url=proxy)
    bot = create_bot(settings)
    try:
        assert bot.session._proxy == proxy
    finally:
        await bot.session.close()


def test_locales_and_keyboard():
    assert messages("fa").keys() == messages("en").keys()
    for language in ("fa", "en"):
        menu = main_menu(language)
        assert len(menu.keyboard) == 3
        assert all(len(row) == 2 for row in menu.keyboard)


def test_token_redacted_from_logs():
    record = logging.LogRecord("test", logging.ERROR, "", 0, "failed %s", (TOKEN,), None)
    assert TOKEN not in RedactingFormatter().format(record)


async def test_registration_is_idempotent(sessions):
    async with sessions.begin() as session:
        first = await register_user(session, 5000000000, "before", "fa")
        second = await register_user(session, 5000000000, "after", "en")
        assert first.id == second.id
        assert second.language == "fa"
        assert second.username == "after"
    async with sessions() as session:
        assert await session.scalar(select(func.count(User.id))) == 1


async def test_relations_and_cascades(sessions):
    async with sessions.begin() as session:
        user = await register_user(session, 42, None, "en")
        project = Project(user_id=user.id, name="Personal")
        habit = Habit(user_id=user.id, name="Walk")
        session.add_all([project, habit])
        await session.flush()
        task = Task(user_id=user.id, project_id=project.id, title="First task")
        session.add_all(
            [
                task,
                HabitLog(habit_id=habit.id, date=date.today()),
                XPHistory(user_id=user.id, action="test", amount=5),
            ]
        )
        await session.flush()
        await session.execute(delete(Project).where(Project.id == project.id))
        await session.refresh(task)
        assert task.project_id is None
        await session.execute(delete(User).where(User.id == user.id))
    async with sessions() as session:
        for model in (User, Project, Task, TaskCompletion, Habit, HabitLog, XPHistory):
            assert await session.scalar(select(func.count()).select_from(model)) == 0


async def test_duplicate_habit_day_rejected(sessions):
    with pytest.raises(IntegrityError):
        async with sessions.begin() as session:
            user = await register_user(session, 42, None, "en")
            habit = Habit(user_id=user.id, name="Read")
            session.add(habit)
            await session.flush()
            session.add_all([HabitLog(habit_id=habit.id, date=date.today()) for _ in range(2)])


async def test_failed_handler_rolls_back(sessions):
    settings = Settings(_env_file=None, bot_token=TOKEN)
    middleware = DatabaseMiddleware(sessions, settings)
    message = Message(
        message_id=1,
        date=0,
        chat=Chat(id=42, type="private"),
        from_user=TelegramUser(id=42, is_bot=False, first_name="Test"),
    )

    async def failing_handler(event, data):
        await register_user(data["session"], 42, None, "en")
        raise RuntimeError("Delivery failed")

    with pytest.raises(RuntimeError):
        await middleware(failing_handler, message, {})
    async with sessions() as session:
        assert await session.scalar(select(func.count(User.id))) == 0


@pytest.mark.parametrize(
    "user_id,chat_type,allowed,expected",
    [
        (42, "private", [], 1),
        (42, "private", [42], 1),
        (43, "private", [42], 0),
        (42, "group", [], 0),
    ],
)
async def test_start_through_dispatcher(sessions, user_id, chat_type, allowed, expected):
    settings = Settings(_env_file=None, bot_token=TOKEN, allowed_user_ids=allowed)
    dispatcher = Dispatcher()
    dispatcher.message.outer_middleware(DatabaseMiddleware(sessions, settings))
    dispatcher.include_router(create_router())
    bot = Bot(TOKEN)
    bot.session = AsyncMock()
    message = Message(
        message_id=1,
        date=0,
        chat=Chat(id=42, type=chat_type),
        from_user=TelegramUser(id=user_id, is_bot=False, first_name="Test", language_code="fa"),
        text="/start",
    )
    try:
        await dispatcher.feed_update(bot, Update(update_id=1, message=message))
        assert bot.session.call_count == expected
        if expected:
            response = bot.session.call_args.args[1]
            assert response.text == messages("fa")["welcome"]
            assert len(response.reply_markup.keyboard) == 3
        async with sessions() as session:
            assert await session.scalar(select(func.count(User.id))) == expected
    finally:
        await bot.session.close()
