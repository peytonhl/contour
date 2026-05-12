"""Public user profiles and follow/unfollow."""

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select, func, delete, desc
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User, UserFollow, Rating, Review, ReviewVote, ArtistFavorite, UserList, UserListItem, AlbumCache, TrackCache
from routers.auth import decode_jwt, optional_user_id
from routers.notifications import create_notification
from services import spotify
from services import artist_cache
from services import deezer as deezer_svc

router = APIRouter(prefix="/users", tags=["users"])


async def _fetch_entity_meta(entity_type: str, entity_id: str, db: AsyncSession) -> tuple:
    """Resolve name/image/artists for a rated entity.

    Resolution order:
    1. DB cache (AlbumCache / TrackCache) — free, instant, no rate-limit risk.
    2. Deezer API — for old numeric IDs from the For You feed pre-validation.
    3. Spotify API — last resort; skipped entirely if DB already has the data.
    """
    # ── 1. DB cache first ─────────────────────────────────────────────────────
    if entity_type == "album":
        row = (await db.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == entity_id)
        )).scalar_one_or_none()
        if row:
            return (entity_type, entity_id), {
                "name": row.name,
                "image_url": row.image_url,
                "artists": [row.artist] if row.artist else [],
            }
    elif entity_type == "track":
        row = (await db.execute(
            select(TrackCache).where(TrackCache.spotify_id == entity_id)
        )).scalar_one_or_none()
        if row:
            return (entity_type, entity_id), {
                "name": row.name,
                "image_url": row.image_url,
                "artists": [row.artist] if row.artist else [],
            }

    # ── 2. Deezer — numeric IDs from old For You feed ratings ────────────────
    if entity_id.isdigit():
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"https://api.deezer.com/track/{entity_id}")
                if resp.status_code == 200:
                    t = resp.json()
                    artist_name = (t.get("artist") or {}).get("name", "")
                    album = t.get("album") or {}
                    return (entity_type, entity_id), {
                        "name": t.get("title") or t.get("name"),
                        "image_url": album.get("cover_medium") or album.get("cover"),
                        "artists": [artist_name] if artist_name else [],
                    }
        except Exception:
            pass
        return (entity_type, entity_id), {"name": None, "image_url": None, "artists": []}

    # ── 3. Spotify ────────────────────────────────────────────────────────────
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


@router.get("/badges")
async def get_badges(db: AsyncSession = Depends(get_db)):
    """
    Return the top-5 users in three badge categories:
      - critics:     most reviews written
      - influencers: most upvotes received across all their reviews
      - connectors:  most followers
    Each category returns a list of {id, display_name, image_url, score}.
    """
    # ── Critics: top 5 by review count ───────────────────────────────────────
    critic_rows = (await db.execute(
        select(Review.user_id, func.count(Review.id).label("score"))
        .group_by(Review.user_id)
        .order_by(func.count(Review.id).desc())
        .limit(5)
    )).all()

    # ── Influencers: top 5 by total upvotes received ──────────────────────────
    influencer_rows = (await db.execute(
        select(Review.user_id, func.count(ReviewVote.id).label("score"))
        .join(ReviewVote, (ReviewVote.review_id == Review.id) & (ReviewVote.value == 1))
        .group_by(Review.user_id)
        .order_by(func.count(ReviewVote.id).desc())
        .limit(5)
    )).all()

    # ── Connectors: top 5 by follower count ──────────────────────────────────
    # UserFollow has no `id` column (composite PK on follower_id/following_id),
    # so we count the follower_id rows directly. The previous func.count(UserFollow.id)
    # raised AttributeError and returned 500.
    connector_rows = (await db.execute(
        select(UserFollow.following_id, func.count(UserFollow.follower_id).label("score"))
        .group_by(UserFollow.following_id)
        .order_by(func.count(UserFollow.follower_id).desc())
        .limit(5)
    )).all()

    # Batch-fetch all user objects we need
    all_ids = list({r.user_id for r in critic_rows}
                  | {r.user_id for r in influencer_rows}
                  | {r.following_id for r in connector_rows})
    if not all_ids:
        return {"critics": [], "influencers": [], "connectors": []}

    user_objs = (await db.execute(
        select(User).where(User.id.in_(all_ids))
    )).scalars().all()
    user_map = {u.id: u for u in user_objs}

    def _serialize(uid: str, score: int) -> dict:
        u = user_map.get(uid)
        return {
            "id": uid,
            "display_name": u.display_name if u else "Unknown",
            "image_url": u.image_url if u else None,
            "score": score,
        }

    return {
        "critics":      [_serialize(r.user_id,    r.score) for r in critic_rows],
        "influencers":  [_serialize(r.user_id,    r.score) for r in influencer_rows],
        "connectors":   [_serialize(r.following_id, r.score) for r in connector_rows],
    }


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

    # Resolve each rated entity → primary artist ID. TrackCache stores
    # artist_ids_json, AlbumCache only stores the artist name; in both cases
    # we fall through to spotify.get_track / get_album (now 30d Redis-cached,
    # so the first lookup is the only one that hits the network).
    async def get_entity_artist_ids(entity_type: str, entity_id: str) -> list[str]:
        # Fast path for tracks: TrackCache has artist_ids serialized.
        if entity_type == "track":
            row = (await db.execute(
                select(TrackCache).where(TrackCache.spotify_id == entity_id)
            )).scalar_one_or_none()
            if row and row.artist_ids_json:
                try:
                    ids = json.loads(row.artist_ids_json)
                    if ids:
                        return ids[:1]
                except Exception:
                    pass
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

    # Genres come from ArtistCache (DB) when fresh, else write-through from
    # Spotify. Eliminates the per-profile-view Spotify fan-out — previously
    # 6 cache-miss calls per page load, now 0 once warm (≤30d).
    async def get_genres(artist_id: str) -> list[str]:
        meta = await artist_cache.get_or_fetch_artist(db, artist_id)
        return (meta or {}).get("genres", [])[:3]

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


