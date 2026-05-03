"""
SQLite cache for album metadata and Kworb stream counts.
Reduces external API calls and holds async enrichment state.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AlbumCache

STREAM_TTL_HOURS = 24  # re-scrape Kworb after this many hours


async def get_cached_album(db: AsyncSession, spotify_id: str) -> Optional[AlbumCache]:
    result = await db.execute(
        select(AlbumCache).where(AlbumCache.spotify_id == spotify_id)
    )
    return result.scalar_one_or_none()


async def upsert_album(db: AsyncSession, spotify_meta: dict) -> AlbumCache:
    """Insert or update album metadata from Spotify. Does not touch stream data."""
    existing = await get_cached_album(db, spotify_meta["id"])
    if existing:
        existing.name = spotify_meta["name"]
        existing.artist = ", ".join(spotify_meta.get("artists", []))
        existing.release_date = spotify_meta.get("release_date")
        existing.release_date_precision = spotify_meta.get("release_date_precision")
        existing.label = spotify_meta.get("label")
        existing.popularity = spotify_meta.get("popularity")
        existing.image_url = spotify_meta.get("image_url")
        await db.commit()
        await db.refresh(existing)
        return existing

    row = AlbumCache(
        spotify_id=spotify_meta["id"],
        name=spotify_meta["name"],
        artist=", ".join(spotify_meta.get("artists", [])),
        release_date=spotify_meta.get("release_date"),
        release_date_precision=spotify_meta.get("release_date_precision"),
        label=spotify_meta.get("label"),
        popularity=spotify_meta.get("popularity"),
        image_url=spotify_meta.get("image_url"),
        enrichment_status="pending",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def save_kworb_streams(
    db: AsyncSession, spotify_id: str, streams: Optional[int]
) -> None:
    row = await get_cached_album(db, spotify_id)
    if row is None:
        return
    row.kworb_streams = streams
    row.enrichment_status = "done" if streams is not None else "failed"
    row.enriched_at = datetime.utcnow()
    await db.commit()


def needs_enrichment(row: AlbumCache) -> bool:
    """True if we should (re-)scrape Kworb for this album."""
    if row.enrichment_status == "pending":
        return True
    if row.enrichment_status == "failed":
        return True
    if row.enriched_at is None:
        return True
    age = datetime.utcnow() - row.enriched_at
    return age > timedelta(hours=STREAM_TTL_HOURS)


def streams_for_album(row: AlbumCache) -> Optional[int]:
    return row.kworb_streams
