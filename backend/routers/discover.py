"""
For You feed — personalized track discovery.

Personalization tiers
─────────────────────
Cold start (< COLD_START_THRESHOLD ratings on the client):
  The client sends no genres / liked_artists → we serve global top 50 + new
  releases so the user gets variety while their taste is being learned.

Warm / hot (≥ threshold):
  1. Related-artist tracks  — top tracks from artists similar to ones the user
                              rated 4–5 stars (most personalized)
  2. Genre-filtered search  — Spotify search filtered to learned genres
  3. Global Top 50 baseline — always provides something even with no prefs
  4. New releases filler    — adds freshness
  5. Keyword fallbacks      — last-resort, always returns something
"""

import asyncio
import random
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Rating
from routers.auth import optional_user_id
from services import spotify
from services.deezer import get_preview as deezer_preview

router = APIRouter(prefix="/discover", tags=["discover"])

_FALLBACK_QUERIES = ["pop hits", "hip hop hits", "indie pop", "top songs 2024"]


@router.get("/feed")
async def get_discover_feed(
    genres: Optional[str] = Query(None, description="Comma-separated genre slugs from client prefs"),
    exclude: Optional[str] = Query(None, description="Comma-separated track IDs to skip"),
    liked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs rated 4–5 stars"),
    limit: int = Query(10, le=20),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """
    Return a batch of tracks for the For You scroll feed.
    The client is responsible for cold-start detection; it sends liked_artists
    only after the threshold is met.
    """
    exclude_ids: set[str] = set(filter(None, exclude.split(","))) if exclude else set()

    # Server-side: also exclude tracks this user has already rated
    if user_id:
        rated_ids = (await db.execute(
            select(Rating.entity_id).where(
                Rating.user_id == user_id,
                Rating.entity_type == "track",
            )
        )).scalars().all()
        exclude_ids.update(rated_ids)

    genre_list = [g.strip() for g in genres.split(",")] if genres else []
    liked_artist_ids = [a.strip() for a in liked_artists.split(",")] if liked_artists else []

    tracks: list[dict] = []
    seen: set[str] = set()

    def _add(batch: list[dict]) -> None:
        for t in batch:
            if t.get("id") and t["id"] not in exclude_ids and t["id"] not in seen:
                seen.add(t["id"])
                tracks.append(t)

    # ── Tier 1: Related-artist tracks (personalized — only when warm) ─────────
    if liked_artist_ids:
        # Fetch related artists for up to 3 liked artists concurrently
        related_results = await asyncio.gather(*[
            spotify.get_related_artists(aid)
            for aid in liked_artist_ids[:3]
        ], return_exceptions=True)

        # Flatten, dedupe, shuffle, take up to 6 related artists
        related_ids: list[str] = []
        for r in related_results:
            if isinstance(r, list):
                related_ids.extend(r[:4])
        related_ids = list(dict.fromkeys(related_ids))  # dedupe, preserve order
        random.shuffle(related_ids)
        related_ids = related_ids[:6]

        if related_ids:
            top_track_results = await asyncio.gather(*[
                spotify.get_artist_top_tracks(aid)
                for aid in related_ids
            ], return_exceptions=True)
            for result in top_track_results:
                if isinstance(result, list):
                    # Pick one random track per related artist to keep variety
                    candidates = [t for t in result if t.get("preview_url")]
                    if candidates:
                        _add([random.choice(candidates)])

    # ── Tier 2: Genre-personalized search ────────────────────────────────────
    if genre_list and len(tracks) < limit:
        genre_results = await asyncio.gather(*[
            spotify.search_tracks_by_genre(g, limit=15)
            for g in genre_list[:3]
        ], return_exceptions=True)
        for res in genre_results:
            if isinstance(res, list):
                _add(res)

    # ── Tier 3: Global Top 50 baseline ───────────────────────────────────────
    if len(tracks) < limit:
        try:
            top = await spotify.get_global_top_tracks(limit=50)
            # Shuffle so the feed doesn't start with the same chart order every time
            random.shuffle(top)
            _add(top)
        except Exception:
            pass

    # ── Tier 4: New releases filler ──────────────────────────────────────────
    if len(tracks) < limit:
        try:
            releases = await spotify.get_new_releases(limit=20)
            album_track_tasks = [
                spotify.get_album_tracks(album["id"])
                for album in releases[:8]
            ]
            album_tracks = await asyncio.gather(*album_track_tasks, return_exceptions=True)
            for result in album_tracks:
                if isinstance(result, list) and result:
                    for t in result:
                        if t.get("preview_url"):
                            _add([t])
                            break
        except Exception:
            pass

    # ── Tier 5: Keyword fallbacks — always produces results ──────────────────
    if len(tracks) < limit:
        fallback_results = await asyncio.gather(*[
            spotify.search_tracks(q, limit=10)
            for q in _FALLBACK_QUERIES
        ], return_exceptions=True)
        for res in fallback_results:
            if isinstance(res, list):
                _add(res)
            if len(tracks) >= limit:
                break

    # Shuffle the final slice lightly so tiers don't feel rigidly ordered
    result = tracks[:limit]
    random.shuffle(result)

    # ── Deezer preview enrichment ─────────────────────────────────────────────
    # Spotify deprecated preview_url for most tracks in late 2023.
    # For tracks still missing one, fetch a 30s Deezer preview concurrently.
    # The frontend's existing custom audio player picks them up automatically.
    no_preview = [t for t in result if not t.get("preview_url")]
    if no_preview:
        deezer_tasks = [
            deezer_preview(t.get("name", ""), (t.get("artists") or [""])[0])
            for t in no_preview
        ]
        deezer_urls = await asyncio.gather(*deezer_tasks, return_exceptions=True)
        url_iter = iter(deezer_urls)
        for t in result:
            if not t.get("preview_url"):
                url = next(url_iter)
                if isinstance(url, str) and url:
                    t["preview_url"] = url

    return result
