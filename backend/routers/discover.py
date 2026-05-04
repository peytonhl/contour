"""For You feed — personalized track discovery."""

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Rating
from routers.auth import optional_user_id
from services import spotify

router = APIRouter(prefix="/discover", tags=["discover"])


@router.get("/feed")
async def get_discover_feed(
    genres: Optional[str] = Query(None, description="Comma-separated genre slugs from Spotify"),
    exclude: Optional[str] = Query(None, description="Comma-separated track IDs to skip"),
    limit: int = Query(10, le=20),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """
    Return a batch of tracks for the For You scroll feed.

    Personalization tiers (best to worst):
      1. Genre-filtered search (genres param from client's learned prefs)
      2. Global Top 50 baseline

    Already-rated tracks and client-side seen IDs are excluded.
    """
    exclude_ids: set[str] = set(exclude.split(",")) if exclude else set()

    # Also server-side exclude tracks this user has rated
    if user_id:
        rated_ids = (await db.execute(
            select(Rating.entity_id).where(
                Rating.user_id == user_id,
                Rating.entity_type == "track",
            )
        )).scalars().all()
        exclude_ids.update(rated_ids)

    genre_list = [g.strip() for g in genres.split(",")] if genres else []

    tracks: list[dict] = []
    seen: set[str] = set()

    def _add(batch: list[dict]) -> None:
        for t in batch:
            if t.get("id") and t["id"] not in exclude_ids and t["id"] not in seen:
                seen.add(t["id"])
                tracks.append(t)

    # ── Genre-personalized layer ──────────────────────────────────────────────
    if genre_list:
        results = await asyncio.gather(*[
            spotify.search_tracks_by_genre(g, limit=15)
            for g in genre_list[:3]
        ], return_exceptions=True)
        for res in results:
            if isinstance(res, list):
                _add(res)

    # ── Baseline: global top tracks (always mixed in) ─────────────────────────
    if len(tracks) < limit:
        top = await spotify.get_global_top_tracks(limit=50)
        _add(top)

    # ── New releases as extra filler ─────────────────────────────────────────
    if len(tracks) < limit:
        try:
            releases = await spotify.get_new_releases(limit=20)
            # Get top track from each album for preview
            album_track_tasks = [
                spotify.get_album_tracks(album["id"])
                for album in releases[:8]
            ]
            album_tracks = await asyncio.gather(*album_track_tasks, return_exceptions=True)
            for result in album_tracks:
                if isinstance(result, list) and result:
                    # Take the first track from each album that has a preview
                    for t in result:
                        if t.get("preview_url"):
                            # Enrich with album image via parent album search
                            _add([t])
                            break
        except Exception:
            pass

    return tracks[:limit]
