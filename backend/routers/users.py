"""Public user profiles and follow/unfollow."""

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User, UserFollow, Rating, Review, ArtistFavorite
from routers.auth import decode_jwt, optional_user_id
from routers.notifications import create_notification

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
