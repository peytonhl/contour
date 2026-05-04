"""Public user profiles and follow/unfollow."""

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User, UserFollow, Rating, Review, ArtistFavorite
from routers.auth import decode_jwt, optional_user_id
from routers.notifications import create_notification
from services import spotify

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/suggested")
async def get_suggested_users(
    db: AsyncSession = Depends(get_db),
    viewer_id: Optional[str] = Depends(optional_user_id),
):
    """
    Return up to 6 active users (most reviews) that the viewer doesn't already follow.
    Works for logged-out users too — just excludes nobody.
    """
    # Users already followed
    already_following: set = set()
    if viewer_id:
        rows = (await db.execute(
            select(UserFollow.following_id).where(UserFollow.follower_id == viewer_id)
        )).scalars().all()
        already_following = set(rows)
        already_following.add(viewer_id)  # don't suggest yourself

    # Most reviewed users
    review_counts = (await db.execute(
        select(Review.user_id, func.count(Review.id).label("n"))
        .group_by(Review.user_id)
        .order_by(func.count(Review.id).desc())
        .limit(30)
    )).all()

    user_ids = [r.user_id for r in review_counts if r.user_id not in already_following][:6]
    if not user_ids:
        return []

    users = (await db.execute(
        select(User).where(User.id.in_(user_ids))
    )).scalars().all()
    user_map = {u.id: u for u in users}

    count_map = {r.user_id: r.n for r in review_counts}
    result = []
    for uid in user_ids:
        u = user_map.get(uid)
        if u:
            result.append({
                "id": u.id,
                "display_name": u.display_name,
                "image_url": u.image_url,
                "bio": u.bio,
                "reviews_count": count_map.get(uid, 0),
            })
    return result


@router.get("/search")
async def search_users(q: str = Query(..., min_length=1), db: AsyncSession = Depends(get_db)):
    """Search users by display name."""
    results = (await db.execute(
        select(User)
        .where(User.display_name.ilike(f"%{q}%"))
        .limit(5)
    )).scalars().all()
    return [{"id": u.id, "display_name": u.display_name, "image_url": u.image_url} for u in results]


