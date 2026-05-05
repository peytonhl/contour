"""User-created lists of albums, tracks, and artists."""

import asyncio
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User, UserList, UserListItem
from routers.auth import decode_jwt, optional_user_id
from services import spotify

router = APIRouter(prefix="/lists", tags=["lists"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _require_auth(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_jwt(authorization[7:])


async def _enrich_items(items: list[UserListItem]) -> list[dict]:
    """Fetch Spotify metadata for each list item in parallel."""
    async def fetch(item: UserListItem):
        try:
            if item.entity_type == "track":
                data = await spotify.get_track(item.entity_id)
            elif item.entity_type == "album":
                data = await spotify.get_album(item.entity_id)
            else:
                data = await spotify.get_artist(item.entity_id)
            return {
                "id": item.id,
                "position": item.position,
                "entity_type": item.entity_type,
                "entity_id": item.entity_id,
                "entity_name": data.get("name"),
                "entity_image_url": data.get("image_url"),
                "entity_artists": data.get("artists", []),
                "release_date": data.get("release_date"),
                "note": item.note,
            }
        except Exception:
            return {
                "id": item.id,
                "position": item.position,
                "entity_type": item.entity_type,
                "entity_id": item.entity_id,
                "entity_name": None,
                "entity_image_url": None,
                "entity_artists": [],
                "release_date": None,
                "note": item.note,
            }

    return await asyncio.gather(*[fetch(i) for i in items])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ListCreate(BaseModel):
    title: str
    description: Optional[str] = None
    is_ranked: bool = True


class ListUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    is_ranked: Optional[bool] = None


class ItemSchema(BaseModel):
    entity_type: str   # "album" | "track" | "artist"
    entity_id: str
    note: Optional[str] = None


class ItemsUpdate(BaseModel):
    items: list[ItemSchema]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/")
async def create_list(
    body: ListCreate,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Create a new empty list."""
    user_id = await _require_auth(authorization)
    title = body.title.strip()[:200]
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    lst = UserList(
        user_id=user_id,
        title=title,
        description=body.description.strip()[:500] if body.description else None,
        is_ranked=body.is_ranked,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(lst)
    await db.commit()
    await db.refresh(lst)
    return {"id": lst.id, "title": lst.title, "is_ranked": lst.is_ranked}


@router.get("/{list_id}")
async def get_list(
    list_id: int,
    viewer_id: Optional[str] = Depends(optional_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Get a list with enriched items."""
    lst = (await db.execute(select(UserList).where(UserList.id == list_id))).scalar_one_or_none()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")

    owner = (await db.execute(select(User).where(User.id == lst.user_id))).scalar_one_or_none()

    items_rows = (await db.execute(
        select(UserListItem)
        .where(UserListItem.list_id == list_id)
        .order_by(UserListItem.position)
    )).scalars().all()

    enriched = await _enrich_items(list(items_rows))

    return {
        "id": lst.id,
        "title": lst.title,
        "description": lst.description,
        "is_ranked": lst.is_ranked,
        "created_at": lst.created_at.isoformat(),
        "updated_at": lst.updated_at.isoformat(),
        "is_owner": viewer_id == lst.user_id,
        "owner": {
            "id": owner.id,
            "display_name": owner.display_name,
            "image_url": owner.image_url,
        } if owner else None,
        "items": enriched,
        "item_count": len(enriched),
    }


@router.patch("/{list_id}")
async def update_list(
    list_id: int,
    body: ListUpdate,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Update list title, description, or ranked flag (owner only)."""
    user_id = await _require_auth(authorization)
    lst = (await db.execute(select(UserList).where(UserList.id == list_id))).scalar_one_or_none()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    if lst.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your list")

    if body.title is not None:
        lst.title = body.title.strip()[:200]
    if body.description is not None:
        lst.description = body.description.strip()[:500] or None
    if body.is_ranked is not None:
        lst.is_ranked = body.is_ranked
    lst.updated_at = datetime.utcnow()

    await db.commit()
    return {"ok": True}


@router.delete("/{list_id}")
async def delete_list(
    list_id: int,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Delete a list and all its items (owner only)."""
    user_id = await _require_auth(authorization)
    lst = (await db.execute(select(UserList).where(UserList.id == list_id))).scalar_one_or_none()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    if lst.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your list")

    await db.execute(delete(UserListItem).where(UserListItem.list_id == list_id))
    await db.execute(delete(UserList).where(UserList.id == list_id))
    await db.commit()
    return {"ok": True}


@router.put("/{list_id}/items")
async def update_list_items(
    list_id: int,
    body: ItemsUpdate,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Replace all items in the list (full reorder/add/remove in one call).
    Sends the complete desired item array with positions implicit from order.
    """
    user_id = await _require_auth(authorization)
    lst = (await db.execute(select(UserList).where(UserList.id == list_id))).scalar_one_or_none()
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    if lst.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your list")

    # Validate entity types
    valid_types = {"album", "track", "artist"}
    for item in body.items:
        if item.entity_type not in valid_types:
            raise HTTPException(status_code=400, detail=f"Invalid entity_type: {item.entity_type}")

    # Replace all items
    await db.execute(delete(UserListItem).where(UserListItem.list_id == list_id))
    for i, item in enumerate(body.items[:100], start=1):  # max 100 items
        db.add(UserListItem(
            list_id=list_id,
            position=i,
            entity_type=item.entity_type,
            entity_id=item.entity_id,
            note=item.note.strip()[:500] if item.note else None,
        ))

    lst.updated_at = datetime.utcnow()
    await db.commit()
    return {"ok": True, "item_count": len(body.items)}
