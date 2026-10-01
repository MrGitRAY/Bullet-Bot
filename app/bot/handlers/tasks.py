from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.i18n import translate
from app.bot.keyboards.tasks import (
    delete_confirmation_keyboard,
    priority_menu,
    task_detail_keyboard,
    task_kind_menu,
    task_list_keyboard,
    task_management_keyboard,
    task_menu,
    weekdays_menu,
)
from app.bot.states.task import CreateTask, EditTask
from app.config.settings import Settings
from app.database.models import Task, User
from app.services.task_service import (
    TaskCompletedError,
    TaskNotFoundError,
    TaskNotScheduledError,
    complete_task,
    create_task,
    delete_task,
    get_task,
    list_open_tasks,
    list_tasks,
    update_task_priority,
    update_task_schedule,
    update_task_title,
)
from app.services.user_service import register_user


def create_router() -> Router:
    router = Router(name="tasks")
    router.message.register(cancel, Command("cancel"))
    router.message.register(open_tasks, Command("task"))
    router.message.register(open_tasks, F.text.in_({"📋 Tasks", "📋 کارها"}))
    router.callback_query.register(begin_create, F.data == "task:add")
    router.callback_query.register(show_task_home, F.data == "task:home")
    router.callback_query.register(show_tasks, F.data == "task:list")
    router.callback_query.register(show_management, F.data == "task:manage")
    router.callback_query.register(show_detail, F.data.regexp(r"^task:view:\d+$"))
    router.callback_query.register(begin_edit_title, F.data.regexp(r"^task:edit:title:\d+$"))
    router.callback_query.register(begin_edit_priority, F.data.regexp(r"^task:edit:priority:\d+$"))
    router.callback_query.register(
        set_priority, F.data.regexp(r"^task:set-priority:\d+:(low|medium|high)$")
    )
    router.callback_query.register(begin_edit_schedule, F.data.regexp(r"^task:edit:schedule:\d+$"))
    router.callback_query.register(ask_delete, F.data.regexp(r"^task:delete:\d+$"))
    router.callback_query.register(confirm_delete, F.data.regexp(r"^task:delete-confirm:\d+$"))
    router.callback_query.register(receive_kind, CreateTask.kind, F.data.startswith("task:kind:"))
    router.message.register(receive_title, CreateTask.title)
    router.callback_query.register(
        receive_priority, CreateTask.priority, F.data.startswith("task:priority:")
    )
    router.message.register(receive_deadline, CreateTask.deadline)
    router.callback_query.register(
        toggle_weekday, CreateTask.weekdays, F.data.regexp(r"^task:weekday:[1-7]$")
    )
    router.callback_query.register(
        finish_weekdays, CreateTask.weekdays, F.data == "task:weekdays:done"
    )
    router.message.register(receive_edit_title, EditTask.title)
    router.message.register(receive_edit_deadline, EditTask.deadline)
    router.callback_query.register(
        toggle_edit_weekday,
        EditTask.weekdays,
        F.data.regexp(r"^task:edit-weekday:[1-7]$"),
    )
    router.callback_query.register(
        finish_edit_weekdays,
        EditTask.weekdays,
        F.data == "task:edit-weekdays:done",
    )
    router.callback_query.register(mark_complete, F.data.startswith("task:complete:"))
    return router


async def _user(event: Message | CallbackQuery, session: AsyncSession, settings: Settings) -> User:
    actor = event.from_user
    language = (
        actor.language_code if actor.language_code in {"fa", "en"} else settings.default_language
    )
    return await register_user(session, actor.id, actor.username, language)


def _today(settings: Settings) -> date:
    return datetime.now(ZoneInfo(settings.timezone)).date()


