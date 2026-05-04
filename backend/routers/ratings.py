import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Rating, Review, ReviewLike, ReviewVote, ReviewReply, User
from routers.auth import optional_user_id
from routers.notifications import create_notification

SPOTIFY_ID_RE = re.compile(r'^[A-Za-z0-9]{22}$')
VALID_ENTITY_TYPES = {"album", "track", "artist"}

router = APIRouter(prefix="/ratings", tags=["ratings"])


def _validate_entity(entity_type: str, entity_id: str):
    if entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid entity_type")
    if not SPOTIFY_ID_RE.match(entity_id):
        raise HTTPException(status_code=400, detail="Invalid entity_id format")


# ── Input models ──────────────────────────────────────────────────────────────

class RatingIn(BaseModel):
    value: float

    @field_validator("value")
    @classmethod
    def validate_value(cls, v):
        if v not in {0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0}:
            raise ValueError("Rating must be a multiple of 0.5 between 0.5 and 5.0")
        return v


class ReviewIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)
    value: Optional[float] = None

    @field_validator("value")
    @classmethod
    def validate_value(cls, v):
        if v is not None and v not in {0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0}:
            raise ValueError("Rating must be a multiple of 0.5 between 0.5 and 5.0")
        return v


class VoteIn(BaseModel):
    value: int

    @field_validator("value")
    @classmethod
    def validate_value(cls, v):
        if v not in {1, -1}:
            raise ValueError("Vote must be 1 (upvote) or -1 (downvote)")
        return v


class ReplyIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _controversial_score(upvotes: int, downvotes: int) -> float:
    """Higher = more divisive. Rewards high total engagement + close 50/50 split."""
    total = upvotes + downvotes
    if total == 0:
        return 0.0
    return total * min(upvotes, downvotes) / (max(upvotes, downvotes) + 1)


