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
Revises: a7b8c9d0e1f2
Create Date: 2026-05-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8b9c0d1e2f3"
# IMPORTANT: down_revision is a7b8c9d0e1f2 (push_notifications), NOT
# z6a7b8c9d0e1 (review_mentions). I initially set the wrong parent because
# a7b8... lived on the abandoned develop branch's tip when I checked AND
# also on master — but I was looking at develop-vs-master diffs, not at
# what was actually on master. Pointing to z6 created a branching head and
# Alembic refused to start the app on Railway (production down for ~10 min
# until the fix landed). Lesson: `ls backend/migrations/versions/` on
# master is the only authoritative source for the current head.
down_revision: Union[str, None] = "a7b8c9d0e1f2"
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
