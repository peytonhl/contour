"""add import_logs, backlog_items, search_events tables

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
    # ── import_logs ───────────────────────────────────────────────────────────
    op.create_table(
        "import_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("file_name", sa.String(length=256), nullable=True),
        sa.Column("matched_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unmatched_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_import_logs_user", "import_logs", ["user_id"])

    # ── backlog_items ─────────────────────────────────────────────────────────
    op.create_table(
        "backlog_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("album_id", sa.String(length=64), nullable=False),
        sa.Column("added_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("note", sa.Text(), nullable=True),
    )
    op.create_index("ix_backlog_items_user", "backlog_items", ["user_id"])
    op.create_index("ix_backlog_items_album", "backlog_items", ["album_id"])
    # One row per (user, album) — toggling on/off rather than stacking duplicates.
    op.create_index(
        "ix_backlog_items_user_album",
        "backlog_items",
        ["user_id", "album_id"],
        unique=True,
    )

    # ── search_events ─────────────────────────────────────────────────────────
    op.create_table(
        "search_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("query", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_search_events_query", "search_events", ["query"])
    op.create_index("ix_search_events_created_at", "search_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_search_events_created_at", table_name="search_events")
    op.drop_index("ix_search_events_query", table_name="search_events")
    op.drop_table("search_events")
    op.drop_index("ix_backlog_items_user_album", table_name="backlog_items")
    op.drop_index("ix_backlog_items_album", table_name="backlog_items")
    op.drop_index("ix_backlog_items_user", table_name="backlog_items")
    op.drop_table("backlog_items")
    op.drop_index("ix_import_logs_user", table_name="import_logs")
    op.drop_table("import_logs")
