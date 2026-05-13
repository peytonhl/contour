"""threaded review replies — add parent_reply_id

Adds `parent_reply_id` to `review_replies` so a reply can target another
reply, enabling Reddit-style nested threading. NULL means top-level
(replies directly to the review). Existing rows are left NULL so all
historical replies become top-level threads — no data migration needed.

Revision ID: r8s9t0u1v2w3
Revises: q7r8s9t0u1v2
Create Date: 2026-05-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'r8s9t0u1v2w3'
down_revision: Union[str, None] = 'q7r8s9t0u1v2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'review_replies',
        sa.Column('parent_reply_id', sa.Integer(), nullable=True),
    )
    # Indexed so building a reply tree for a given review (load all replies,
    # group by parent_reply_id) stays cheap even when threads get long.
    op.create_index(
        'ix_review_replies_parent_reply_id',
        'review_replies',
        ['parent_reply_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_review_replies_parent_reply_id', table_name='review_replies')
    op.drop_column('review_replies', 'parent_reply_id')
