from datetime import date, datetime
from typing import Literal

from sqlalchemy import Select, delete, select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import Task, TaskCompletion, User

TaskPriority = Literal["low", "medium", "high"]
TaskKind = Literal["one_time", "weekly"]


class TaskNotFoundError(Exception):
    pass


class TaskNotScheduledError(Exception):
    pass


class TaskCompletedError(Exception):
    pass


async def create_task(
    session: AsyncSession,
    telegram_id: int,
    title: str,
    priority: TaskPriority,
    *,
    kind: TaskKind,
    deadline: datetime | None = None,
    weekdays: list[int] | None = None,
) -> Task:
    title = title.strip()
    if not 1 <= len(title) <= 500:
        raise ValueError("Task title must contain 1-500 characters")
    if priority not in {"low", "medium", "high"}:
        raise ValueError("Unknown task priority")

    if kind == "one_time":
        if deadline is None or deadline.tzinfo is None:
            raise ValueError("One-time tasks require a timezone-aware deadline")
        repeat_type = "none"
        repeat_config = None
    elif kind == "weekly":
        normalized_days = sorted(set(weekdays or []))
        if not normalized_days or any(day not in range(1, 8) for day in normalized_days):
            raise ValueError("Weekly tasks require weekdays between 1 and 7")
        if deadline is not None:
            raise ValueError("Weekly tasks cannot have a one-time deadline")
        repeat_type = "weekdays"
        repeat_config = {"weekdays": normalized_days}
    else:
        raise ValueError("Unknown task kind")

    user_id = await _user_id(session, telegram_id)
    task = Task(
        user_id=user_id,
        title=title,
        priority=priority,
        deadline=deadline,
        repeat_type=repeat_type,
        repeat_config=repeat_config,
    )
    session.add(task)
    await session.flush()
    return task


async def list_open_tasks(
    session: AsyncSession,
    telegram_id: int,
    *,
    occurrence_date: date,
    limit: int = 20,
) -> list[Task]:
    if not 1 <= limit <= 100:
        raise ValueError("Task list limit must be between 1 and 100")
    user_id = await _user_id(session, telegram_id)
    statement: Select[tuple[Task]] = (
        select(Task)
        .where(Task.user_id == user_id, Task.completed.is_(False))
        .order_by(Task.deadline.is_(None), Task.deadline, Task.id)
    )
    tasks = list(await session.scalars(statement))
    completed_recurring_ids = set(
        await session.scalars(
            select(TaskCompletion.task_id).where(
                TaskCompletion.user_id == user_id,
                TaskCompletion.occurrence_date == occurrence_date,
            )
        )
    )
    visible = [
        task
        for task in tasks
        if task.repeat_type == "none"
        or (
            task.repeat_type == "weekdays"
            and occurrence_date.isoweekday() in _weekdays(task)
            and task.id not in completed_recurring_ids
        )
    ]
    return visible[:limit]


async def list_tasks(session: AsyncSession, telegram_id: int, *, limit: int = 50) -> list[Task]:
    if not 1 <= limit <= 100:
        raise ValueError("Task list limit must be between 1 and 100")
    user_id = await _user_id(session, telegram_id)
    statement = (
        select(Task)
        .where(Task.user_id == user_id)
        .order_by(Task.completed, Task.repeat_type, Task.deadline.is_(None), Task.deadline, Task.id)
        .limit(limit)
    )
    return list(await session.scalars(statement))


async def get_task(session: AsyncSession, telegram_id: int, task_id: int) -> Task:
    user_id = await _user_id(session, telegram_id)
    task = await session.scalar(select(Task).where(Task.id == task_id, Task.user_id == user_id))
    if task is None:
        raise TaskNotFoundError
    return task


async def update_task_title(
    session: AsyncSession, telegram_id: int, task_id: int, title: str
) -> Task:
    task = await get_task(session, telegram_id, task_id)
    _ensure_editable(task)
    title = title.strip()
    if not 1 <= len(title) <= 500:
        raise ValueError("Task title must contain 1-500 characters")
    task.title = title
    await session.flush()
    return task


