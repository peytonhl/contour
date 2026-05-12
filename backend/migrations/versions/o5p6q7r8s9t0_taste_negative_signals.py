"""extend user_taste_profiles with disliked + down-weighted artist columns

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
Create Date: 2026-05-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'o5p6q7r8s9t0'
down_revision: Union[str, None] = 'n4o5p6q7r8s9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_taste_profiles",
        sa.Column("disliked_artist_ids", sa.Text(), nullable=True),
    )
    op.add_column(
        "user_taste_profiles",
        sa.Column("down_weighted_artist_ids", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_taste_profiles", "down_weighted_artist_ids")
    op.drop_column("user_taste_profiles", "disliked_artist_ids")
