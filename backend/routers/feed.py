"""Activity feed — recent ratings and reviews from followed users."""

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import (
    Rating, Review, ReviewReply, ReviewVote,
    User, UserFollow, AlbumCache, TrackCache,
)
from routers.moderation import blocked_user_ids
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

    # Exclude anyone the viewer has blocked even if they're following them.
    blocked = await blocked_user_ids(db, user_id)
    if blocked:
        following_ids = [fid for fid in following_ids if fid not in blocked]

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

    # Vote counts + viewer's vote + reply counts for review items — mirrors the
    # batching in ratings._enrich_reviews so the Friends tab can render the
    # same vote/reply affordances as the album-page review section.
    vote_map: dict[int, dict] = {}        # review_id -> {"up": int, "down": int}
    user_vote_map: dict[int, int] = {}    # review_id -> caller's vote (1, -1)
    reply_counts: dict[int, int] = {}
    review_ids = [r.id for r in reviews]
    if review_ids:
        vote_rows = (await db.execute(
            select(ReviewVote).where(ReviewVote.review_id.in_(review_ids))
        )).scalars().all()
        for v in vote_rows:
            vm = vote_map.setdefault(v.review_id, {"up": 0, "down": 0})
            if v.value == 1:
                vm["up"] += 1
            elif v.value == -1:
                vm["down"] += 1
            if v.user_id == user_id:
                user_vote_map[v.review_id] = v.value

        reply_rows = (await db.execute(
            select(ReviewReply.review_id, func.count(ReviewReply.id))
            .where(ReviewReply.review_id.in_(review_ids))
            .group_by(ReviewReply.review_id)
        )).all()
        reply_counts = {row[0]: row[1] for row in reply_rows}

    # Resolve @-mentions per review so the friends feed renders @-tokens
    # as clickable links — same batch pattern as the other endpoints
    # (ratings._enrich_reviews, auth.get_profile, users.get_user_reviews).
    # We can fold the mentioned-user fetch into a single combined SELECT
    # with the authors, but the author user_map is already built above,
    # so we just add a second IN-query for any IDs not already covered.
    from services import mentions as _mentions
    mention_ids_per_review: dict[int, list[str]] = {
        r.id: _mentions.load_ids(r.mention_user_ids) for r in reviews
    }
    all_mentioned: set[str] = set()
    for ids in mention_ids_per_review.values():
        all_mentioned.update(ids)
    missing_mentioned = [mid for mid in all_mentioned if mid not in user_map]
    if missing_mentioned:
        extra_rows = (await db.execute(
            select(User).where(User.id.in_(missing_mentioned))
        )).scalars().all()
        for u in extra_rows:
            user_map[u.id] = {
                "id": u.id, "display_name": u.display_name, "image_url": u.image_url
            }

    def _mentions_for(rev_id: int) -> list[dict]:
        out = []
        for mid in mention_ids_per_review.get(rev_id, []):
            mu = user_map.get(mid)
            if mu is None:
                continue
            out.append({"id": mu["id"], "display_name": mu["display_name"]})
        return out

    # Consolidate rating + review pairs.
    #
    # A Review and a Rating from the same user on the same entity are one
    # logical event — typically the user does both in the same flow on the
    # album page, but even when temporally split (rate now, review later)
    # they describe the same opinion. Showing them as two feed items makes
    # the Friends tab look like everyone is doing everything twice.
    #
    # Rule: each Review absorbs the matching Rating's value. Any Rating
    # without a matching Review still ships as a bare "rating" item.
    rating_by_entity: dict = {}
    for r in ratings:
        # ratings query is ordered created_at DESC, so the first hit per
        # (user, entity) is the most recent — keep that one if there are
        # somehow duplicates from older data.
        key = (r.user_id, r.entity_type, r.entity_id)
        rating_by_entity.setdefault(key, r)

    consumed_rating_keys: set = set()
    items = []

    # Reviews first — each may absorb the matching rating's value
    for r in reviews:
        meta = entity_map.get((r.entity_type, r.entity_id), {})
        votes = vote_map.get(r.id, {"up": 0, "down": 0})
        rating = rating_by_entity.get((r.user_id, r.entity_type, r.entity_id))
        if rating is not None:
            consumed_rating_keys.add((rating.user_id, rating.entity_type, rating.entity_id))
        # Use the more recent of review.created_at and rating.created_at so
        # the consolidated item re-bubbles to the top of the feed whenever
        # either action is fresh — matches what "recent activity" means to
        # the user.
        created_at = r.created_at
        if rating is not None and rating.created_at > created_at:
            created_at = rating.created_at
        items.append({
            "type": "review",
            # review_id is what /ratings/reviews/{id}/vote and /reply need —
            # keyed as "id" to match the shape ReviewSection.jsx consumes.
            "id": r.id,
            "user": user_map.get(r.user_id),
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "entity_name": meta.get("name"),
            "entity_image_url": meta.get("image_url"),
            "entity_artists": meta.get("artists", []),
            # Stars from the consolidated Rating; null when the user wrote
            # a body-only review (rare but possible via direct API).
            "value": rating.value if rating is not None else None,
            "body": r.body,
            "mentions": _mentions_for(r.id),
            "upvotes": votes["up"],
            "downvotes": votes["down"],
            "user_vote": user_vote_map.get(r.id),
            "replies_count": reply_counts.get(r.id, 0),
            "created_at": created_at.isoformat() + "Z",
            # Surface edit state so the Friends feed renders "(edited)" the
            # same way the album-page review section does. Mirrors the 2s
            # threshold used in ratings._enrich_reviews.
            "edited": (r.updated_at - r.created_at).total_seconds() > 2,
        })

    # Then bare ratings (not absorbed by any review)
    for r in ratings:
        key = (r.user_id, r.entity_type, r.entity_id)
        if key in consumed_rating_keys:
            continue
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
            "created_at": r.created_at.isoformat() + "Z",
        })

    # Sort by date descending, limit to 50
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items[:50]
