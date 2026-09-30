from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import User


async def register_user(
    session: AsyncSession, telegram_id: int, username: str | None, language: str
) -> User:
    """Atomic upsert; repeated starts preserve the user's chosen language."""
    dialect = session.get_bind().dialect.name
    insert = sqlite_insert if dialect == "sqlite" else postgres_insert
    statement = insert(User).values(telegram_id=telegram_id, username=username, language=language)
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[User.telegram_id], set_={"username": username}
        )
    )
    return (
        await session.scalars(
            select(User)
            .where(User.telegram_id == telegram_id)
            .execution_options(populate_existing=True)
        )
    ).one()
