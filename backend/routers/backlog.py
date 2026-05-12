"""Backlog ("Want to listen") endpoints.

Supports albums and tracks. All backlogs are public — no privacy field.
The intent is social discovery: friends should see what you're excited about.

Route ordering note: the literal `/check/...` and `/{entity_type}/{entity_id}/promote`
paths must be declared BEFORE `/{user_id}` so FastAPI doesn't treat "check" as a
user_id.
"""

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlbumCache, BacklogItem, Rating, TrackCache
from routers.auth import optional_user_id, require_user_id
from services.limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/backlog", tags=["backlog"])

SPOTIFY_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")
VALID_ENTITY_TYPES = {"album", "track"}


class BacklogAddIn(BaseModel):
    entity_type: str = Field(..., description="'album' or 'track'")
    entity_id: str = Field(..., min_length=1, max_length=64)
    note: Optional[str] = Field(None, max_length=500)

    @field_validator("entity_type")
    @classmethod
    def _validate_type(cls, v):
        if v not in VALID_ENTITY_TYPES:
            raise ValueError("entity_type must be 'album' or 'track'")
        return v


class PromoteIn(BaseModel):
    rating: Optional[float] = None  # 0.5..5.0, optional


def _validate_entity(entity_type: str, entity_id: str) -> None:
    if entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid entity_type")
    if not SPOTIFY_ID_RE.match(entity_id):
        raise HTTPException(status_code=400, detail="Invalid entity_id format")


async def _serialize_items(db: AsyncSession, items: list[BacklogItem]) -> list[dict]:
    """Hydrate items with cached metadata from AlbumCache / TrackCache."""
    if not items:
        return []
    album_ids = [i.entity_id for i in items if i.entity_type == "album"]
    track_ids = [i.entity_id for i in items if i.entity_type == "track"]

    album_meta: dict = {}
    track_meta: dict = {}

    if album_ids:
        rows = (await db.execute(
            select(AlbumCache).where(AlbumCache.spotify_id.in_(album_ids))
        )).scalars().all()
        album_meta = {r.spotify_id: r for r in rows}
    if track_ids:
        rows = (await db.execute(
            select(TrackCache).where(TrackCache.spotify_id.in_(track_ids))
        )).scalars().all()
        track_meta = {r.spotify_id: r for r in rows}

    out: list[dict] = []
    for i in items:
        if i.entity_type == "album":
            a = album_meta.get(i.entity_id)
            entity = {
                "id": i.entity_id,
                "name": a.name if a else None,
                "artist": a.artist if a else None,
                "image_url": a.image_url if a else None,
                "release_date": a.release_date if a else None,
            }
        else:  # track
            t = track_meta.get(i.entity_id)
            entity = {
                "id": i.entity_id,
                "name": t.name if t else None,
                "artist": t.artist if t else None,
                "image_url": t.image_url if t else None,
                "release_date": t.release_date if t else None,
            }
        out.append({
            "id": i.id,
            "entity_type": i.entity_type,
            "entity_id": i.entity_id,
            # Legacy aliases — frontend builds shipped before this change
            # still read .album_id / .album. Safe to drop once the next Vercel
            # deploy has propagated.
            "album_id": i.entity_id if i.entity_type == "album" else None,
            "added_at": i.added_at.isoformat(),
            "note": i.note,
            "entity": entity,
            "album": entity if i.entity_type == "album" else None,
        })
    return out


def _apply_sort(serialized: list[dict], sort: str) -> list[dict]:
    """Sort serialized rows. `recent` is pre-sorted by added_at desc upstream."""
    if sort == "artist":
        return sorted(serialized, key=lambda r: (r["entity"].get("artist") or "").lower())
    if sort == "release":
        return sorted(
            serialized,
            key=lambda r: r["entity"].get("release_date") or "",
            reverse=True,
        )
    return serialized


