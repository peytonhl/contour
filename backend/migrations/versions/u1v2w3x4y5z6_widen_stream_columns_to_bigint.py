"""widen stream-count columns from INT4 to INT8 (BigInteger)

Production was rejecting every stream count > 2,147,483,647 with
    asyncpg.DataError: invalid input for query argument $1:
    <value> (value out of int32 range)
That's every popular album: UTOPIA ~7B, Astroworld ~11B, folklore,
Donda, ASTROWORLD, etc. The DataError rolled back the UPDATE, the row
stayed pending, and no diagnostic surfaced until save_stats showed
commit_failed_total ticking up with the asyncpg exception in
last_call_outcome.

Two columns hold raw stream counts and need to widen to int64:

  album_cache.kworb_streams    — lifetime Spotify streams per album
  stream_anchors.stream_count  — trajectory anchor data points

No data conversion needed — every existing int32 value fits losslessly
in int64. PostgreSQL's ALTER COLUMN TYPE int8 USING int8(...) is fast
when the source type already fits the destination domain.

Downgrade narrows back to INTEGER. NOT safe if any row already holds a
value > 2.1B at that point — would raise on ALTER. Acceptable because
this is a one-way fix in practice.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'u1v2w3x4y5z6'
down_revision: Union[str, None] = 't0u1v2w3x4y5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "album_cache",
        "kworb_streams",
        type_=sa.BigInteger(),
        existing_type=sa.Integer(),
        existing_nullable=True,
    )
    op.alter_column(
        "stream_anchors",
        "stream_count",
        type_=sa.BigInteger(),
        existing_type=sa.Integer(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "stream_anchors",
        "stream_count",
        type_=sa.Integer(),
        existing_type=sa.BigInteger(),
        existing_nullable=False,
    )
    op.alter_column(
        "album_cache",
        "kworb_streams",
        type_=sa.Integer(),
        existing_type=sa.BigInteger(),
        existing_nullable=True,
    )
