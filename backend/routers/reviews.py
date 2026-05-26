"""Global public reviews feed."""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal, get_db
from models import Review, AlbumCache, TrackCache
from routers.auth import optional_user_id
from routers.moderation import blocked_user_ids
from routers.ratings import _enrich_reviews
from services import spotify

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reviews", tags=["reviews"])


async def _write_through_cache(entity_type: str, entity_id: str, data: dict) -> None:
    """
    Persist a Spotify-fetched entity into TrackCache / AlbumCache so the next
    request hits the DB cache for free. Runs in its own session because the
    caller's request session may have closed by the time this fires.

    Idempotent — checks for existing rows first; concurrent inserts are
    swallowed by the rollback. Failures here are non-fatal, the response
    has already been sent.
    """
    try:
        async with AsyncSessionLocal() as session:
            if entity_type == "track":
                existing = (await session.execute(
                    select(TrackCache).where(TrackCache.spotify_id == entity_id)
                )).scalar_one_or_none()
                if existing:
                    return
                session.add(TrackCache(
                    spotify_id=entity_id,
                    name=data.get("name") or "",
                    artist=(data.get("artists") or [""])[0],
                    album_name=data.get("album_name"),
                    album_id=data.get("album_id"),
                    release_date=data.get("release_date"),
                    duration_ms=data.get("duration_ms"),
                    explicit=data.get("explicit", False),
                    popularity=data.get("popularity"),
                    image_url=data.get("image_url"),
                    external_url=data.get("external_url"),
                ))
            elif entity_type == "album":
                existing = (await session.execute(
                    select(AlbumCache).where(AlbumCache.spotify_id == entity_id)
                )).scalar_one_or_none()
                if existing:
                    return
                session.add(AlbumCache(
                    spotify_id=entity_id,
                    name=data.get("name") or "",
                    artist=(data.get("artists") or [""])[0],
                    release_date=data.get("release_date"),
                    image_url=data.get("image_url"),
                    enrichment_status="pending",
                ))
            else:
                return  # artists not cached here
            await session.commit()
    except Exception as exc:
        logger.warning("[reviews] write-through cache failed for %s/%s: %s", entity_type, entity_id, exc)


async def _entity_meta(entity_type: str, entity_id: str, db: AsyncSession) -> dict:
    """
    Get name + image for an entity. Tries the local DB caches first
    (AlbumCache for albums, TrackCache for tracks) and only falls through
    to Spotify on a cache miss. On a successful Spotify fetch we write
    through to the cache so subsequent requests are free — this matters
    most when Redis is not configured (every miss otherwise re-hits Spotify
    forever).

    Without the TrackCache check, every track review fell straight through
    to Spotify, and any failure (rate limit, deleted track, Extended Access
    restrictions) made the review render as a raw entity ID in the global
    feed.
    """
    try:
        if entity_type == "album":
            cached = (await db.execute(
                select(AlbumCache).where(AlbumCache.spotify_id == entity_id)
            )).scalar_one_or_none()
            if cached:
                return {
                    "name": cached.name,
                    "image_url": cached.image_url,
                    "artists": [cached.artist],
                }
        elif entity_type == "track":
            cached = (await db.execute(
                select(TrackCache).where(TrackCache.spotify_id == entity_id)
            )).scalar_one_or_none()
            if cached:
                return {
                    "name": cached.name,
                    "image_url": cached.image_url,
                    "artists": [cached.artist] if cached.artist else [],
                }
        # Fall through to Spotify for artists and uncached albums/tracks
        if entity_type == "album":
            data = await spotify.get_album(entity_id)
        elif entity_type == "track":
            data = await spotify.get_track(entity_id)
        else:
            data = await spotify.get_artist(entity_id)
        # Fire-and-forget cache write — don't block the response
        if entity_type in ("track", "album") and data.get("name"):
            asyncio.create_task(_write_through_cache(entity_type, entity_id, data))
        return {
            "name": data.get("name"),
            "image_url": data.get("image_url"),
            "artists": data.get("artists", []),
        }
    except Exception:
        return {"name": None, "image_url": None, "artists": []}


@router.get("/global")
async def global_reviews(
    sort: str = Query("recent", pattern="^(recent|top|controversial)$"),
    entity_type: str = Query("all"),
    limit: int = Query(20, le=50),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """Public feed of all reviews, sorted by recent / top / controversial.

    Response shape: { items: [...], has_more: bool }.

    Pagination via offset+limit. has_more is computed by fetching one
    extra row (limit+1) and reporting whether that extra was present —
    cheaper than a separate COUNT query and accurate to the current
    sort + filter state. The "recent" sort path could be optimized to
    push offset+limit into SQL via ORDER BY created_at DESC; "top" and
    "controversial" depend on the enriched vote data so they stay
    in-memory for now. Acceptable up to a few thousand reviews —
    revisit if the global feed table gets dense.
    """
    q = select(Review)
    if entity_type != "all":
        q = q.where(Review.entity_type == entity_type)

    reviews = (await db.execute(q)).scalars().all()

    # Hide reviews authored by users the viewer has blocked.
    blocked = await blocked_user_ids(db, user_id)
    if blocked:
        reviews = [r for r in reviews if r.user_id not in blocked]

    # Enrich with votes, replies, user info
    enriched = await _enrich_reviews(reviews, db, user_id)

    # Sort
    if sort == "recent":
        enriched.sort(key=lambda x: x["created_at"], reverse=True)
    elif sort == "top":
        enriched.sort(key=lambda x: x["upvotes"] - x["downvotes"], reverse=True)
    elif sort == "controversial":
        enriched.sort(key=lambda x: x["_controversial"], reverse=True)

    # Page slice. Fetch limit+1 to detect "is there more?" without a
    # separate count query — drop the extra before returning.
    page_end = offset + limit + 1
    window = enriched[offset:page_end]
    has_more = len(window) > limit
    page = window[:limit]

    # Batch-fetch entity metadata for unique entities (only the page,
    # not the full enriched list — the previous code's batch covered
    # the page slice anyway since `enriched` was already truncated).
    unique = list({(r["entity_type"], r["entity_id"]) for r in page})
    metas = dict(zip(
        unique,
        await asyncio.gather(*[_entity_meta(et, eid, db) for et, eid in unique])
    ))

    for r in page:
        meta = metas.get((r["entity_type"], r["entity_id"]), {})
        r["entity_name"] = meta.get("name")
        r["entity_image_url"] = meta.get("image_url")
        r["entity_artists"] = meta.get("artists", [])
        r.pop("_controversial", None)

    return {"items": page, "has_more": has_more}
