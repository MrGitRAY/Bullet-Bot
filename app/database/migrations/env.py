import asyncio
import os

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import Connection

from app.database.models import Base
from app.database.session import create_engine

load_dotenv()
url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./data/bullet.db")


def run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        render_as_batch=connection.dialect.name == "sqlite",
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_online() -> None:
    engine = create_engine(url)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(run_migrations)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(run_online())
