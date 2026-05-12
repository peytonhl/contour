"""add saved_comparisons.name_c (optional Side C)

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-05-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'l2m3n4o5p6q7'
down_revision: Union[str, None] = 'k1l2m3n4o5p6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "saved_comparisons",
        sa.Column("name_c", sa.String(length=256), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("saved_comparisons", "name_c")
