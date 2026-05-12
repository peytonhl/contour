"""extend backlog_items to support tracks (entity_type + entity_id)

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-05-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'n4o5p6q7r8s9'
down_revision: Union[str, None] = 'm3n4o5p6q7r8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add entity_type with default "album" so existing rows remain valid.
    op.add_column(
        "backlog_items",
        sa.Column("entity_type", sa.String(length=16), nullable=False, server_default="album"),
    )
    # Rename album_id → entity_id. Postgres rename is atomic and preserves data.
    op.alter_column("backlog_items", "album_id", new_column_name="entity_id")
    # Rebuild the unique index against the renamed column + entity_type pair so
    # one user can save the same Spotify ID twice (once as album, once as track)
    # without conflict — they're semantically different rows.
    op.drop_index("ix_backlog_items_user_album", table_name="backlog_items")
    op.drop_index("ix_backlog_items_album", table_name="backlog_items")
    op.create_index("ix_backlog_items_entity", "backlog_items", ["entity_id"])
    op.create_index(
        "ix_backlog_items_user_entity",
        "backlog_items",
        ["user_id", "entity_type", "entity_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_backlog_items_user_entity", table_name="backlog_items")
    op.drop_index("ix_backlog_items_entity", table_name="backlog_items")
    op.create_index("ix_backlog_items_album", "backlog_items", ["entity_id"])
    op.create_index(
        "ix_backlog_items_user_album",
        "backlog_items",
        ["user_id", "entity_id"],
        unique=True,
    )
    op.alter_column("backlog_items", "entity_id", new_column_name="album_id")
    op.drop_column("backlog_items", "entity_type")
