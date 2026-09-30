from pathlib import Path
from typing import Any

from sqlalchemy import Connection, event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def create_engine(url: str) -> AsyncEngine:
    parsed = make_url(url)
    if parsed.drivername == "sqlite+aiosqlite" and parsed.database not in (None, "", ":memory:"):
        Path(parsed.database).parent.mkdir(parents=True, exist_ok=True)
    engine = create_async_engine(url, pool_pre_ping=True)
    if parsed.get_backend_name() == "sqlite":

        @event.listens_for(engine.sync_engine, "connect")
        def configure_sqlite(connection: Any, _: Any) -> None:
            # Let SQLAlchemy emit BEGIN so SAVEPOINTs participate in rollback.
            connection.isolation_level = None
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()

        @event.listens_for(engine.sync_engine, "begin")
        def begin_sqlite(connection: Connection) -> None:
            connection.exec_driver_sql("BEGIN")

    return engine


def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