async def _enrich_reviews(reviews, db, user_id, entity_type=None, entity_id=None):
    """Shared helper: batch-fetch votes, replies, users, and ratings for a list of reviews."""
    if not reviews:
        return []

    review_ids = [r.id for r in reviews]

    # Batch: votes
    vote_rows = (await db.execute(
        select(ReviewVote).where(ReviewVote.review_id.in_(review_ids))
    )).scalars().all()

    vote_map: dict = {}       # review_id -> {up, down}
    user_vote_map: dict = {}  # review_id -> caller's vote
    for v in vote_rows:
        vm = vote_map.setdefault(v.review_id, {"up": 0, "down": 0})
        if v.value == 1:
            vm["up"] += 1
        else:
            vm["down"] += 1
        if user_id and v.user_id == user_id:
            user_vote_map[v.review_id] = v.value

    # Batch: reply counts
    reply_rows = (await db.execute(
        select(ReviewReply.review_id, func.count(ReviewReply.id))
        .where(ReviewReply.review_id.in_(review_ids))
        .group_by(ReviewReply.review_id)
    )).all()
    reply_counts = {row[0]: row[1] for row in reply_rows}

    # Batch: users
    user_ids = list({r.user_id for r in reviews})
    user_objs = (await db.execute(
        select(User).where(User.id.in_(user_ids))
    )).scalars().all()
    user_map = {u.id: u for u in user_objs}

    # Batch: ratings (only when scoped to a single entity)
    rating_map: dict = {}
    if entity_type and entity_id:
        rating_rows = (await db.execute(
            select(Rating).where(
                Rating.entity_type == entity_type,
                Rating.entity_id == entity_id,
                Rating.user_id.in_(user_ids),
            )
        )).scalars().all()
        rating_map = {r.user_id: r.value for r in rating_rows}

    out = []
    for rev in reviews:
        votes = vote_map.get(rev.id, {"up": 0, "down": 0})
        up, down = votes["up"], votes["down"]
        u = user_map.get(rev.user_id)
        out.append({
            "id": rev.id,
            "entity_type": rev.entity_type,
            "entity_id": rev.entity_id,
            "body": rev.body,
            "created_at": rev.created_at.isoformat(),
            "rating": rating_map.get(rev.user_id),
            "upvotes": up,
            "downvotes": down,
            "user_vote": user_vote_map.get(rev.id),
            "replies_count": reply_counts.get(rev.id, 0),
            "_controversial": _controversial_score(up, down),
            "user": {
                "id": rev.user_id,
                "display_name": u.display_name if u else "Unknown",
                "image_url": u.image_url if u else None,
            },
        })
    return out


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/{entity_type}/{entity_id}/rate")
async def rate(
    entity_type: str, entity_id: str, body: RatingIn,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to rate")
    _validate_entity(entity_type, entity_id)

    existing = (await db.execute(
        select(Rating).where(
            Rating.user_id == user_id,
            Rating.entity_type == entity_type,
            Rating.entity_id == entity_id,
        )
    )).scalar_one_or_none()

    if existing:
        existing.value = body.value
    else:
        db.add(Rating(user_id=user_id, entity_type=entity_type,
                      entity_id=entity_id, value=body.value))
    await db.commit()
    return {"ok": True, "value": body.value}


@router.get("/{entity_type}/{entity_id}/summary")
async def summary(
    entity_type: str, entity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    avg_val, count = (await db.execute(
        select(func.avg(Rating.value), func.count(Rating.id)).where(
            Rating.entity_type == entity_type,
            Rating.entity_id == entity_id,
        )
    )).one()

    user_rating = user_review = None
    if user_id:
        user_rating = (await db.execute(
            select(Rating.value).where(
                Rating.user_id == user_id,
                Rating.entity_type == entity_type,
                Rating.entity_id == entity_id,
            )
        )).scalar_one_or_none()
        user_review = (await db.execute(
            select(Review.body).where(
                Review.user_id == user_id,
                Review.entity_type == entity_type,
                Review.entity_id == entity_id,
            )
        )).scalar_one_or_none()

    return {
        "average": round(avg_val, 2) if avg_val else None,
        "count": count,
        "user_rating": user_rating,
        "user_review": user_review,
    }


@router.post("/{entity_type}/{entity_id}/review")
async def upsert_review(
    entity_type: str, entity_id: str, body: ReviewIn,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to leave a review")
    if entity_type not in ("album", "track", "artist"):
        raise HTTPException(status_code=400, detail="Invalid entity_type")
    if not body.body.strip():
        raise HTTPException(status_code=400, detail="Review cannot be empty")

    if body.value is not None:
        existing_rating = (await db.execute(
            select(Rating).where(
                Rating.user_id == user_id,
                Rating.entity_type == entity_type,
                Rating.entity_id == entity_id,
            )
        )).scalar_one_or_none()
        if existing_rating:
            existing_rating.value = body.value
        else:
            db.add(Rating(user_id=user_id, entity_type=entity_type,
                          entity_id=entity_id, value=body.value))

    existing_review = (await db.execute(
        select(Review).where(
            Review.user_id == user_id,
            Review.entity_type == entity_type,
            Review.entity_id == entity_id,
        )
    )).scalar_one_or_none()

    if existing_review:
        existing_review.body = body.body.strip()
        existing_review.updated_at = datetime.utcnow()
    else:
        db.add(Review(user_id=user_id, entity_type=entity_type,
                      entity_id=entity_id, body=body.body.strip()))
    await db.commit()
    return {"ok": True}


@router.get("/{entity_type}/{entity_id}/reviews")
async def list_reviews(
    entity_type: str, entity_id: str,
    sort: str = Query("recent", pattern="^(recent|top|controversial)$"),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    reviews = (await db.execute(
        select(Review).where(
            Review.entity_type == entity_type,
            Review.entity_id == entity_id,
        )
    )).scalars().all()

    out = await _enrich_reviews(reviews, db, user_id,
                                entity_type=entity_type, entity_id=entity_id)

    if sort == "recent":
        out.sort(key=lambda x: x["created_at"], reverse=True)
    elif sort == "top":
        out.sort(key=lambda x: x["upvotes"] - x["downvotes"], reverse=True)
    elif sort == "controversial":
        out.sort(key=lambda x: x["_controversial"], reverse=True)

    # Remove internal sort key
    for r in out:
        r.pop("_controversial", None)
    return out


@router.post("/reviews/{review_id}/vote")
async def vote_review(
    review_id: int, body: VoteIn,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to vote")

    existing = (await db.execute(
        select(ReviewVote).where(
            ReviewVote.user_id == user_id,
            ReviewVote.review_id == review_id,
        )
    )).scalar_one_or_none()

    is_new_upvote = False
    if existing:
        if existing.value == body.value:
            # Same vote — toggle off
            await db.execute(delete(ReviewVote).where(
                ReviewVote.user_id == user_id,
                ReviewVote.review_id == review_id,
            ))
            user_vote = None
        else:
            existing.value = body.value
            user_vote = body.value
            is_new_upvote = body.value == 1
    else:
        db.add(ReviewVote(user_id=user_id, review_id=review_id, value=body.value))
        user_vote = body.value
        is_new_upvote = body.value == 1

    # Notify review author on new upvote
    if is_new_upvote:
        review = (await db.execute(
            select(Review).where(Review.id == review_id)
        )).scalar_one_or_none()
        if review:
            await create_notification(db, user_id=review.user_id, type="upvote",
                                      actor_id=user_id, review_id=review_id)

    await db.commit()

    # Return updated counts
    vote_rows = (await db.execute(
        select(ReviewVote).where(ReviewVote.review_id == review_id)
    )).scalars().all()
    upvotes = sum(1 for v in vote_rows if v.value == 1)
    downvotes = sum(1 for v in vote_rows if v.value == -1)
    return {"upvotes": upvotes, "downvotes": downvotes, "user_vote": user_vote}


@router.get("/reviews/{review_id}/replies")
async def get_replies(review_id: int, db: AsyncSession = Depends(get_db)):
    replies = (await db.execute(
        select(ReviewReply)
        .where(ReviewReply.review_id == review_id)
        .order_by(ReviewReply.created_at.asc())
    )).scalars().all()

    if not replies:
        return []

    user_ids = list({r.user_id for r in replies})
    users = (await db.execute(
        select(User).where(User.id.in_(user_ids))
    )).scalars().all()
    user_map = {u.id: u for u in users}

    return [{
        "id": r.id,
        "body": r.body,
        "created_at": r.created_at.isoformat(),
        "user": {
            "id": r.user_id,
            "display_name": user_map[r.user_id].display_name if r.user_id in user_map else "Unknown",
            "image_url": user_map[r.user_id].image_url if r.user_id in user_map else None,
        },
    } for r in replies]


@router.post("/reviews/{review_id}/reply")
async def post_reply(
    review_id: int, body: ReplyIn,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to reply")

    # Verify review exists
    review = (await db.execute(
        select(Review).where(Review.id == review_id)
    )).scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    db.add(ReviewReply(review_id=review_id, user_id=user_id, body=body.body.strip()))
    await create_notification(db, user_id=review.user_id, type="reply",
                              actor_id=user_id, review_id=review_id)
    await db.commit()
    return {"ok": True}


# Keep legacy like endpoint so old cached frontend calls don't break
@router.post("/reviews/{review_id}/like")
async def toggle_like(
    review_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to like reviews")
    existing = (await db.execute(
        select(ReviewLike).where(
            ReviewLike.user_id == user_id,
            ReviewLike.review_id == review_id,
        )
    )).scalar_one_or_none()
    if existing:
        await db.execute(delete(ReviewLike).where(
            ReviewLike.user_id == user_id,
            ReviewLike.review_id == review_id,
        ))
        liked = False
    else:
        db.add(ReviewLike(user_id=user_id, review_id=review_id))
        liked = True
    await db.commit()
    return {"liked": liked}
