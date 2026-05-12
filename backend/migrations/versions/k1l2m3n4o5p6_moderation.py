"""add user_blocks + content_reports + users.is_admin (UGC moderation)

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-05-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'k1l2m3n4o5p6'
down_revision: Union[str, None] = 'j0k1l2m3n4o5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users.is_admin ────────────────────────────────────────────────────────
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # ── user_blocks ───────────────────────────────────────────────────────────
    op.create_table(
        "user_blocks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("blocker_user_id", sa.String(length=64), nullable=False),
        sa.Column("blocked_user_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_user_blocks_blocker", "user_blocks", ["blocker_user_id"])
    op.create_index("ix_user_blocks_blocked", "user_blocks", ["blocked_user_id"])
    # A user can only block another user once.
    op.create_index(
        "ix_user_blocks_pair",
        "user_blocks",
        ["blocker_user_id", "blocked_user_id"],
        unique=True,
    )

    # ── content_reports ───────────────────────────────────────────────────────
    op.create_table(
        "content_reports",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("reporter_user_id", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=16), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by_user_id", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_content_reports_reporter", "content_reports", ["reporter_user_id"])
    op.create_index("ix_content_reports_target", "content_reports", ["target_id"])
    op.create_index("ix_content_reports_status", "content_reports", ["status"])


def downgrade() -> None:
    op.drop_index("ix_content_reports_status", table_name="content_reports")
    op.drop_index("ix_content_reports_target", table_name="content_reports")
    op.drop_index("ix_content_reports_reporter", table_name="content_reports")
    op.drop_table("content_reports")
    op.drop_index("ix_user_blocks_pair", table_name="user_blocks")
    op.drop_index("ix_user_blocks_blocked", table_name="user_blocks")
    op.drop_index("ix_user_blocks_blocker", table_name="user_blocks")
    op.drop_table("user_blocks")
    op.drop_column("users", "is_admin")
