import pytest_asyncio

from app.database.models import Base
from app.database.session import create_engine, session_factory


@pytest_asyncio.fixture
async def sessions():
    engine = create_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield session_factory(engine)
    await engine.dispose()
