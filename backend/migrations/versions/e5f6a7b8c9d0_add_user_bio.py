"""add bio column to users

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2025-05-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("bio", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("users", "bio")
