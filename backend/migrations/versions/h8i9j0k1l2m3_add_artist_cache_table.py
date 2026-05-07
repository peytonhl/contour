"""add artist_cache table

Revision ID: h8i9j0k1l2m3
Revises: 7408f29eb6e3
Create Date: 2026-05-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'h8i9j0k1l2m3'
down_revision: Union[str, None] = '7408f29eb6e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('artist_cache',
    sa.Column('spotify_id', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=256), nullable=False),
    sa.Column('discography_fetched_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('spotify_id')
    )


def downgrade() -> None:
    op.drop_table('artist_cache')
