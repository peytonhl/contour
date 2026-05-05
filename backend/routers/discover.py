"""
For You feed — personalized track discovery.

Personalization tiers
─────────────────────
Logged-in users:
  Taste profile is read server-side from UserTasteProfile (populated by the
  onboarding genre picker and auto-updated on 4–5 star track ratings).

Cold start (logged-out, or logged-in but no server profile yet):
  Falls back to client-sent genres/liked_artists from localStorage.
  If neither exist, serves Global Top 50 + new releases so the user gets
  variety while their taste is being learned.

Warm / hot (genres or liked_artists present):
  1. Related-artist tracks  — top tracks from artists similar to ones the user
                              rated 4–5 stars (most personalized)
  2. Genre-filtered search  — Spotify search filtered to learned genres
  3. Global Top 50 baseline — always provides something even with no prefs
  4. New releases filler    — adds freshness
  5. Keyword fallbacks      — last-resort, always returns something

All hot Spotify calls (Global Top 50, genre search, related artists, artist
top tracks) are cached in Redis for 24 hours so Spotify API quota is preserved
and the feed survives brief Spotify outages from cache.
"""

import asyncio
import json
import random
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Rating, UserTasteProfile
from routers.auth import optional_user_id
from services import spotify
from services.deezer import get_preview as deezer_preview
from services.limiter import limiter

router = APIRouter(prefix="/discover", tags=["discover"])

_FALLBACK_QUERIES = ["pop hits", "hip hop hits", "indie pop", "top songs 2024"]


@router.get("/feed")
@limiter.limit("20/minute")
async def get_discover_feed(
    request: Request,  # required by slowapi
    genres: Optional[str] = Query(None, description="Comma-separated genre slugs from client prefs"),
    exclude: Optional[str] = Query(None, description="Comma-separated track IDs to skip"),
    liked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs rated 4–5 stars"),
    limit: int = Query(10, le=20),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """
    Return a batch of tracks for the For You scroll feed.
    For logged-in users the taste profile is read server-side; client params
    are used as fallback for logged-out users and cold-start scenarios.
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

    # ── Resolve genre + artist preferences ───────────────────────────────────
    # Logged-in users: prefer server-side taste profile so preferences follow
    # them across devices.  Fall back to client params if profile is empty.
    genre_list: list[str] = []
    liked_artist_ids: list[str] = []

    if user_id:
        profile = await db.get(UserTasteProfile, user_id)
        if profile:
            genre_list = json.loads(profile.genres or "[]")
            liked_artist_ids = json.loads(profile.liked_artist_ids or "[]")

    # Fallback to client-sent values (logged-out users or empty server profile)
    if not genre_list:
        genre_list = [g.strip() for g in genres.split(",")] if genres else []
    if not liked_artist_ids:
        liked_artist_ids = [a.strip() for a in liked_artists.split(",")] if liked_artists else []

    tracks: list[dict] = []
    seen: set[str] = set()

    def _add(batch: list[dict]) -> None:
        for t in batch:
            if t.get("id") and t["id"] not in exclude_ids and t["id"] not in seen:
                seen.add(t["id"])
                tracks.append(t)

    # ── Tier 1: Related-artist tracks (personalized) ──────────────────────────
    if liked_artist_ids:
        related_results = await asyncio.gather(*[
            spotify.get_related_artists(aid)
            for aid in liked_artist_ids[:3]
        ], return_exceptions=True)

        related_ids: list[str] = []
        for r in related_results:
            if isinstance(r, list):
                related_ids.extend(r[:4])
        related_ids = list(dict.fromkeys(related_ids))
        random.shuffle(related_ids)
        related_ids = related_ids[:6]

        if related_ids:
            top_track_results = await asyncio.gather(*[
                spotify.get_artist_top_tracks(aid)
                for aid in related_ids
            ], return_exceptions=True)
            for result in top_track_results:
                if isinstance(result, list):
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

    # If every tier failed (Spotify down / rate-limited), return 503 so the
    # client can show "Try again" rather than silently rendering an empty feed.
    if not tracks:
        raise HTTPException(
            status_code=503,
            detail="Music feed temporarily unavailable — please try again in a moment.",
        )

    result = tracks[:limit]
    random.shuffle(result)

    # ── Deezer preview enrichment ─────────────────────────────────────────────
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
