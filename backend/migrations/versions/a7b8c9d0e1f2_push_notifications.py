"""push notifications: device_tokens table + notification_prefs on users

Backs the push-notification rollout. Two related changes in one migration
so prod isn't ever in a half-state (table exists but prefs column doesn't):

1. `device_tokens` — one row per (user_id, token) pair. APNs / FCM device
   tokens are written here on app launch after permission grant; the push
   sender reads from here to fan out a notification to every active token
   the recipient has. Compound unique index on (user_id, token) prevents
   double-registration noise.

   Stale tokens (Apple has rotated them, user uninstalled the app) are
   detected by APNs returning 410 Gone — the push sender deletes those
   rows lazily.

2. `notification_prefs` JSON column on users — per-user per-type opt-out.
   Default null = all enabled (the most common state — we don't want to
   pre-populate a row for every existing user). Stored as JSON for
   forward-compat with future notification types.

Revision ID: a7b8c9d0e1f2
Revises: z6a7b8c9d0e1
Create Date: 2026-05-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "z6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_tokens",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(64), nullable=False, index=True),
        # Apple APNs tokens are 64-char hex; FCM tokens are ~163 chars. 256
        # gives us comfortable headroom for either + any new platform we add.
        sa.Column("token", sa.String(256), nullable=False),
        # "ios" | "android" | future. Recorded so the push sender can pick
        # the right transport (APNs vs FCM) per row.
        sa.Column("platform", sa.String(16), nullable=False),
        sa.Column(
            "last_seen", sa.DateTime(), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False,
            server_default=sa.func.now(),
        ),
    )
    # One token can only be registered to one user — if we see the same
    # token under a different user_id, that's a user switching accounts on
    # the same device and the prior owner should lose receipt. Enforced
    # via a unique index on `token` alone (not the compound), so the
    # register endpoint can use INSERT ... ON CONFLICT to swap user_id.
    op.create_index(
        "ix_device_tokens_token_unique",
        "device_tokens",
        ["token"],
        unique=True,
    )

    op.add_column(
        "users",
        sa.Column("notification_prefs", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "notification_prefs")
    op.drop_index("ix_device_tokens_token_unique", table_name="device_tokens")
    op.drop_table("device_tokens")
