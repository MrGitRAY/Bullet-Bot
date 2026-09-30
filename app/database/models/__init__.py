from datetime import date, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("xp >= 0 AND level >= 1", name="valid_progress"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    username: Mapped[str | None] = mapped_column(String(64))
    language: Mapped[str] = mapped_column(String(8), default="fa")
    xp: Mapped[int] = mapped_column(default=0)
    level: Mapped[int] = mapped_column(default=1)
    projects: Mapped[list["Project"]] = relationship(back_populates="user", passive_deletes=True)
    tasks: Mapped[list["Task"]] = relationship(back_populates="user", passive_deletes=True)
    task_completions: Mapped[list["TaskCompletion"]] = relationship(
        back_populates="user", passive_deletes=True
    )
    habits: Mapped[list["Habit"]] = relationship(back_populates="user", passive_deletes=True)
    xp_history: Mapped[list["XPHistory"]] = relationship(
        back_populates="user", passive_deletes=True
    )


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    user: Mapped[User] = relationship(back_populates="projects")
    tasks: Mapped[list["Task"]] = relationship(back_populates="project", passive_deletes=True)


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("priority IN ('low', 'medium', 'high')", name="valid_priority"),
        CheckConstraint(
            "repeat_type IN ('none', 'daily', 'weekly', 'weekdays')", name="valid_repeat"
        ),
        Index("ix_tasks_user_completed", "user_id", "completed"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(500))
    priority: Mapped[str] = mapped_column(String(10), default="medium")
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminder_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    repeat_type: Mapped[str] = mapped_column(String(16), default="none")
    repeat_config: Mapped[dict[str, object] | None] = mapped_column(JSON)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    user: Mapped[User] = relationship(back_populates="tasks")
    project: Mapped[Project | None] = relationship(back_populates="tasks")
    completion_history: Mapped[list["TaskCompletion"]] = relationship(
        back_populates="task", passive_deletes=True
    )


class TaskCompletion(Base):
    __tablename__ = "task_completions"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    task: Mapped[Task] = relationship(back_populates="completion_history")
    user: Mapped[User] = relationship(back_populates="task_completions")


class Habit(TimestampMixin, Base):
    __tablename__ = "habits"
    __table_args__ = (
        CheckConstraint(
            "current_streak >= 0 AND best_streak >= current_streak", name="valid_streak"
        ),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    current_streak: Mapped[int] = mapped_column(default=0)
    best_streak: Mapped[int] = mapped_column(default=0)
    user: Mapped[User] = relationship(back_populates="habits")
    logs: Mapped[list["HabitLog"]] = relationship(back_populates="habit", passive_deletes=True)


class HabitLog(Base):
    __tablename__ = "habit_logs"
    __table_args__ = (UniqueConstraint("habit_id", "date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    habit_id: Mapped[int] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    completed: Mapped[bool] = mapped_column(Boolean, default=True)
    habit: Mapped[Habit] = relationship(back_populates="logs")


class XPHistory(TimestampMixin, Base):
    __tablename__ = "xp_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(64))
    amount: Mapped[int] = mapped_column(Integer)
    user: Mapped[User] = relationship(back_populates="xp_history")
