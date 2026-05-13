"""drop artist_favorites table

Drops the `artist_favorites` table after the Favorites feature was cut
from the product. The feature was a duplicate taxonomy for 5★ artist
ratings — see the positioning audit (commit abd5dfc).

The table was originally created by `Base.metadata.create_all` at startup
rather than via a tracked Alembic migration, so `op.drop_table` is the
first time it appears in the migration chain. `IF EXISTS` keeps the
downgrade and any fresh-DB scenario safe.

Revision ID: s9t0u1v2w3x4
Revises: r8s9t0u1v2w3
Create Date: 2026-05-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 's9t0u1v2w3x4'
down_revision: Union[str, None] = 'r8s9t0u1v2w3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use the bind's inspector so the drop is a no-op on a fresh DB where
    # the model has already been removed before create_all ran.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "artist_favorites" in inspector.get_table_names():
        op.drop_table("artist_favorites")


def downgrade() -> None:
    op.create_table(
        "artist_favorites",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("artist_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_artist_favorites_user_id", "artist_favorites", ["user_id"])
    op.create_index("ix_artist_favorites_artist_id", "artist_favorites", ["artist_id"])
