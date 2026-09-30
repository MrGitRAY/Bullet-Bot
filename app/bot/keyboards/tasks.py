from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from app.bot.i18n import translate
from app.database.models import Task


def task_menu(language: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=translate("task_add", language), callback_data="task:add")],
            [
                InlineKeyboardButton(
                    text=translate("task_list", language), callback_data="task:list"
                )
            ],
        ]
    )


def priority_menu(language: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=translate(f"priority_{value}", language),
                    callback_data=f"task:priority:{value}",
                )
                for value in ("low", "medium", "high")
            ]
        ]
    )


def deadline_menu(language: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=translate("task_no_deadline", language),
                    callback_data="task:deadline:skip",
                )
            ]
        ]
    )


def task_list_keyboard(tasks: list[Task], language: str) -> InlineKeyboardMarkup:
    rows = [
        [
            InlineKeyboardButton(
                text=f"✅ {task.title[:40]}", callback_data=f"task:complete:{task.id}"
            )
        ]
        for task in tasks
    ]
    rows.append(
        [InlineKeyboardButton(text=translate("task_add", language), callback_data="task:add")]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)
