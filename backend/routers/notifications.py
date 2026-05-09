"""In-app notifications — follow, upvote, reply."""

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Notification, User, Review
from routers.auth import decode_jwt

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _require_user(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_jwt(authorization[7:])


@router.get("")
async def get_notifications(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Return the 40 most recent notifications for the authenticated user."""
    user_id = _require_user(authorization)

    rows = (await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(40)
    )).scalars().all()

    if not rows:
        return []

    # Fetch actor info in bulk
    actor_ids = list({n.actor_id for n in rows})
    actors = (await db.execute(
        select(User).where(User.id.in_(actor_ids))
    )).scalars().all()
    actor_map = {u.id: {"id": u.id, "display_name": u.display_name, "image_url": u.image_url} for u in actors}

    # Fetch review context (entity_type / entity_id) for upvote/reply notifications
    review_ids = [n.review_id for n in rows if n.review_id is not None]
    review_map: dict = {}
    if review_ids:
        reviews = (await db.execute(
            select(Review).where(Review.id.in_(review_ids))
        )).scalars().all()
        review_map = {r.id: r for r in reviews}

    out = []
    for n in rows:
        review = review_map.get(n.review_id) if n.review_id else None
        out.append({
            "id": n.id,
            "type": n.type,
            "read": n.read,
            "created_at": n.created_at.isoformat(),
            "actor": actor_map.get(n.actor_id),
            "review_id": n.review_id,
            "entity_type": review.entity_type if review else n.entity_type,
            "entity_id": review.entity_id if review else n.entity_id,
        })

    return out


@router.get("/unread-count")
async def unread_count(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Lightweight endpoint — just returns the unread notification count."""
    user_id = _require_user(authorization)
    count = (await db.execute(
        select(func.count()).select_from(Notification)
        .where(Notification.user_id == user_id, Notification.read == False)  # noqa: E712
    )).scalar()
    return {"count": count}


@router.post("/read-all")
async def mark_all_read(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Mark all notifications as read."""
    user_id = _require_user(authorization)
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read == False)  # noqa: E712
        .values(read=True)
    )
    await db.commit()
    return {"ok": True}


# ── Helper used by other routers ─────────────────────────────────────────────

async def create_notification(
    db: AsyncSession,
    *,
    user_id: str,
    type: str,
    actor_id: str,
    review_id: Optional[int] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
) -> None:
    """Create a notification. Silently no-ops if user_id == actor_id."""
    if user_id == actor_id:
        return
    db.add(Notification(
        user_id=user_id,
        type=type,
        actor_id=actor_id,
        review_id=review_id,
        entity_type=entity_type,
        entity_id=entity_id,
    ))
    # Caller is responsible for commit
