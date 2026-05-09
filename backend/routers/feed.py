"""Activity feed — recent ratings and reviews from followed users."""

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Rating, Review, User, UserFollow, AlbumCache, TrackCache
from routers.auth import decode_jwt
from services import spotify

router = APIRouter(prefix="/feed", tags=["feed"])


async def _enrich(entity_type: str, entity_id: str, db: AsyncSession) -> dict:
    """Resolve entity name/image — DB cache first, Spotify as last resort."""
    try:
        if entity_type == "album":
            row = (await db.execute(
                select(AlbumCache).where(AlbumCache.spotify_id == entity_id)
            )).scalar_one_or_none()
            if row:
                return {"name": row.name, "image_url": row.image_url, "artists": [row.artist] if row.artist else []}
        elif entity_type == "track":
            row = (await db.execute(
                select(TrackCache).where(TrackCache.spotify_id == entity_id)
            )).scalar_one_or_none()
            if row:
                return {"name": row.name, "image_url": row.image_url, "artists": [row.artist] if row.artist else []}
    except Exception:
        pass

    try:
        if entity_type == "album":
            d = await spotify.get_album(entity_id)
        elif entity_type == "track":
            d = await spotify.get_track(entity_id)
        else:
            d = await spotify.get_artist(entity_id)
        return {"name": d["name"], "image_url": d.get("image_url"), "artists": d.get("artists", [])}
    except Exception:
        return {"name": None, "image_url": None, "artists": []}


@router.get("")
async def get_feed(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = decode_jwt(authorization[7:])

    # Who does this user follow?
    rows = (await db.execute(
        select(UserFollow).where(UserFollow.follower_id == user_id)
    )).scalars().all()
    following_ids = [r.following_id for r in rows]

    if not following_ids:
        return []

    # Fetch recent ratings + reviews from those users
    ratings = (await db.execute(
        select(Rating)
        .where(Rating.user_id.in_(following_ids))
        .order_by(Rating.created_at.desc())
        .limit(40)
    )).scalars().all()

    reviews = (await db.execute(
        select(Review)
        .where(Review.user_id.in_(following_ids))
        .order_by(Review.created_at.desc())
        .limit(40)
    )).scalars().all()

    # Fetch user info for everyone in the feed
    all_user_ids = list({r.user_id for r in ratings} | {r.user_id for r in reviews})
    user_rows = (await db.execute(
        select(User).where(User.id.in_(all_user_ids))
    )).scalars().all()
    user_map = {u.id: {"id": u.id, "display_name": u.display_name, "image_url": u.image_url} for u in user_rows}

    # Enrich entity metadata — DB-first (free), Spotify last resort (deduplicated)
    unique = list({(r.entity_type, r.entity_id) for r in ratings} | {(r.entity_type, r.entity_id) for r in reviews})
    enriched_list = await asyncio.gather(*[_enrich(et, eid, db) for et, eid in unique], return_exceptions=True)
    entity_map = {
        (et, eid): (data if isinstance(data, dict) else {"name": None, "image_url": None, "artists": []})
        for (et, eid), data in zip(unique, enriched_list)
    }

    # Build feed items
    items = []
    for r in ratings:
        meta = entity_map.get((r.entity_type, r.entity_id), {})
        items.append({
            "type": "rating",
            "user": user_map.get(r.user_id),
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "entity_name": meta.get("name"),
            "entity_image_url": meta.get("image_url"),
            "entity_artists": meta.get("artists", []),
            "value": r.value,
            "created_at": r.created_at.isoformat(),
        })
    for r in reviews:
        meta = entity_map.get((r.entity_type, r.entity_id), {})
        items.append({
            "type": "review",
            "user": user_map.get(r.user_id),
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "entity_name": meta.get("name"),
            "entity_image_url": meta.get("image_url"),
            "entity_artists": meta.get("artists", []),
            "body": r.body,
            "created_at": r.created_at.isoformat(),
        })

    # Sort by date descending, limit to 50
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items[:50]