@router.get("/{user_id}/ratings")
async def get_user_ratings(user_id: str, db: AsyncSession = Depends(get_db)):
    """Return all ratings for a user, enriched with entity metadata, newest first."""
    ratings = (await db.execute(
        select(Rating)
        .where(Rating.user_id == user_id)
        .order_by(desc(Rating.created_at))
        .limit(200)
    )).scalars().all()

    if not ratings:
        return []

    unique_entities = list({(r.entity_type, r.entity_id) for r in ratings})

    raw = await asyncio.gather(
        *[_fetch_entity_meta(et, eid, db) for et, eid in unique_entities],
        return_exceptions=True,
    )
    enriched = {k: v for k, v in raw if isinstance(v, dict)}

    return [
        {
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "entity_name": enriched.get((r.entity_type, r.entity_id), {}).get("name"),
            "entity_image_url": enriched.get((r.entity_type, r.entity_id), {}).get("image_url"),
            "entity_artists": enriched.get((r.entity_type, r.entity_id), {}).get("artists", []),
            "value": r.value,
            "created_at": r.created_at.isoformat() + "Z",
        }
        for r in ratings
    ]


@router.get("/{user_id}/lists")
async def get_user_lists(user_id: str, db: AsyncSession = Depends(get_db)):
    """Return all lists created by a user, newest first."""
    lists = (await db.execute(
        select(UserList)
        .where(UserList.user_id == user_id)
        .order_by(desc(UserList.updated_at))
    )).scalars().all()

    result = []
    for lst in lists:
        # Get item count and first 4 item images for the preview collage
        items = (await db.execute(
            select(UserListItem)
            .where(UserListItem.list_id == lst.id)
            .order_by(UserListItem.position)
            .limit(4)
        )).scalars().all()

        # Fetch images for the first 4 items in parallel
        async def get_image(item: UserListItem):
            try:
                if item.entity_type == "track":
                    d = await spotify.get_track(item.entity_id)
                elif item.entity_type == "album":
                    d = await spotify.get_album(item.entity_id)
                else:
                    d = await spotify.get_artist(item.entity_id)
                return d.get("image_url")
            except Exception:
                return None

        raw_images = await asyncio.gather(*[get_image(i) for i in items], return_exceptions=True)
        preview_images = [img if isinstance(img, str) else None for img in raw_images]

        item_count_row = await db.execute(
            select(func.count()).where(UserListItem.list_id == lst.id)
        )
        item_count = item_count_row.scalar()

        result.append({
            "id": lst.id,
            "title": lst.title,
            "description": lst.description,
            "is_ranked": lst.is_ranked,
            "item_count": item_count,
            "preview_images": [img for img in preview_images if img],
            "updated_at": lst.updated_at.isoformat() + "Z",
        })

    return result


@router.get("/{user_id}/reviews")
async def get_user_reviews(user_id: str, db: AsyncSession = Depends(get_db)):
    """Return a user's most recent reviews, enriched with entity metadata."""
    reviews = (await db.execute(
        select(Review)
        .where(Review.user_id == user_id)
        .order_by(desc(Review.created_at))
        .limit(30)
    )).scalars().all()

    if not reviews:
        return []

    # Enrich with Spotify metadata + ratings
    unique_entities = list({(r.entity_type, r.entity_id) for r in reviews})

    raw = await asyncio.gather(
        *[_fetch_entity_meta(et, eid, db) for et, eid in unique_entities],
        return_exceptions=True,
    )
    enriched = {k: v for k, v in raw if isinstance(v, dict)}

    # Batch-fetch all ratings for this user's reviewed entities in one query
    entity_ids = [eid for _, eid in unique_entities]
    rating_rows = (await db.execute(
        select(Rating).where(
            Rating.user_id == user_id,
            Rating.entity_id.in_(entity_ids),
        )
    )).scalars().all()
    rating_map: dict[tuple, float] = {(r.entity_type, r.entity_id): r.value for r in rating_rows}

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
            "created_at": r.created_at.isoformat() + "Z",
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
    if not user_ids:
        return []

    user_objs = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
    user_map = {u.id: u for u in user_objs}
    return [
        {"id": uid, "display_name": user_map[uid].display_name, "image_url": user_map[uid].image_url}
        for uid in user_ids if uid in user_map
    ]


@router.get("/{user_id}/followers")
async def get_followers(user_id: str, db: AsyncSession = Depends(get_db)):
    """List of users following user_id."""
    rows = (await db.execute(
        select(UserFollow).where(UserFollow.following_id == user_id)
    )).scalars().all()
    user_ids = [r.follower_id for r in rows]
    if not user_ids:
        return []

    user_objs = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
    user_map = {u.id: u for u in user_objs}
    return [
        {"id": uid, "display_name": user_map[uid].display_name, "image_url": user_map[uid].image_url}
        for uid in user_ids if uid in user_map
    ]
