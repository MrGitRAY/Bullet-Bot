"""support recurring task occurrences"""

import sqlalchemy as sa
from alembic import op

revision = "bb021a4b11d9"
down_revision = "1a25ffb0f172"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("task_completions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("occurrence_date", sa.Date(), nullable=True))

    op.execute(
        sa.text(
            "UPDATE task_completions "
            "SET occurrence_date = date(completed_at) "
            "WHERE occurrence_date IS NULL"
        )
    )

    with op.batch_alter_table("task_completions", schema=None) as batch_op:
        batch_op.alter_column("occurrence_date", existing_type=sa.Date(), nullable=False)
        batch_op.create_unique_constraint(
            batch_op.f("uq_task_completions_task_id"),
            ["task_id", "occurrence_date"],
        )


def downgrade() -> None:
    with op.batch_alter_table("task_completions", schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f("uq_task_completions_task_id"), type_="unique")
        batch_op.drop_column("occurrence_date")
