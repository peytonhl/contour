"""clear negative Apple Music match rows (legacy from pre-fix behavior)

Older code wrote a row with apple_music_id=NULL whenever a match failed,
which permanently hid the "Apple Music ↗" button even after a fix to the
underlying issue (e.g. env vars correctly set on Railway). The router now
only persists positive matches, but existing negative rows are still in the
DB and would short-circuit lookups via the legacy cached_link path if any
fallback path consults them. This migration purges them; future failed
matches simply don't write a row, so retry-on-next-view becomes automatic.

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-05-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'm3n4o5p6q7r8'
down_revision: Union[str, None] = 'l2m3n4o5p6q7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM apple_music_links WHERE apple_music_id IS NULL")


def downgrade() -> None:
    # No-op: we don't restore deleted rows. The data was negative-cache
    # noise; if matching ever fails again, the new code skips persistence
    # entirely so nothing to restore.
    pass
