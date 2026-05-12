"""extend artist_cache with genres + image_url + popularity for cheap profile-taste reads

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-05-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'p6q7r8s9t0u1'
down_revision: Union[str, None] = 'o5p6q7r8s9t0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("artist_cache", sa.Column("genres", sa.Text(), nullable=True))
    op.add_column("artist_cache", sa.Column("image_url", sa.Text(), nullable=True))
    op.add_column("artist_cache", sa.Column("popularity", sa.Integer(), nullable=True))
    op.add_column("artist_cache", sa.Column("meta_fetched_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("artist_cache", "meta_fetched_at")
    op.drop_column("artist_cache", "popularity")
    op.drop_column("artist_cache", "image_url")
    op.drop_column("artist_cache", "genres")
