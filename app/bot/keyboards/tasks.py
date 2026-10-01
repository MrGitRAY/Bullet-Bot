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
            [
                InlineKeyboardButton(
                    text=translate("task_manage", language), callback_data="task:manage"
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


def priority_menu(language: str, *, task_id: int | None = None) -> InlineKeyboardMarkup:
    prefix = "task:priority" if task_id is None else f"task:set-priority:{task_id}"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=translate(f"priority_{value}", language),
                    callback_data=f"{prefix}:{value}",
                )
                for value in ("low", "medium", "high")
            ]
        ]
    )


def weekdays_menu(
    selected: set[int],
    language: str,
    *,
    callback_prefix: str = "task:weekday",
    done_callback: str = "task:weekdays:done",
) -> InlineKeyboardMarkup:
    day_order = (6, 7, 1, 2, 3, 4, 5) if language == "fa" else tuple(range(1, 8))
    buttons = [
        InlineKeyboardButton(
            text=("✅ " if day in selected else "") + translate(f"weekday_{day}", language),
            callback_data=f"{callback_prefix}:{day}",
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
                    callback_data=done_callback,
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


def task_management_keyboard(tasks: list[Task], language: str) -> InlineKeyboardMarkup:
    def icon(task: Task) -> str:
        if task.completed:
            return "☑️ "
        return "🔁 " if task.repeat_type == "weekdays" else "📌 "

    rows = [
        [
            InlineKeyboardButton(
                text=icon(task) + task.title[:38],
                callback_data=f"task:view:{task.id}",
            )
        ]
        for task in tasks
    ]
    rows.append(
        [InlineKeyboardButton(text=translate("task_back", language), callback_data="task:home")]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def task_detail_keyboard(task: Task, language: str) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    if not task.completed:
        rows.extend(
            [
                [
                    InlineKeyboardButton(
                        text=translate("task_edit_title", language),
                        callback_data=f"task:edit:title:{task.id}",
                    ),
                    InlineKeyboardButton(
                        text=translate("task_edit_priority", language),
                        callback_data=f"task:edit:priority:{task.id}",
                    ),
                ],
                [
                    InlineKeyboardButton(
                        text=translate("task_edit_schedule", language),
                        callback_data=f"task:edit:schedule:{task.id}",
                    )
                ],
            ]
        )
    rows.extend(
        [
            [
                InlineKeyboardButton(
                    text=translate("task_delete", language),
                    callback_data=f"task:delete:{task.id}",
                )
            ],
            [
                InlineKeyboardButton(
                    text=translate("task_back", language), callback_data="task:manage"
                )
            ],
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def delete_confirmation_keyboard(task_id: int, language: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=translate("task_delete_confirm", language),
                    callback_data=f"task:delete-confirm:{task_id}",
                ),
                InlineKeyboardButton(
                    text=translate("task_delete_cancel", language),
                    callback_data=f"task:view:{task_id}",
                ),
            ]
        ]
    )