@router.get("/{user_id}")
async def get_user(
    user_id: str,
    viewer_id: Optional[str] = Depends(optional_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Public profile for any user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Counts
    ratings_count = (await db.execute(
        select(func.count()).where(Rating.user_id == user_id)
    )).scalar()
    reviews_count = (await db.execute(
        select(func.count()).where(Review.user_id == user_id)
    )).scalar()
    followers_count = (await db.execute(
        select(func.count()).where(UserFollow.following_id == user_id)
    )).scalar()
    following_count = (await db.execute(
        select(func.count()).where(UserFollow.follower_id == user_id)
    )).scalar()

    # Is the viewer following this user?
    is_following = False
    if viewer_id and viewer_id != user_id:
        row = (await db.execute(
            select(UserFollow).where(
                UserFollow.follower_id == viewer_id,
                UserFollow.following_id == user_id,
            )
        )).scalar_one_or_none()
        is_following = row is not None

    return {
        "id": user.id,
        "display_name": user.display_name,
        "image_url": user.image_url,
        "bio": user.bio,
        "ratings_count": ratings_count,
        "reviews_count": reviews_count,
        "followers_count": followers_count,
        "following_count": following_count,
        "is_following": is_following,
        "is_self": viewer_id == user_id,
    }


@router.get("/{user_id}/taste")
async def get_user_taste(user_id: str, db: AsyncSession = Depends(get_db)):
    """
    Return a user's taste profile:
      - rating_distribution: count per star level (1–5)
      - top_genres: up to 5 genres from their highest-rated content
      - pinned_albums: up to 4 curated albums the user picked
    """
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # ── 1. Rating distribution ────────────────────────────────────────────────
    ratings = (await db.execute(
        select(Rating).where(Rating.user_id == user_id)
    )).scalars().all()

    distribution = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for r in ratings:
        star = int(round(r.value))
        if 1 <= star <= 5:
            distribution[star] += 1

    # ── 2. Top genres from highly-rated content ───────────────────────────────
    top_rated = [r for r in ratings if r.value >= 4][:12]

    async def get_entity_artist_ids(entity_type: str, entity_id: str) -> list[str]:
        try:
            if entity_type == "track":
                data = await spotify.get_track(entity_id)
            else:
                data = await spotify.get_album(entity_id)
            return data.get("artist_ids", [])[:1]  # primary artist only
        except Exception:
            return []

    artist_results = await asyncio.gather(
        *[get_entity_artist_ids(r.entity_type, r.entity_id) for r in top_rated],
        return_exceptions=True,
    )

    artist_id_set: set[str] = set()
    for res in artist_results:
        if isinstance(res, list):
            artist_id_set.update(res)

    async def get_genres(artist_id: str) -> list[str]:
        try:
            a = await spotify.get_artist(artist_id)
            return a.get("genres", [])[:3]
        except Exception:
            return []

    genre_results = await asyncio.gather(
        *[get_genres(aid) for aid in list(artist_id_set)[:6]],
        return_exceptions=True,
    )

    genre_counts: dict[str, int] = {}
    for res in genre_results:
        if isinstance(res, list):
            for g in res:
                genre_counts[g] = genre_counts.get(g, 0) + 1

    top_genres = sorted(genre_counts, key=lambda k: genre_counts[k], reverse=True)[:5]

    # ── 3. Pinned albums ──────────────────────────────────────────────────────
    pinned_albums = []
    if user.pinned_album_ids:
        try:
            album_ids = json.loads(user.pinned_album_ids)[:4]
            album_data = await asyncio.gather(
                *[spotify.get_album(aid) for aid in album_ids],
                return_exceptions=True,
            )
            for res in album_data:
                if isinstance(res, dict):
                    pinned_albums.append(res)
        except Exception:
            pass

    return {
        "rating_distribution": distribution,
        "top_genres": top_genres,
        "pinned_albums": pinned_albums,
    }


@router.get("/{user_id}/reviews")
async def get_user_reviews(user_id: str, db: AsyncSession = Depends(get_db)):
    """Return a user's most recent reviews, enriched with entity metadata."""
    from sqlalchemy import desc as sa_desc
    from models import Review, Rating

    reviews = (await db.execute(
        select(Review)
        .where(Review.user_id == user_id)
        .order_by(sa_desc(Review.created_at))
        .limit(30)
    )).scalars().all()

    if not reviews:
        return []

    # Enrich with Spotify metadata + ratings
    unique_entities = list({(r.entity_type, r.entity_id) for r in reviews})

    async def fetch_meta(entity_type: str, entity_id: str):
        try:
            if entity_type == "track":
                data = await spotify.get_track(entity_id)
            elif entity_type == "album":
                data = await spotify.get_album(entity_id)
            else:
                data = await spotify.get_artist(entity_id)
            return (entity_type, entity_id), {
                "name": data["name"],
                "image_url": data.get("image_url"),
                "artists": data.get("artists", []),
            }
        except Exception:
            return (entity_type, entity_id), {"name": None, "image_url": None, "artists": []}

    enriched = dict(await asyncio.gather(*[fetch_meta(et, eid) for et, eid in unique_entities]))

    # Look up each review's rating value
    rating_map: dict[tuple, float] = {}
    for et, eid in unique_entities:
        row = (await db.execute(
            select(Rating).where(
                Rating.user_id == user_id,
                Rating.entity_type == et,
                Rating.entity_id == eid,
            )
        )).scalar_one_or_none()
        if row:
            rating_map[(et, eid)] = row.value

    return [
        {
            "id": r.id,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "entity_name": enriched.get((r.entity_type, r.entity_id), {}).get("name"),
            "entity_image_url": enriched.get((r.entity_type, r.entity_id), {}).get("image_url"),
            "entity_artists": enriched.get((r.entity_type, r.entity_id), {}).get("artists", []),
            "body": r.body,
            "rating": rating_map.get((r.entity_type, r.entity_id)),
            "created_at": r.created_at.isoformat(),
        }
        for r in reviews
    ]


@router.post("/{user_id}/follow")
async def toggle_follow(
    user_id: str,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Follow or unfollow a user. Returns {following: bool}."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    viewer_id = decode_jwt(authorization[7:])

    if viewer_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")

    existing = (await db.execute(
        select(UserFollow).where(
            UserFollow.follower_id == viewer_id,
            UserFollow.following_id == user_id,
        )
    )).scalar_one_or_none()

    if existing:
        await db.execute(
            delete(UserFollow).where(
                UserFollow.follower_id == viewer_id,
                UserFollow.following_id == user_id,
            )
        )
        await db.commit()
        return {"following": False}
    else:
        db.add(UserFollow(follower_id=viewer_id, following_id=user_id))
        await create_notification(db, user_id=user_id, type="follow", actor_id=viewer_id)
        await db.commit()
        return {"following": True}


@router.get("/{user_id}/following")
async def get_following(user_id: str, db: AsyncSession = Depends(get_db)):
    """List of users that user_id follows."""
    rows = (await db.execute(
        select(UserFollow).where(UserFollow.follower_id == user_id)
    )).scalars().all()
    user_ids = [r.following_id for r in rows]

    users = []
    for uid in user_ids:
        u = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
        if u:
            users.append({"id": u.id, "display_name": u.display_name, "image_url": u.image_url})
    return users


@router.get("/{user_id}/followers")
async def get_followers(user_id: str, db: AsyncSession = Depends(get_db)):
    """List of users following user_id."""
    rows = (await db.execute(
        select(UserFollow).where(UserFollow.following_id == user_id)
    )).scalars().all()
    user_ids = [r.follower_id for r in rows]

    users = []
    for uid in user_ids:
        u = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
        if u:
            users.append({"id": u.id, "display_name": u.display_name, "image_url": u.image_url})
    return users
