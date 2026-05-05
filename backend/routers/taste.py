"""
Server-side taste profile — genres + liked artists stored per user.

GET  /taste/profile  → return current user's profile
POST /taste/profile  → upsert (merge artists, replace genres if provided)

Used by the For You discover feed so preferences follow the user across
devices.  Also populated by the onboarding genre picker and auto-updated
whenever the user gives a track 4–5 stars.
"""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import UserTasteProfile
from routers.auth import require_user_id

router = APIRouter(prefix="/taste", tags=["taste"])


class TasteProfileIn(BaseModel):
    genres: list[str] = []
    liked_artist_ids: list[str] = []
    onboarding_done: bool = False


@router.get("/profile")
async def get_taste_profile(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Return the authenticated user's taste profile."""
    profile = await db.get(UserTasteProfile, user_id)
    if not profile:
        return {"genres": [], "liked_artist_ids": [], "onboarding_done": False}
    return {
        "genres": json.loads(profile.genres or "[]"),
        "liked_artist_ids": json.loads(profile.liked_artist_ids or "[]"),
        "onboarding_done": profile.onboarding_done,
    }


@router.post("/profile")
async def upsert_taste_profile(
    body: TasteProfileIn,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """
    Upsert the taste profile.
    - genres replaces the previous list if provided.
    - liked_artist_ids is *merged* with existing (new ones prepended, deduped, capped at 20).
    - onboarding_done is a one-way flag: once True it stays True.
    """
    profile = await db.get(UserTasteProfile, user_id)
    if profile:
        if body.genres:
            profile.genres = json.dumps(body.genres[:20])
        if body.liked_artist_ids:
            existing = json.loads(profile.liked_artist_ids or "[]")
            merged = list(dict.fromkeys(body.liked_artist_ids + existing))[:20]
            profile.liked_artist_ids = json.dumps(merged)
        if body.onboarding_done:
            profile.onboarding_done = True
        profile.updated_at = datetime.utcnow()
    else:
        profile = UserTasteProfile(
            user_id=user_id,
            genres=json.dumps(body.genres[:20]),
            liked_artist_ids=json.dumps(body.liked_artist_ids[:20]),
            onboarding_done=body.onboarding_done,
        )
        db.add(profile)

    await db.commit()
    return {"ok": True}
