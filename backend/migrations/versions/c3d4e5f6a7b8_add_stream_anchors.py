"""add stream_anchors and anchor_fetch_status tables

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2025-05-03
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stream_anchors",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("entity_id", sa.String(64), nullable=False, index=True),
        sa.Column("entity_type", sa.String(16), nullable=False),
        sa.Column("snapshot_date", sa.String(16), nullable=False),
        sa.Column("stream_count", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_stream_anchors_entity",
        "stream_anchors",
        ["entity_id", "entity_type", "snapshot_date"],
    )

    op.create_table(
        "anchor_fetch_status",
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("entity_type", sa.String(16), nullable=False),
        sa.Column("kworb_daily_fetched_at", sa.DateTime(), nullable=True),
        sa.Column("wayback_fetched_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("entity_id", "entity_type"),
    )


def downgrade() -> None:
    op.drop_table("anchor_fetch_status")
    op.drop_index("ix_stream_anchors_entity", table_name="stream_anchors")
    op.drop_table("stream_anchors")
