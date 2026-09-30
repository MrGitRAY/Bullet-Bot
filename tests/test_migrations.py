import os
import subprocess
import sys


def test_migration_round_trip(tmp_path):
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}"}
    for command in (("upgrade", "head"), ("check",), ("downgrade", "base"), ("upgrade", "head")):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", *command], env=env, capture_output=True, text=True
        )
        assert result.returncode == 0, result.stdout + result.stderr
