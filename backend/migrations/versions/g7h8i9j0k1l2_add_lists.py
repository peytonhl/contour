"""add user_lists and user_list_items tables

Revision ID: g7h8i9j0k1l2
Revises: f6a7b8c9d0e1
Create Date: 2025-05-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'g7h8i9j0k1l2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_lists",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(64), nullable=False, index=True),
        sa.Column("title", sa.String(256), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_ranked", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "user_list_items",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("list_id", sa.Integer, nullable=False, index=True),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("entity_type", sa.String(16), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("note", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("user_list_items")
    op.drop_table("user_lists")
