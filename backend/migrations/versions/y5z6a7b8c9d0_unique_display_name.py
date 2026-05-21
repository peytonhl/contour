"""make display_name case-insensitively unique

Backs the "edit display name" feature on the Settings page. Users can now
adjust their visible name (previously locked to whatever Google / Apple
returned at signup); for that to play nicely with @-mentions (next
migration) we need the name to be unique enough that a single mention
token resolves to one user. Case-insensitive so "peyton" and "Peyton" are
treated as the same handle.

Strategy:
  1. Backfill any existing collisions by appending "_<n>" to later
     rows in each lower-cased-name group (ordered by created_at, then id
     as a stable tiebreaker). The first user with a given lowercased name
     keeps it as-is; subsequent ones get suffixed.
  2. Create a unique functional index on LOWER(display_name). Works on
     both Postgres (prod) and SQLite (local dev, 3.25+ for the window
     function CTE in the backfill step).

Revision ID: y5z6a7b8c9d0
Revises: x4y5z6a7b8c9
Create Date: 2026-05-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "y5z6a7b8c9d0"
down_revision: Union[str, None] = "x4y5z6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # 1. Backfill collisions. Postgres supports the UPDATE...FROM CTE
    # pattern; SQLite needs an equivalent rewrite using a subquery in SET.
    if dialect == "postgresql":
        bind.execute(sa.text("""
            WITH ranked AS (
                SELECT id,
                       display_name,
                       ROW_NUMBER() OVER (
                         PARTITION BY LOWER(display_name)
                         ORDER BY created_at, id
                       ) AS rn
                FROM users
            )
            UPDATE users u
            SET display_name = u.display_name || '_' || r.rn
            FROM ranked r
            WHERE u.id = r.id AND r.rn > 1
        """))
    else:
        # SQLite path — wrap the window function in a subquery, then UPDATE
        # via correlated subquery. Less efficient but works on the dev DB.
        bind.execute(sa.text("""
            UPDATE users
            SET display_name = display_name || '_' || (
                SELECT rn FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                             PARTITION BY LOWER(display_name)
                             ORDER BY created_at, id
                           ) AS rn
                    FROM users
                ) AS ranked
                WHERE ranked.id = users.id
            )
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                             PARTITION BY LOWER(display_name)
                             ORDER BY created_at, id
                           ) AS rn
                    FROM users
                ) AS ranked
                WHERE ranked.rn > 1
            )
        """))

    # 2. Create the unique functional index. The expression form is
    # supported by both backends.
    op.create_index(
        "ix_users_display_name_lower_unique",
        "users",
        [sa.text("LOWER(display_name)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_users_display_name_lower_unique", table_name="users")
    # The "_<n>" suffixes from upgrade() are not reversed — they're now
    # part of the visible names and removing them would risk new collisions.