@router.post("")
@limiter.limit("60/minute")
async def add_to_backlog(
    request: Request,
    body: BacklogAddIn,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    _validate_entity(body.entity_type, body.entity_id)
    existing = (await db.execute(
        select(BacklogItem).where(
            BacklogItem.user_id == user_id,
            BacklogItem.entity_type == body.entity_type,
            BacklogItem.entity_id == body.entity_id,
        )
    )).scalar_one_or_none()
    if existing:
        if body.note is not None:
            existing.note = body.note
            await db.commit()
        return {"ok": True, "already_present": True, "id": existing.id}

    item = BacklogItem(
        user_id=user_id,
        entity_type=body.entity_type,
        entity_id=body.entity_id,
        note=body.note,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return {"ok": True, "already_present": False, "id": item.id}


@router.delete("/{entity_type}/{entity_id}")
@limiter.limit("60/minute")
async def remove_from_backlog(
    request: Request,
    entity_type: str,
    entity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    _validate_entity(entity_type, entity_id)
    await db.execute(delete(BacklogItem).where(
        BacklogItem.user_id == user_id,
        BacklogItem.entity_type == entity_type,
        BacklogItem.entity_id == entity_id,
    ))
    await db.commit()
    return {"ok": True}


@router.get("")
async def get_my_backlog(
    sort: str = Query("recent", pattern="^(recent|artist|release)$"),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    items = (await db.execute(
        select(BacklogItem)
        .where(BacklogItem.user_id == user_id)
        .order_by(BacklogItem.added_at.desc())
    )).scalars().all()
    return _apply_sort(await _serialize_items(db, items), sort)


# ── Literal routes BEFORE /{user_id} ─────────────────────────────────────────

@router.get("/check/{entity_type}/{entity_id}")
async def check_in_backlog(
    entity_type: str,
    entity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """Lightweight existence check — powers the toggle button on entity pages."""
    if not user_id:
        return {"in_backlog": False}
    _validate_entity(entity_type, entity_id)
    row = (await db.execute(
        select(BacklogItem.id).where(
            BacklogItem.user_id == user_id,
            BacklogItem.entity_type == entity_type,
            BacklogItem.entity_id == entity_id,
        )
    )).scalar_one_or_none()
    return {"in_backlog": row is not None}


@router.post("/{entity_type}/{entity_id}/promote")
@limiter.limit("60/minute")
async def promote_to_rating(
    request: Request,
    entity_type: str,
    entity_id: str,
    body: PromoteIn,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Mark a backlog item as listened.

    If `rating` is provided, also upsert a Rating row for the matching
    entity_type (so promoting a track creates a track rating, not an album
    rating). If omitted, the row is removed from the backlog and the client
    is expected to navigate to the entity page so the user can rate through
    the normal /ratings flow.
    """
    _validate_entity(entity_type, entity_id)

    rating_created = False
    if body.rating is not None:
        if body.rating not in {0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0}:
            raise HTTPException(status_code=400, detail="Rating must be a multiple of 0.5 between 0.5 and 5.0")
        existing = (await db.execute(
            select(Rating).where(
                Rating.user_id == user_id,
                Rating.entity_type == entity_type,
                Rating.entity_id == entity_id,
            )
        )).scalar_one_or_none()
        if existing:
            existing.value = body.rating
        else:
            db.add(Rating(
                user_id=user_id,
                entity_type=entity_type,
                entity_id=entity_id,
                value=body.rating,
            ))
        rating_created = True

    await db.execute(delete(BacklogItem).where(
        BacklogItem.user_id == user_id,
        BacklogItem.entity_type == entity_type,
        BacklogItem.entity_id == entity_id,
    ))
    await db.commit()
    return {"ok": True, "rating_created": rating_created}


# ── Public per-user fetch — leave LAST so it doesn't shadow literals ─────────

@router.get("/{user_id}")
async def get_user_backlog(
    user_id: str,
    sort: str = Query("recent", pattern="^(recent|artist|release)$"),
    db: AsyncSession = Depends(get_db),
):
    items = (await db.execute(
        select(BacklogItem)
        .where(BacklogItem.user_id == user_id)
        .order_by(BacklogItem.added_at.desc())
    )).scalars().all()
    return _apply_sort(await _serialize_items(db, items), sort)
