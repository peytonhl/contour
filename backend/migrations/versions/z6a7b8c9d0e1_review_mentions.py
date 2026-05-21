"""add mention_user_ids to reviews + review_replies

Backs the @-mention feature. When a user types `@someone` in a review or
reply body, the backend resolves matching users (case-insensitive against
the now-unique display_name from migration y5z6a7b8c9d0) and persists
the resulting user IDs in `mention_user_ids` as a JSON array of strings.

Why store the IDs rather than parse on read:
  - Resolution happens once at write time against the current user table;
    if a mentioned user later renames themselves the link stays correct.
  - Notification dispatch needs the IDs explicitly — parsing on read
    would require running the resolver on every reviewfeed render.
  - Cheap to filter "reviews mentioning user X" for future timeline
    features without adding a parser to every reader.

Nullable Text columns, JSON-encoded array of user UUIDs. Empty / missing =
no mentions (the most common case).

Revision ID: z6a7b8c9d0e1
Revises: y5z6a7b8c9d0
Create Date: 2026-05-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "z6a7b8c9d0e1"
down_revision: Union[str, None] = "y5z6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "reviews",
        sa.Column("mention_user_ids", sa.Text(), nullable=True),
    )
    op.add_column(
        "review_replies",
        sa.Column("mention_user_ids", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_replies", "mention_user_ids")
    op.drop_column("reviews", "mention_user_ids")
