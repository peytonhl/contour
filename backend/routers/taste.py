"""
Server-side taste profile — genres + liked artists stored per user.

GET  /taste/profile  → return current user's profile
POST /taste/profile  → upsert (merge artists, replace genres if provided)

Used by the For You discover feed so preferences follow the user across
devices.  Also populated by the onboarding genre picker and auto-updated
whenever the user gives a track 4–5 stars.
"""

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import ArtistCache, UserTasteProfile
from routers.auth import require_user_id
from services import spotify

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/taste", tags=["taste"])


class TasteProfileIn(BaseModel):
    genres: list[str] = []
    liked_artist_ids: list[str] = []
    onboarding_done: bool = False
    # Optional negative-signal lists. None (not sent) means "leave the column
    # alone" — distinct from [] which means "replace with empty". The frontend
    # sends a value only when the user has edited the excluded-genres list,
    # so accidental empty bodies don't wipe it.
    excluded_genres: Optional[list[str]] = None


@router.get("/profile")
async def get_taste_profile(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Return the authenticated user's taste profile."""
    try:
        profile = await db.get(UserTasteProfile, user_id)
    except Exception:
        return {
            "genres": [], "excluded_genres": [], "liked_artist_ids": [],
            "disliked_artist_ids": [], "down_weighted_artist_ids": [],
            "onboarding_done": False,
        }
    if not profile:
        return {
            "genres": [], "excluded_genres": [], "liked_artist_ids": [],
            "disliked_artist_ids": [], "down_weighted_artist_ids": [],
            "onboarding_done": False,
        }
    # excluded_genres may be missing on rows created before migration
    # x4y5z6a7b8c9 ran — getattr keeps the endpoint from 500-ing during the
    # brief deploy window between code reaching the API and the migration
    # finishing on Railway startup.
    return {
        "genres": json.loads(profile.genres or "[]"),
        "excluded_genres": json.loads(getattr(profile, "excluded_genres", None) or "[]"),
        "liked_artist_ids": json.loads(profile.liked_artist_ids or "[]"),
        "disliked_artist_ids": json.loads(profile.disliked_artist_ids or "[]"),
        "down_weighted_artist_ids": json.loads(profile.down_weighted_artist_ids or "[]"),
        "onboarding_done": profile.onboarding_done,
    }


class DislikeIn(BaseModel):
    artist_id: str


@router.post("/dislike")
async def add_dislike(
    body: DislikeIn,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """
    Add an artist to the user's hard-dislike list ("Not interested" click).
    Idempotent — duplicate calls return ok without changes.
    Also strips the artist from liked_artist_ids if present.
    """
    artist_id = (body.artist_id or "").strip()
    if not artist_id:
        return {"ok": False, "reason": "empty artist_id"}

    profile = await db.get(UserTasteProfile, user_id)
    if profile:
        existing = json.loads(profile.disliked_artist_ids or "[]")
        if artist_id not in existing:
            profile.disliked_artist_ids = json.dumps(([artist_id] + existing)[:200])
        liked = json.loads(profile.liked_artist_ids or "[]")
        if artist_id in liked:
            profile.liked_artist_ids = json.dumps([a for a in liked if a != artist_id])
        profile.updated_at = datetime.utcnow()
    else:
        profile = UserTasteProfile(
            user_id=user_id,
            liked_artist_ids=json.dumps([]),
            genres=json.dumps([]),
            disliked_artist_ids=json.dumps([artist_id]),
            onboarding_done=False,
        )
        db.add(profile)
    await db.commit()
    # Bust the cached /feed state so the dislike takes effect on the
    # next swipe batch instead of waiting up to 30s for the TTL.
    from routers.discover import _bust_discover_state_cache
    asyncio.create_task(_bust_discover_state_cache(user_id))
    return {"ok": True}


@router.delete("/dislike/{artist_id}")
async def remove_dislike(
    artist_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Remove an artist from the hard-dislike list (e.g. user un-dismissed)."""
    profile = await db.get(UserTasteProfile, user_id)
    if not profile:
        return {"ok": True}
    existing = json.loads(profile.disliked_artist_ids or "[]")
    if artist_id in existing:
        profile.disliked_artist_ids = json.dumps([a for a in existing if a != artist_id])
        profile.updated_at = datetime.utcnow()
        await db.commit()
        from routers.discover import _bust_discover_state_cache
        asyncio.create_task(_bust_discover_state_cache(user_id))
    return {"ok": True}


@router.delete("/dislikes")
async def clear_dislikes(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Clear the entire hard-dislike list — backs the 'Clear not-interested' button."""
    profile = await db.get(UserTasteProfile, user_id)
    if not profile:
        return {"ok": True}
    profile.disliked_artist_ids = json.dumps([])
    profile.updated_at = datetime.utcnow()
    await db.commit()
    from routers.discover import _bust_discover_state_cache
    asyncio.create_task(_bust_discover_state_cache(user_id))
    return {"ok": True}


class TasteResetIn(BaseModel):
    """Body for /taste/reset. Defaults are conservative — caller must
    explicitly opt-in to each destructive action so a buggy client can't
    accidentally wipe everything."""
    genres: bool = False
    excluded_genres: bool = False
    liked_artist_ids: bool = False
    disliked_artist_ids: bool = False
    down_weighted_artist_ids: bool = False


@router.post("/reset")
async def reset_taste_profile(
    body: TasteResetIn,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Selectively reset parts of the user's taste profile.

    Powers the "Reset taste profile" affordance on the transparency view.
    Does NOT delete the underlying ratings — those stay so the user can
    re-derive their taste profile if they change their mind. The reset
    only wipes the per-user state that DIRECTLY drives feed personalization
    (the genre list, excluded genres, liked-artist seed list, dislikes,
    down-weighted artists).

    Each field is opt-in via the request body. A reasonable "soft reset"
    sends `{"liked_artist_ids": true, "down_weighted_artist_ids": true}` —
    re-derives those from ratings without losing the user's curated genre
    picks. A "full reset" sends all five flags.

    The system will repopulate liked_artist_ids and the auto-extended
    portion of `genres` over time via _update_taste_from_rating on the
    user's next high ratings.
    """
    profile = await db.get(UserTasteProfile, user_id)
    if not profile:
        return {"ok": True, "reset": []}

    reset_fields: list[str] = []
    if body.genres:
        profile.genres = json.dumps([])
        reset_fields.append("genres")
    if body.excluded_genres:
        profile.excluded_genres = json.dumps([])
        reset_fields.append("excluded_genres")
    if body.liked_artist_ids:
        profile.liked_artist_ids = json.dumps([])
        reset_fields.append("liked_artist_ids")
    if body.disliked_artist_ids:
        profile.disliked_artist_ids = json.dumps([])
        reset_fields.append("disliked_artist_ids")
    if body.down_weighted_artist_ids:
        profile.down_weighted_artist_ids = json.dumps([])
        reset_fields.append("down_weighted_artist_ids")

    if reset_fields:
        profile.updated_at = datetime.utcnow()
        await db.commit()
        from routers.discover import _bust_discover_state_cache
        asyncio.create_task(_bust_discover_state_cache(user_id))
    return {"ok": True, "reset": reset_fields}


async def _enrich_artist(artist_id: str, db: AsyncSession) -> dict:
    """
    Resolve an artist ID to {id, name, image_url}. Tries ArtistCache first
    (no network) and falls back to Spotify. On failure returns the bare ID
    so the management page can still show + remove the entry.
    """
    cached = (await db.execute(
        select(ArtistCache).where(ArtistCache.spotify_id == artist_id)
    )).scalar_one_or_none()
    if cached and cached.name:
        return {"id": artist_id, "name": cached.name, "image_url": None}
    try:
        meta = await spotify.get_artist(artist_id)
        return {
            "id": artist_id,
            "name": meta.get("name") or artist_id,
            "image_url": meta.get("image_url"),
        }
    except Exception as exc:
        logger.warning("[taste] failed to enrich artist %s: %s", artist_id, exc)
        return {"id": artist_id, "name": artist_id, "image_url": None}


@router.get("/dislikes")
async def list_dislikes(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """
    Return the user's disliked artists enriched with display name + image,
    in newest-first order. Backs the "Disliked artists" management page.
    """
    profile = await db.get(UserTasteProfile, user_id)
    if not profile:
        return []
    ids: list[str] = json.loads(profile.disliked_artist_ids or "[]")
    if not ids:
        return []
    enriched = await asyncio.gather(*[_enrich_artist(aid, db) for aid in ids])
    return enriched


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
        # excluded_genres uses `is not None` rather than truthiness so an
        # empty list (`[]`) can clear the previous selection — clicking the
        # last "exclude" toggle off should remove it from the column, not
        # leave the stale value.
        if body.excluded_genres is not None:
            profile.excluded_genres = json.dumps(body.excluded_genres[:30])
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
            excluded_genres=json.dumps((body.excluded_genres or [])[:30]),
            liked_artist_ids=json.dumps(body.liked_artist_ids[:20]),
            onboarding_done=body.onboarding_done,
        )
        db.add(profile)

    await db.commit()
    from routers.discover import _bust_discover_state_cache
    asyncio.create_task(_bust_discover_state_cache(user_id))
    return {"ok": True}
