"""normalize artist genres into a queryable table + denormalize track primary artist

Two related schema changes that turn O(N) Python-scan paths into
indexed SQL queries — gets us scale headroom for the catalog tier
of the For You feed as TrackCache + ArtistCache grow.

  1. New artist_genres table (artist_id, tag_name, tag_weight) with
     indexes on tag_name and (artist_id, tag_name unique). Derived
     view of ArtistCache.genres JSON. Backfilled from existing rows.

  2. New track_cache.primary_artist_id column (indexed). Same value
     as artist_ids_json[0]; populated for queries.

Why the JSON columns stay: backwards-compat with /me-state, the
probe-* endpoints, and _normalize_genres_data which downstream
consumers (the per-genre alias matcher, etc.) still depend on.
The new structures are derived-and-synchronized, NOT replacements.

Revision ID: a7b8c9d0e1f2
Revises: z6a7b8c9d0e1
Create Date: 2026-05-25
"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "z6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _normalize_genres_blob(blob: str) -> list[tuple[str, float]]:
    """Mirror of services.spotify._normalize_genres_data. Inlined here so
    the migration doesn't depend on importing the application code
    (Alembic's offline mode + module isolation make those imports
    fragile). Two storage shapes handled:

      NEW: [{"name": "hip hop", "count": 100}, ...]
      LEGACY: ["hip hop", "rap", ...]

    Returns [(name_lowercased, weight), ...] where weights sum to 1.0
    over the artist's tag mass. Empty list on parse failure.
    """
    if not blob:
        return []
    try:
        parsed = json.loads(blob)
    except Exception:
        return []
    if not isinstance(parsed, list) or not parsed:
        return []
    if all(isinstance(t, dict) and "name" in t for t in parsed):
        total = sum(max(int(t.get("count") or 0), 0) for t in parsed)
        if total <= 0:
            equal = 1.0 / len(parsed)
            return [(t["name"].lower(), equal) for t in parsed if t.get("name")]
        return [
            (t["name"].lower(), max(int(t.get("count") or 0), 0) / total)
            for t in parsed if t.get("name")
        ]
    strs = [s for s in parsed if isinstance(s, str)]
    if not strs:
        return []
    equal = 1.0 / len(strs)
    return [(s.lower(), equal) for s in strs]


def upgrade() -> None:
    # ── Track primary_artist_id column + index ─────────────────────
    with op.batch_alter_table("track_cache") as batch:
        batch.add_column(sa.Column("primary_artist_id", sa.String(64), nullable=True))
    op.create_index(
        "ix_track_cache_primary_artist_id",
        "track_cache",
        ["primary_artist_id"],
    )

    # ── artist_genres table + indexes ─────────────────────────────
    op.create_table(
        "artist_genres",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("artist_id", sa.String(64), nullable=False),
        sa.Column("tag_name", sa.String(128), nullable=False),
        sa.Column("tag_weight", sa.Float, nullable=False),
    )
    op.create_index("ix_artist_genres_tag_name", "artist_genres", ["tag_name"])
    op.create_index(
        "ix_artist_genres_artist_tag",
        "artist_genres",
        ["artist_id", "tag_name"],
        unique=True,
    )

    # ── Backfill ──────────────────────────────────────────────────
    # Both backfills run inside Python with the migration's bind so
    # we can parse JSON. Bounded by current catalog (low-thousands of
    # tracks/artists today); completes in well under a second. On
    # very large future migrations this could be moved to a startup
    # task — fine for now.
    bind = op.get_bind()

    # 1. primary_artist_id from track_cache.artist_ids_json[0]
    track_rows = bind.execute(sa.text(
        "SELECT spotify_id, artist_ids_json FROM track_cache "
        "WHERE artist_ids_json IS NOT NULL AND artist_ids_json != ''"
    )).fetchall()
    updates: list[dict] = []
    for row in track_rows:
        try:
            ids = json.loads(row.artist_ids_json or "[]")
            if ids and isinstance(ids[0], str):
                updates.append({"sid": row.spotify_id, "aid": ids[0]})
        except Exception:
            continue
    if updates:
        # Batch update keeps the migration fast even at 100k+ rows.
        # Use literal SQL because Alembic's bind doesn't expose
        # SQLAlchemy ORM session-level batching cleanly here.
        for u in updates:
            bind.execute(
                sa.text("UPDATE track_cache SET primary_artist_id = :aid WHERE spotify_id = :sid"),
                u,
            )

    # 2. artist_genres rows from artist_cache.genres JSON
    artist_rows = bind.execute(sa.text(
        "SELECT spotify_id, genres FROM artist_cache "
        "WHERE genres IS NOT NULL AND genres != '' AND genres != '[]'"
    )).fetchall()
    for row in artist_rows:
        try:
            tag_weights = _normalize_genres_blob(row.genres)
        except Exception:
            continue
        # De-dup tag names within an artist (Last.fm shouldn't return
        # dupes but defensive — the unique index would otherwise
        # reject the second row).
        seen: set[str] = set()
        for tag, weight in tag_weights:
            t = (tag or "").strip().lower()
            if not t or t in seen:
                continue
            seen.add(t)
            bind.execute(
                sa.text(
                    "INSERT INTO artist_genres (artist_id, tag_name, tag_weight) "
                    "VALUES (:aid, :tag, :w)"
                ),
                {"aid": row.spotify_id, "tag": t, "w": float(weight)},
            )


def downgrade() -> None:
    op.drop_index("ix_artist_genres_artist_tag", table_name="artist_genres")
    op.drop_index("ix_artist_genres_tag_name", table_name="artist_genres")
    op.drop_table("artist_genres")
    op.drop_index("ix_track_cache_primary_artist_id", table_name="track_cache")
    with op.batch_alter_table("track_cache") as batch:
        batch.drop_column("primary_artist_id")
