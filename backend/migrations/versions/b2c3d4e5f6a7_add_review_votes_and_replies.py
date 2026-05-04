"""add review_votes and review_replies tables

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2025-05-03
"""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'review_votes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(64), nullable=False),
        sa.Column('review_id', sa.Integer(), nullable=False),
        sa.Column('value', sa.Integer(), nullable=False),  # 1 or -1
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_review_votes_review_id', 'review_votes', ['review_id'])
    op.create_index('ix_review_votes_user_id', 'review_votes', ['user_id'])

    op.create_table(
        'review_replies',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('review_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(64), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_review_replies_review_id', 'review_replies', ['review_id'])
    op.create_index('ix_review_replies_user_id', 'review_replies', ['user_id'])


def downgrade():
    op.drop_table('review_votes')
    op.drop_table('review_replies')
