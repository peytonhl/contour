"""add review_reply_votes table

Backs the "users can upvote/downvote replies" feature requested
2026-05-22. The table mirrors `review_votes` but keys on reply_id
instead of review_id, so reply votes are stored in a totally separate
table — this is the mechanism by which the review-level "controversial"
sort stays scoped to review votes only (see ratings._controversial_score).
If reply votes lived in `review_votes` with a discriminator column the
controversial scorer would have to learn to filter; keeping them
separate keeps that scorer untouched and the hierarchy explicit.

Composite-uniqueness on (user_id, reply_id) is enforced at the API layer
in `vote_reply` (the endpoint upserts via a SELECT-then-INSERT-or-UPDATE
pattern matching how `vote_review` handles ReviewVote), not via a DB
constraint, so the migration only needs the table + lookup indexes.

Revision ID: a8b9c0d1e2f3
Revises: z6a7b8c9d0e1
Create Date: 2026-05-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8b9c0d1e2f3"
down_revision: Union[str, None] = "z6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "review_reply_votes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("reply_id", sa.Integer(), nullable=False),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_review_reply_votes_user_id", "review_reply_votes", ["user_id"])
    op.create_index("ix_review_reply_votes_reply_id", "review_reply_votes", ["reply_id"])


def downgrade() -> None:
    op.drop_index("ix_review_reply_votes_reply_id", table_name="review_reply_votes")
    op.drop_index("ix_review_reply_votes_user_id", table_name="review_reply_votes")
    op.drop_table("review_reply_votes")
