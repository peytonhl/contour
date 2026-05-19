"""
DB cache for Spotify artist metadata (genres, image, popularity).

Mirrors the album_cache.py pattern. Backs the profile-taste endpoint so
deriving a user's top genres doesn't fan out to N Spotify calls per
profile view.

Refresh cadence is loose — artist genres update rarely, so 30d is fine
before we re-pull from Spotify.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ArtistCache
from services import spotify

logger = logging.getLogger(__name__)

# How long before we consider cached artist metadata stale enough to re-fetch.
# Artist genres on Spotify are effectively immutable for established artists —
# the rare official genre shift (or popularity ticking up) doesn't materially
# affect our taste-section math. Treat the cache as effectively permanent
# (1y refresh window) so an artist enters the DB once and almost never gets
# re-fetched. Manual invalidation (delete the row) is the escape hatch.
META_TTL = timedelta(days=365)


def _coerce_genres_to_string_list(genres_json: Optional[str]) -> list[str]:
    """ArtistCache.genres now stores either:
      - NEW: [{"name": "hip hop", "count": 100}, ...]  (Last.fm TopTags era)
      - LEGACY: ["hip hop", "rap", ...]                 (Spotify era)

    Public-facing consumers (profile-taste endpoint, etc.) want a flat
    list of strings, so flatten either format here. Names are preserved
    in original case as stored.
    """
    if not genres_json:
        return []
    try:
        parsed = json.loads(genres_json)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    if not parsed:
        return []
    # New format detection: first element is a dict with "name" key
    if isinstance(parsed[0], dict):
        return [g["name"] for g in parsed if isinstance(g, dict) and g.get("name")]
    # Legacy format: list of strings
    return [g for g in parsed if isinstance(g, str)]


async def _is_meta_fresh(row: ArtistCache) -> bool:
    """True if the cached metadata is recent enough to use without re-fetching."""
    if row.meta_fetched_at is None:
        return False
    return datetime.utcnow() - row.meta_fetched_at < META_TTL


async def get_or_fetch_artist(db: AsyncSession, artist_id: str) -> Optional[dict]:
    """
    Return artist meta as {id, name, genres, image_url, popularity} — from
    DB cache when fresh, otherwise hit Spotify and write through.

    Returns None only if the artist genuinely can't be resolved (Spotify 404
    or persistent failure). Callers should treat None as "skip this artist"
    rather than retrying.
    """
    row = (await db.execute(
        select(ArtistCache).where(ArtistCache.spotify_id == artist_id)
    )).scalar_one_or_none()

    if row and await _is_meta_fresh(row):
        return {
            "id": row.spotify_id,
            "name": row.name,
            "genres": _coerce_genres_to_string_list(row.genres),
            "image_url": row.image_url,
            "popularity": row.popularity,
        }

    # Miss or stale — fetch from Spotify and write through. Returns None
    # gracefully if Spotify fails (rate limit, 404, network). On a stale
    # hit we keep the row but skip the Spotify call if it fails.
    try:
        meta = await spotify.get_artist(artist_id)
    except Exception as exc:
        logger.debug("[artist_cache] spotify fetch failed for %s: %s", artist_id, exc)
        if row:
            # Return stale data rather than nothing — better than dropping
            # the artist entirely on transient Spotify failures.
            return {
                "id": row.spotify_id,
                "name": row.name,
                "genres": _coerce_genres_to_string_list(row.genres),
                "image_url": row.image_url,
                "popularity": row.popularity,
            }
        return None

    now = datetime.utcnow()
    genres_json = json.dumps(meta.get("genres", []))
    if row:
        row.name = meta.get("name") or row.name
        row.genres = genres_json
        row.image_url = meta.get("image_url")
        row.popularity = meta.get("popularity")
        row.meta_fetched_at = now
    else:
        row = ArtistCache(
            spotify_id=artist_id,
            name=meta.get("name") or artist_id,
            genres=genres_json,
            image_url=meta.get("image_url"),
            popularity=meta.get("popularity"),
            meta_fetched_at=now,
        )
        db.add(row)
    await db.commit()

    return {
        "id": artist_id,
        "name": row.name,
        "genres": meta.get("genres", []),
        "image_url": meta.get("image_url"),
        "popularity": meta.get("popularity"),
    }
