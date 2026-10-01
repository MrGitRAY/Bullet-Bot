from datetime import date

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


def task_kind_menu(language: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=translate("task_kind_one_time", language),
                    callback_data="task:kind:one_time",
                )
            ],
            [
                InlineKeyboardButton(
                    text=translate("task_kind_weekly", language),
                    callback_data="task:kind:weekly",
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


def weekdays_menu(selected: set[int], language: str) -> InlineKeyboardMarkup:
    day_order = (6, 7, 1, 2, 3, 4, 5) if language == "fa" else tuple(range(1, 8))
    buttons = [
        InlineKeyboardButton(
            text=("✅ " if day in selected else "") + translate(f"weekday_{day}", language),
            callback_data=f"task:weekday:{day}",
        )
        for day in day_order
    ]
    return InlineKeyboardMarkup(
        inline_keyboard=[
            buttons[:4],
            buttons[4:],
            [
                InlineKeyboardButton(
                    text=translate("task_weekdays_done", language),
                    callback_data="task:weekdays:done",
                )
            ],
        ]
    )


def task_list_keyboard(
    tasks: list[Task], language: str, occurrence_date: date
) -> InlineKeyboardMarkup:
    rows = [
        [
            InlineKeyboardButton(
                text=f"✅ {task.title[:40]}",
                callback_data=f"task:complete:{task.id}:{occurrence_date.isoformat()}",
            )
        ]
        for task in tasks
    ]
    rows.append(
        [InlineKeyboardButton(text=translate("task_add", language), callback_data="task:add")]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)
