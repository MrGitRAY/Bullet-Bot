import os
import sqlite3
import subprocess
import sys


def test_migration_round_trip(tmp_path):
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}"}
    for command in (("upgrade", "head"), ("check",), ("downgrade", "base"), ("upgrade", "head")):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", *command], env=env, capture_output=True, text=True
        )
        assert result.returncode == 0, result.stdout + result.stderr


def test_recurring_migration_backfills_existing_completion(tmp_path):
    database = tmp_path / "existing.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{database.as_posix()}"}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "1a25ffb0f172"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr

    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO users "
            "(telegram_id, username, language, xp, level) "
            "VALUES (1, NULL, 'en', 0, 1)"
        )
        connection.execute(
            "INSERT INTO tasks "
            "(user_id, project_id, title, priority, deadline, reminder_time, "
            "repeat_type, repeat_config, completed) "
            "VALUES (1, NULL, 'Legacy', 'medium', NULL, NULL, 'none', NULL, 1)"
        )
        connection.execute(
            "INSERT INTO task_completions (task_id, user_id, completed_at) "
            "VALUES (1, 1, '2026-09-30 20:30:00')"
        )

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    with sqlite3.connect(database) as connection:
        occurrence_date = connection.execute(
            "SELECT occurrence_date FROM task_completions"
        ).fetchone()
    assert occurrence_date == ("2026-09-30",)