async def open_tasks(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    user = await _user(message, session, settings)
    await state.clear()
    await message.answer(
        translate("task_menu", user.language), reply_markup=task_menu(user.language)
    )


async def begin_create(
    query: CallbackQuery,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    user = await _user(query, session, settings)
    await state.clear()
    await state.update_data(language=user.language)
    await state.set_state(CreateTask.kind)
    await query.answer()
    if query.message:
        await query.message.answer(
            translate("task_kind_prompt", user.language),
            reply_markup=task_kind_menu(user.language),
        )


async def show_task_home(
    query: CallbackQuery, state: FSMContext, session: AsyncSession, settings: Settings
) -> None:
    user = await _user(query, session, settings)
    await state.clear()
    await query.answer()
    if query.message:
        await query.message.edit_text(
            translate("task_menu", user.language),
            reply_markup=task_menu(user.language),
        )


async def receive_kind(query: CallbackQuery, state: FSMContext) -> None:
    kind = (query.data or "").rsplit(":", 1)[-1]
    if kind not in {"one_time", "weekly"}:
        await query.answer()
        return
    data = await state.get_data()
    await state.update_data(kind=kind)
    await state.set_state(CreateTask.title)
    await query.answer()
    if query.message:
        await query.message.answer(translate("task_title_prompt", data["language"]))


async def receive_title(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    user = await _user(message, session, settings)
    title = (message.text or "").strip()
    if not 1 <= len(title) <= 500:
        await message.answer(translate("task_title_invalid", user.language))
        return
    await state.update_data(title=title, language=user.language)
    await state.set_state(CreateTask.priority)
    await message.answer(
        translate("task_priority_prompt", user.language),
        reply_markup=priority_menu(user.language),
    )


async def receive_priority(query: CallbackQuery, state: FSMContext) -> None:
    priority = (query.data or "").rsplit(":", 1)[-1]
    if priority not in {"low", "medium", "high"}:
        await query.answer()
        return
    data = await state.get_data()
    language = data["language"]
    await state.update_data(priority=priority)
    await query.answer()
    if not query.message:
        return
    if data["kind"] == "one_time":
        await state.set_state(CreateTask.deadline)
        await query.message.answer(translate("task_deadline_prompt", language))
    else:
        await state.update_data(weekdays=[])
        await state.set_state(CreateTask.weekdays)
        await query.message.answer(
            translate("task_weekdays_prompt", language),
            reply_markup=weekdays_menu(set(), language),
        )


async def receive_deadline(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    data = await state.get_data()
    language = data["language"]
    try:
        local_date = datetime.strptime((message.text or "").strip(), "%Y-%m-%d").date()
    except ValueError:
        await message.answer(translate("task_deadline_invalid", language))
        return
    deadline = datetime.combine(local_date, time(23, 59, 59), ZoneInfo(settings.timezone))
    await _finish_creation(
        message,
        state,
        session,
        telegram_id=message.from_user.id,
        deadline=deadline.astimezone(UTC),
    )


async def toggle_weekday(query: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    selected = set(data.get("weekdays", []))
    day = int((query.data or "").rsplit(":", 1)[-1])
    selected.symmetric_difference_update({day})
    await state.update_data(weekdays=sorted(selected))
    await query.answer()
    if query.message:
        await query.message.edit_reply_markup(
            reply_markup=weekdays_menu(selected, data["language"])
        )


async def finish_weekdays(query: CallbackQuery, state: FSMContext, session: AsyncSession) -> None:
    data = await state.get_data()
    if not data.get("weekdays"):
        await query.answer(translate("task_weekdays_required", data["language"]), show_alert=True)
        return
    await query.answer()
    if query.message:
        await _finish_creation(
            query.message,
            state,
            session,
            telegram_id=query.from_user.id,
            deadline=None,
        )


async def _finish_creation(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    *,
    telegram_id: int,
    deadline: datetime | None,
) -> None:
    data = await state.get_data()
    task = await create_task(
        session,
        telegram_id,
        data["title"],
        data["priority"],
        kind=data["kind"],
        deadline=deadline,
        weekdays=data.get("weekdays"),
    )
    await state.clear()
    await message.answer(translate("task_created", data["language"]).format(title=task.title))


async def show_tasks(query: CallbackQuery, session: AsyncSession, settings: Settings) -> None:
    user = await _user(query, session, settings)
    occurrence_date = _today(settings)
    tasks = await list_open_tasks(session, query.from_user.id, occurrence_date=occurrence_date)
    await query.answer()
    if query.message:
        text = translate("task_empty" if not tasks else "task_open", user.language)
        await query.message.edit_text(
            text,
            reply_markup=task_list_keyboard(tasks, user.language, occurrence_date),
        )


async def show_management(query: CallbackQuery, session: AsyncSession, settings: Settings) -> None:
    user = await _user(query, session, settings)
    tasks = await list_tasks(session, query.from_user.id)
    await query.answer()
    if query.message:
        text = translate("task_manage_empty" if not tasks else "task_manage_list", user.language)
        await query.message.edit_text(
            text, reply_markup=task_management_keyboard(tasks, user.language)
        )


def _callback_task_id(query: CallbackQuery) -> int:
    return int((query.data or "").rsplit(":", 1)[-1])


def _task_details(task: Task, language: str, timezone_name: str) -> str:
    kind = translate(
        "task_kind_one_time" if task.repeat_type == "none" else "task_kind_weekly",
        language,
    )
    priority = translate(f"priority_{task.priority}", language)
    if task.repeat_type == "none" and task.deadline:
        deadline = task.deadline
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=UTC)
        schedule = deadline.astimezone(ZoneInfo(timezone_name)).date().isoformat()
    else:
        config = task.repeat_config or {}
        schedule = "، ".join(
            translate(f"weekday_{day}", language)
            for day in config.get("weekdays", [])
            if isinstance(day, int) and day in range(1, 8)
        )
    status = translate("task_status_completed" if task.completed else "task_status_open", language)
    return translate("task_details", language).format(
        title=task.title,
        kind=kind,
        priority=priority,
        schedule=schedule,
        status=status,
    )


async def show_detail(query: CallbackQuery, session: AsyncSession, settings: Settings) -> None:
    user = await _user(query, session, settings)
    try:
        task = await get_task(session, query.from_user.id, _callback_task_id(query))
    except (TaskNotFoundError, ValueError):
        await query.answer(translate("task_not_found", user.language), show_alert=True)
        return
    await query.answer()
    if query.message:
        await query.message.edit_text(
            _task_details(task, user.language, settings.timezone),
            reply_markup=task_detail_keyboard(task, user.language),
        )


async def begin_edit_title(
    query: CallbackQuery,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    user = await _user(query, session, settings)
    try:
        task = await get_task(session, query.from_user.id, _callback_task_id(query))
    except (TaskNotFoundError, ValueError):
        await query.answer(translate("task_not_found", user.language), show_alert=True)
        return
    if task.completed:
        await query.answer(translate("task_edit_completed", user.language), show_alert=True)
        return
    await state.set_state(EditTask.title)
    await state.update_data(task_id=task.id, language=user.language)
    await query.answer()
    if query.message:
        await query.message.answer(translate("task_edit_title_prompt", user.language))


async def receive_edit_title(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    data = await state.get_data()
    try:
        task = await update_task_title(
            session, message.from_user.id, data["task_id"], message.text or ""
        )
    except ValueError:
        await message.answer(translate("task_title_invalid", data["language"]))
        return
    except TaskCompletedError:
        await state.clear()
        await message.answer(translate("task_edit_completed", data["language"]))
        return
    except TaskNotFoundError:
        await state.clear()
        await message.answer(translate("task_not_found", data["language"]))
        return
    await state.clear()
    await message.answer(
        _task_details(task, data["language"], settings.timezone),
        reply_markup=task_detail_keyboard(task, data["language"]),
    )


async def begin_edit_priority(
    query: CallbackQuery, session: AsyncSession, settings: Settings
) -> None:
    user = await _user(query, session, settings)
    try:
        task = await get_task(session, query.from_user.id, _callback_task_id(query))
    except (TaskNotFoundError, ValueError):
        await query.answer(translate("task_not_found", user.language), show_alert=True)
        return
    if task.completed:
        await query.answer(translate("task_edit_completed", user.language), show_alert=True)
        return
    await query.answer()
    if query.message:
        await query.message.edit_reply_markup(
            reply_markup=priority_menu(user.language, task_id=task.id)
        )


async def set_priority(query: CallbackQuery, session: AsyncSession, settings: Settings) -> None:
    user = await _user(query, session, settings)
    try:
        _, _, _, raw_task_id, priority = (query.data or "").split(":", maxsplit=4)
        task = await update_task_priority(session, query.from_user.id, int(raw_task_id), priority)
    except TaskCompletedError:
        await query.answer(translate("task_edit_completed", user.language), show_alert=True)
        return
    except (TaskNotFoundError, ValueError):
        await query.answer(translate("task_not_found", user.language), show_alert=True)
        return
    await query.answer(translate("task_updated", user.language))
    if query.message:
        await query.message.edit_text(
            _task_details(task, user.language, settings.timezone),
            reply_markup=task_detail_keyboard(task, user.language),
        )


async def begin_edit_schedule(
    query: CallbackQuery,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    user = await _user(query, session, settings)
    try:
        task = await get_task(session, query.from_user.id, _callback_task_id(query))
    except (TaskNotFoundError, ValueError):
        await query.answer(translate("task_not_found", user.language), show_alert=True)
        return
    if task.completed:
        await query.answer(translate("task_edit_completed", user.language), show_alert=True)
        return
    await query.answer()
    if task.repeat_type == "none":
        await state.set_state(EditTask.deadline)
        await state.update_data(task_id=task.id, language=user.language)
        if query.message:
            await query.message.answer(translate("task_edit_deadline_prompt", user.language))
        return
    config = task.repeat_config or {}
    selected = {
        day for day in config.get("weekdays", []) if isinstance(day, int) and day in range(1, 8)
    }
    await state.set_state(EditTask.weekdays)
    await state.update_data(task_id=task.id, language=user.language, weekdays=sorted(selected))
    if query.message:
        await query.message.answer(
            translate("task_edit_weekdays_prompt", user.language),
            reply_markup=weekdays_menu(
                selected,
                user.language,
                callback_prefix="task:edit-weekday",
                done_callback="task:edit-weekdays:done",
            ),
        )


async def receive_edit_deadline(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    data = await state.get_data()
    try:
        local_date = datetime.strptime((message.text or "").strip(), "%Y-%m-%d").date()
    except ValueError:
        await message.answer(translate("task_deadline_invalid", data["language"]))
        return
    deadline = datetime.combine(local_date, time(23, 59, 59), ZoneInfo(settings.timezone))
    try:
        task = await update_task_schedule(
            session,
            message.from_user.id,
            data["task_id"],
            deadline=deadline.astimezone(UTC),
        )
    except TaskCompletedError:
        await state.clear()
        await message.answer(translate("task_edit_completed", data["language"]))
        return
    except TaskNotFoundError:
        await state.clear()
        await message.answer(translate("task_not_found", data["language"]))
        return
    await state.clear()
    await message.answer(
        _task_details(task, data["language"], settings.timezone),
        reply_markup=task_detail_keyboard(task, data["language"]),
    )


async def toggle_edit_weekday(query: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    selected = set(data.get("weekdays", []))
    day = int((query.data or "").rsplit(":", 1)[-1])
    selected.symmetric_difference_update({day})
    await state.update_data(weekdays=sorted(selected))
    await query.answer()
    if query.message:
        await query.message.edit_reply_markup(
            reply_markup=weekdays_menu(
                selected,
                data["language"],
                callback_prefix="task:edit-weekday",
                done_callback="task:edit-weekdays:done",
            )
        )


async def finish_edit_weekdays(
    query: CallbackQuery,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    data = await state.get_data()
    if not data.get("weekdays"):
        await query.answer(translate("task_weekdays_required", data["language"]), show_alert=True)
        return
    try:
        task = await update_task_schedule(
            session,
            query.from_user.id,
            data["task_id"],
            weekdays=data["weekdays"],
        )
    except TaskCompletedError:
        await state.clear()
        await query.answer(translate("task_edit_completed", data["language"]), show_alert=True)
        return
    except TaskNotFoundError:
        await state.clear()
        await query.answer(translate("task_not_found", data["language"]), show_alert=True)
        return
    await state.clear()
    await query.answer(translate("task_updated", data["language"]))
    if query.message:
        await query.message.edit_text(
            _task_details(task, data["language"], settings.timezone),
            reply_markup=task_detail_keyboard(task, data["language"]),
        )


async def ask_delete(query: CallbackQuery, session: AsyncSession, settings: Settings) -> None:
    user = await _user(query, session, settings)
    try:
        task = await get_task(session, query.from_user.id, _callback_task_id(query))
    except (TaskNotFoundError, ValueError):
        await query.answer(translate("task_not_found", user.language), show_alert=True)
        return
    await query.answer()
    if query.message:
        await query.message.edit_text(
            translate("task_delete_prompt", user.language).format(title=task.title),
            reply_markup=delete_confirmation_keyboard(task.id, user.language),
        )


async def confirm_delete(query: CallbackQuery, session: AsyncSession, settings: Settings) -> None:
    user = await _user(query, session, settings)
    try:
        await delete_task(session, query.from_user.id, _callback_task_id(query))
    except (TaskNotFoundError, ValueError):
        await query.answer(translate("task_not_found", user.language), show_alert=True)
        return
    await query.answer(translate("task_deleted", user.language))
    tasks = await list_tasks(session, query.from_user.id)
    if query.message:
        text = translate("task_manage_empty" if not tasks else "task_manage_list", user.language)
        await query.message.edit_text(
            text, reply_markup=task_management_keyboard(tasks, user.language)
        )


async def mark_complete(query: CallbackQuery, session: AsyncSession, settings: Settings) -> None:
    user = await _user(query, session, settings)
    try:
        _, _, raw_task_id, raw_date = (query.data or "").split(":", maxsplit=3)
        task_id = int(raw_task_id)
        occurrence_date = date.fromisoformat(raw_date)
        changed = await complete_task(
            session,
            query.from_user.id,
            task_id,
            occurrence_date=occurrence_date,
        )
    except (TaskNotFoundError, TaskNotScheduledError, ValueError):
        await query.answer(translate("task_not_found", user.language), show_alert=True)
        return
    result_key = "task_completed" if changed else "task_already_completed"
    await query.answer(translate(result_key, user.language))
    if query.message:
        today = _today(settings)
        tasks = await list_open_tasks(session, query.from_user.id, occurrence_date=today)
        text = translate("task_empty" if not tasks else "task_open", user.language)
        await query.message.edit_text(
            text, reply_markup=task_list_keyboard(tasks, user.language, today)
        )


async def cancel(
    message: Message,
    state: FSMContext,
    session: AsyncSession,
    settings: Settings,
) -> None:
    user = await _user(message, session, settings)
    await state.clear()
    await message.answer(translate("cancelled", user.language))
