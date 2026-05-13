"""add artwork_url to apple_music_links

Adds a sized Apple Music artwork URL alongside the cached Apple ID.
Spotify's image CDN caps at 640×640, which softens on 3x-DPR mobile;
Apple's CDN serves templated URLs up to 3000×3000, so we cache a
1200×1200 substitution for sharp on-device rendering.

Existing rows get NULL artwork_url and are backfilled lazily — on the
next hit to /apple-music/match/... the router fetches by Apple ID and
populates the column. New matches set it inline.

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-05-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 't0u1v2w3x4y5'
down_revision: Union[str, None] = 's9t0u1v2w3x4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: a fresh DB might already have the column via Base.metadata
    # create_all from an earlier startup ordering.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("apple_music_links")}
    if "artwork_url" not in cols:
        op.add_column(
            "apple_music_links",
            sa.Column("artwork_url", sa.String(length=512), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("apple_music_links", "artwork_url")
