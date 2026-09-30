from aiogram.types import KeyboardButton, ReplyKeyboardMarkup

from app.bot.i18n import translate

MENU_KEYS = ("tasks", "habits", "projects", "statistics", "profile", "settings")


def main_menu(language: str) -> ReplyKeyboardMarkup:
    buttons = [KeyboardButton(text=translate(key, language)) for key in MENU_KEYS]
    return ReplyKeyboardMarkup(
        keyboard=[buttons[i : i + 2] for i in range(0, len(buttons), 2)], resize_keyboard=True
    )
