from datetime import datetime
from typing import Literal

from sqlalchemy import Select, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import Task, TaskCompletion, User

TaskPriority = Literal["low", "medium", "high"]


class TaskNotFoundError(Exception):
    pass


async def create_task(
    session: AsyncSession,
    telegram_id: int,
    title: str,
    priority: TaskPriority,
    deadline: datetime | None = None,
) -> Task:
    title = title.strip()
    if not 1 <= len(title) <= 500:
        raise ValueError("Task title must contain 1-500 characters")
    if priority not in {"low", "medium", "high"}:
        raise ValueError("Unknown task priority")
    if deadline is not None and deadline.tzinfo is None:
        raise ValueError("Task deadline must be timezone-aware")
    user_id = await _user_id(session, telegram_id)
    task = Task(user_id=user_id, title=title, priority=priority, deadline=deadline)
    session.add(task)
    await session.flush()
    return task


async def list_open_tasks(
    session: AsyncSession, telegram_id: int, *, limit: int = 20
) -> list[Task]:
    if not 1 <= limit <= 100:
        raise ValueError("Task list limit must be between 1 and 100")
    user_id = await _user_id(session, telegram_id)
    statement: Select[tuple[Task]] = (
        select(Task)
        .where(Task.user_id == user_id, Task.completed.is_(False))
        .order_by(Task.deadline.is_(None), Task.deadline, Task.id)
        .limit(limit)
    )
    return list(await session.scalars(statement))


async def complete_task(session: AsyncSession, telegram_id: int, task_id: int) -> bool:
    user_id = await _user_id(session, telegram_id)
    result = await session.execute(
        update(Task)
        .where(Task.id == task_id, Task.user_id == user_id, Task.completed.is_(False))
        .values(completed=True)
        .returning(Task.id)
    )
    completed_task_id = result.scalar_one_or_none()
    if completed_task_id is None:
        owned_task = await session.scalar(
            select(Task.id).where(Task.id == task_id, Task.user_id == user_id)
        )
        if owned_task is None:
            raise TaskNotFoundError
        return False
    session.add(TaskCompletion(task_id=completed_task_id, user_id=user_id))
    await session.flush()
    return True


async def _user_id(session: AsyncSession, telegram_id: int) -> int:
    user_id = await session.scalar(select(User.id).where(User.telegram_id == telegram_id))
    if user_id is None:
        raise ValueError("Telegram user must be registered before task operations")
    return user_id
