import re
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

SPOTIFY_ID_RE = re.compile(r'^[A-Za-z0-9]{22}$')
VALID_ENTITY_TYPES = {"album", "track", "artist"}

def _validate_entity(entity_type: str, entity_id: str):
    if entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid entity_type")
    if not SPOTIFY_ID_RE.match(entity_id):
        raise HTTPException(status_code=400, detail="Invalid entity_id format")
from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Rating, Review, ReviewLike, User
from routers.auth import optional_user_id

router = APIRouter(prefix="/ratings", tags=["ratings"])


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


@router.post("/{entity_type}/{entity_id}/rate")
async def rate(
    entity_type: str,
    entity_id: str,
    body: RatingIn,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to rate")
    _validate_entity(entity_type, entity_id)

    result = await db.execute(
        select(Rating).where(
            Rating.user_id == user_id,
            Rating.entity_type == entity_type,
            Rating.entity_id == entity_id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.value = body.value
    else:
        db.add(Rating(user_id=user_id, entity_type=entity_type, entity_id=entity_id, value=body.value))

    await db.commit()
    return {"ok": True, "value": body.value}


@router.get("/{entity_type}/{entity_id}/summary")
async def summary(
    entity_type: str,
    entity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    result = await db.execute(
        select(func.avg(Rating.value), func.count(Rating.id)).where(
            Rating.entity_type == entity_type,
            Rating.entity_id == entity_id,
        )
    )
    avg_val, count = result.one()

    user_rating = None
    user_review = None
    if user_id:
        ur = await db.execute(
            select(Rating.value).where(
                Rating.user_id == user_id,
                Rating.entity_type == entity_type,
                Rating.entity_id == entity_id,
            )
        )
        user_rating = ur.scalar_one_or_none()

        rv = await db.execute(
            select(Review.body).where(
                Review.user_id == user_id,
                Review.entity_type == entity_type,
                Review.entity_id == entity_id,
            )
        )
        user_review = rv.scalar_one_or_none()

    return {
        "average": round(avg_val, 2) if avg_val else None,
        "count": count,
        "user_rating": user_rating,
        "user_review": user_review,
    }


@router.post("/{entity_type}/{entity_id}/review")
async def upsert_review(
    entity_type: str,
    entity_id: str,
    body: ReviewIn,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to leave a review")
    if entity_type not in ("album", "track"):
        raise HTTPException(status_code=400, detail="entity_type must be album or track")
    if not body.body.strip():
        raise HTTPException(status_code=400, detail="Review cannot be empty")

    # Upsert rating if provided alongside review
    if body.value is not None:
        r = await db.execute(
            select(Rating).where(
                Rating.user_id == user_id,
                Rating.entity_type == entity_type,
                Rating.entity_id == entity_id,
            )
        )
        existing_rating = r.scalar_one_or_none()
        if existing_rating:
            existing_rating.value = body.value
        else:
            db.add(Rating(user_id=user_id, entity_type=entity_type, entity_id=entity_id, value=body.value))

    # Upsert review
    rv = await db.execute(
        select(Review).where(
            Review.user_id == user_id,
            Review.entity_type == entity_type,
            Review.entity_id == entity_id,
        )
    )
    existing_review = rv.scalar_one_or_none()
    if existing_review:
        existing_review.body = body.body.strip()
        existing_review.updated_at = datetime.utcnow()
    else:
        db.add(Review(
            user_id=user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            body=body.body.strip(),
        ))

    await db.commit()
    return {"ok": True}


@router.get("/{entity_type}/{entity_id}/reviews")
async def list_reviews(
    entity_type: str,
    entity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    result = await db.execute(
        select(Review).where(
            Review.entity_type == entity_type,
            Review.entity_id == entity_id,
        ).order_by(Review.created_at.desc())
    )
    reviews = result.scalars().all()

    out = []
    for rev in reviews:
        # Get user info
        u = await db.execute(select(User).where(User.id == rev.user_id))
        user = u.scalar_one_or_none()

        # Get rating for this user
        r = await db.execute(
            select(Rating.value).where(
                Rating.user_id == rev.user_id,
                Rating.entity_type == entity_type,
                Rating.entity_id == entity_id,
            )
        )
        rating_val = r.scalar_one_or_none()

        # Like count
        lc = await db.execute(
            select(func.count(ReviewLike.id)).where(ReviewLike.review_id == rev.id)
        )
        like_count = lc.scalar()

        # Did current user like this?
        liked_by_me = False
        if user_id:
            lm = await db.execute(
                select(ReviewLike).where(
                    ReviewLike.user_id == user_id,
                    ReviewLike.review_id == rev.id,
                )
            )
            liked_by_me = lm.scalar_one_or_none() is not None

        out.append({
            "id": rev.id,
            "body": rev.body,
            "created_at": rev.created_at.isoformat(),
            "rating": rating_val,
            "likes": like_count,
            "liked_by_me": liked_by_me,
            "user": {
                "display_name": user.display_name if user else "Unknown",
                "image_url": user.image_url if user else None,
            },
        })

    return out


@router.post("/reviews/{review_id}/like")
async def toggle_like(
    review_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to like reviews")

    existing = await db.execute(
        select(ReviewLike).where(
            ReviewLike.user_id == user_id,
            ReviewLike.review_id == review_id,
        )
    )
    like = existing.scalar_one_or_none()

    if like:
        await db.execute(
            delete(ReviewLike).where(
                ReviewLike.user_id == user_id,
                ReviewLike.review_id == review_id,
            )
        )
        liked = False
    else:
        db.add(ReviewLike(user_id=user_id, review_id=review_id))
        liked = True

    await db.commit()
    return {"liked": liked}
