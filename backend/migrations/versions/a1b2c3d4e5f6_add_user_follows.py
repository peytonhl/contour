"""add user_follows table

Revision ID: a1b2c3d4e5f6
Revises: fc741db5ee7b
Create Date: 2026-05-03 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'fc741db5ee7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_follows',
        sa.Column('follower_id', sa.String(64), nullable=False),
        sa.Column('following_id', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('follower_id', 'following_id'),
    )


def downgrade() -> None:
    op.drop_table('user_follows')
