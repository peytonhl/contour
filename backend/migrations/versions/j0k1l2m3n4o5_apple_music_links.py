"""add apple_music_links table

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-05-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'j0k1l2m3n4o5'
down_revision: Union[str, None] = 'i9j0k1l2m3n4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "apple_music_links",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("spotify_id", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=16), nullable=False),
        sa.Column("apple_music_id", sa.String(length=64), nullable=True),
        sa.Column("storefront", sa.String(length=8), nullable=False, server_default="us"),
        sa.Column("match_method", sa.String(length=16), nullable=False, server_default="none"),
        sa.Column("matched_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_apple_music_links_spotify_id", "apple_music_links", ["spotify_id"])
    # Uniqueness per (spotify_id, entity_type, storefront) so we cache one
    # mapping per market without blocking future multi-storefront support.
    op.create_index(
        "ix_apple_music_links_lookup",
        "apple_music_links",
        ["spotify_id", "entity_type", "storefront"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_apple_music_links_lookup", table_name="apple_music_links")
    op.drop_index("ix_apple_music_links_spotify_id", table_name="apple_music_links")
    op.drop_table("apple_music_links")