async def update_task_priority(
    session: AsyncSession,
    telegram_id: int,
    task_id: int,
    priority: TaskPriority,
) -> Task:
    task = await get_task(session, telegram_id, task_id)
    _ensure_editable(task)
    if priority not in {"low", "medium", "high"}:
        raise ValueError("Unknown task priority")
    task.priority = priority
    await session.flush()
    return task


async def update_task_schedule(
    session: AsyncSession,
    telegram_id: int,
    task_id: int,
    *,
    deadline: datetime | None = None,
    weekdays: list[int] | None = None,
) -> Task:
    task = await get_task(session, telegram_id, task_id)
    _ensure_editable(task)
    if task.repeat_type == "none":
        if deadline is None or deadline.tzinfo is None:
            raise ValueError("One-time tasks require a timezone-aware deadline")
        if weekdays is not None:
            raise ValueError("One-time tasks cannot use weekly weekdays")
        task.deadline = deadline
    elif task.repeat_type == "weekdays":
        if deadline is not None:
            raise ValueError("Weekly tasks cannot have a one-time deadline")
        normalized_days = sorted(set(weekdays or []))
        if not normalized_days or any(day not in range(1, 8) for day in normalized_days):
            raise ValueError("Weekly tasks require weekdays between 1 and 7")
        task.repeat_config = {"weekdays": normalized_days}
    else:
        raise ValueError("Unknown task recurrence")
    await session.flush()
    return task


async def delete_task(session: AsyncSession, telegram_id: int, task_id: int) -> None:
    user_id = await _user_id(session, telegram_id)
    deleted_id = (
        await session.execute(
            delete(Task).where(Task.id == task_id, Task.user_id == user_id).returning(Task.id)
        )
    ).scalar_one_or_none()
    if deleted_id is None:
        raise TaskNotFoundError


async def complete_task(
    session: AsyncSession,
    telegram_id: int,
    task_id: int,
    *,
    occurrence_date: date,
) -> bool:
    user_id = await _user_id(session, telegram_id)
    task = await session.scalar(select(Task).where(Task.id == task_id, Task.user_id == user_id))
    if task is None:
        raise TaskNotFoundError

    if task.repeat_type == "none":
        result = await session.execute(
            update(Task)
            .where(Task.id == task.id, Task.completed.is_(False))
            .values(completed=True)
            .returning(Task.id)
        )
        if result.scalar_one_or_none() is None:
            return False
    elif task.repeat_type == "weekdays":
        if occurrence_date.isoweekday() not in _weekdays(task):
            raise TaskNotScheduledError
    else:
        raise TaskNotScheduledError

    insert = sqlite_insert if session.get_bind().dialect.name == "sqlite" else postgres_insert
    statement = (
        insert(TaskCompletion)
        .values(
            task_id=task.id,
            user_id=user_id,
            occurrence_date=occurrence_date,
        )
        .on_conflict_do_nothing(
            index_elements=[TaskCompletion.task_id, TaskCompletion.occurrence_date]
        )
        .returning(TaskCompletion.id)
    )
    completion_id = (await session.execute(statement)).scalar_one_or_none()
    await session.flush()
    return completion_id is not None


def _weekdays(task: Task) -> set[int]:
    config = task.repeat_config or {}
    values = config.get("weekdays", [])
    if not isinstance(values, list):
        return set()
    return {value for value in values if isinstance(value, int) and value in range(1, 8)}


def _ensure_editable(task: Task) -> None:
    if task.completed:
        raise TaskCompletedError


async def _user_id(session: AsyncSession, telegram_id: int) -> int:
    user_id = await session.scalar(select(User.id).where(User.telegram_id == telegram_id))
    if user_id is None:
        raise ValueError("Telegram user must be registered before task operations")
    return user_id
