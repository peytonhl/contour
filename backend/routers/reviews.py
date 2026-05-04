"""Global public reviews feed."""

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Review, AlbumCache
from routers.auth import optional_user_id
from routers.ratings import _enrich_reviews, _controversial_score
from services import spotify

router = APIRouter(prefix="/reviews", tags=["reviews"])


async def _entity_meta(entity_type: str, entity_id: str, db: AsyncSession) -> dict:
    """Get name + image for an entity. Tries album_cache first, falls back to Spotify."""
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
        # Fall through to Spotify for tracks, artists, and uncached albums
        if entity_type == "album":
            data = await spotify.get_album(entity_id)
        elif entity_type == "track":
            data = await spotify.get_track(entity_id)
        else:
            data = await spotify.get_artist(entity_id)
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
    limit: int = Query(50, le=100),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """Public feed of all reviews, sorted by recent / top / controversial."""
    q = select(Review)
    if entity_type != "all":
        q = q.where(Review.entity_type == entity_type)

    reviews = (await db.execute(q)).scalars().all()

    # Enrich with votes, replies, user info
    enriched = await _enrich_reviews(reviews, db, user_id)

    # Sort
    if sort == "recent":
        enriched.sort(key=lambda x: x["created_at"], reverse=True)
    elif sort == "top":
        enriched.sort(key=lambda x: x["upvotes"] - x["downvotes"], reverse=True)
    elif sort == "controversial":
        enriched.sort(key=lambda x: x["_controversial"], reverse=True)

    enriched = enriched[:limit]

    # Batch-fetch entity metadata for unique entities
    unique = list({(r["entity_type"], r["entity_id"]) for r in enriched})
    metas = dict(zip(
        unique,
        await asyncio.gather(*[_entity_meta(et, eid, db) for et, eid in unique])
    ))

    for r in enriched:
        meta = metas.get((r["entity_type"], r["entity_id"]), {})
        r["entity_name"] = meta.get("name")
        r["entity_image_url"] = meta.get("image_url")
        r["entity_artists"] = meta.get("artists", [])
        r.pop("_controversial", None)

    return enriched
