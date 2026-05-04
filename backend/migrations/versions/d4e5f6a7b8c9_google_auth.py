"""switch to Google OAuth: add google_id and email, make spotify_id nullable

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2025-05-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add Google auth columns
    op.add_column("users", sa.Column("google_id", sa.String(128), nullable=True))
    op.add_column("users", sa.Column("email", sa.String(256), nullable=True))

    # Create unique index on google_id
    op.create_index("ix_users_google_id", "users", ["google_id"], unique=True)

    # Make spotify_id nullable (was NOT NULL before)
    op.alter_column("users", "spotify_id", nullable=True)


def downgrade() -> None:
    op.drop_index("ix_users_google_id", table_name="users")
    op.drop_column("users", "email")
    op.drop_column("users", "google_id")
    op.alter_column("users", "spotify_id", nullable=False)
