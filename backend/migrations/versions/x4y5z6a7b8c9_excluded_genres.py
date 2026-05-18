"""add excluded_genres column to user_taste_profiles

Backs the profile-page "Not for me" genre toggle: lets a user hard-exclude
a genre family (e.g. trap, classical) from the For You feed's tier 1
candidate pool BEFORE weighted-sampling spends a query slot on it. Separate
from disliked_artist_ids (which works per-artist) and from the existing
genres column (positive signal) so the negative signal can grow
independently — a user can like "indie" and still exclude "indie folk".

Nullable Text column, JSON-encoded array of genre slugs. Same shape and
read pattern as the existing `genres` column.

Revision ID: x4y5z6a7b8c9
Revises: w3x4y5z6a7b8
Create Date: 2026-05-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'x4y5z6a7b8c9'
down_revision: Union[str, None] = 'w3x4y5z6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_taste_profiles",
        sa.Column("excluded_genres", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_taste_profiles", "excluded_genres")
