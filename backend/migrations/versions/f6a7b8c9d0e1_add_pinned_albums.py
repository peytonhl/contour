"""add pinned_album_ids column to users

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2025-05-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("pinned_album_ids", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("users", "pinned_album_ids")
