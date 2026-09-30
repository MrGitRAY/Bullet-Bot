from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.i18n import translate
from app.bot.keyboards.main_menu import main_menu
from app.config.settings import Settings
from app.services.user_service import register_user


def create_router() -> Router:
    router = Router(name="foundation")
    router.message.register(start, CommandStart())
    router.message.register(start, Command("menu"))
    router.message.register(
        coming_soon,
        Command("habit", "stats", "project", "profile", "settings"),
    )
    router.message.register(
        coming_soon,
        F.text.in_(
            {
                "🌱 Habits",
                "🌱 عادت‌ها",
                "📂 Projects",
                "📂 پروژه‌ها",
                "📊 Statistics",
                "📊 آمار",
                "🏆 Profile",
                "🏆 پروفایل",
                "⚙ Settings",
                "⚙ تنظیمات",
            }
        ),
    )
    return router


async def start(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    if message.from_user is None:
        return
    language = message.from_user.language_code
    user = await register_user(
        session,
        message.from_user.id,
        message.from_user.username,
        language if language in {"fa", "en"} else settings.default_language,
    )
    await state.clear()
    await message.answer(translate("welcome", user.language), reply_markup=main_menu(user.language))


async def coming_soon(message: Message, session: AsyncSession, settings: Settings) -> None:
    if message.from_user is None:
        return
    user = await register_user(
        session, message.from_user.id, message.from_user.username, settings.default_language
    )
    await message.answer(
        translate("coming_soon", user.language), reply_markup=main_menu(user.language)
    )
