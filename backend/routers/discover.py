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
import logging
import random
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

logger = logging.getLogger(__name__)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Rating, UserTasteProfile
from routers.auth import optional_user_id
from services import spotify
from services.deezer import get_preview as deezer_preview
from services.limiter import limiter

router = APIRouter(prefix="/discover", tags=["discover"])

_FALLBACK_QUERIES = [
    "pop hits",
    "hip hop hits",
    "indie pop",
    "r&b hits",
    "alternative rock",
    "top songs",
]

# Well-known, reliably updated public playlists used as Tier 4 source
# New Music Friday US — updated every Friday by Spotify editorial
_NEW_MUSIC_FRIDAY_ID = "37i9dQZF1DX4JAvHpjipBk"


@router.get("/feed")
@limiter.limit("60/minute")
async def get_discover_feed(
    request: Request,
    genres: Optional[str] = Query(None, description="Comma-separated genre slugs from client prefs"),
    liked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs rated 4–5 stars"),
    disliked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs the user has marked 'not interested'"),
    limit: int = Query(10, le=20),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """
    Return a batch of tracks for the For You scroll feed.
    For logged-in users the taste profile is read server-side; client params
    are used as fallback for logged-out users and cold-start scenarios.
    """
    # Exclude tracks this user has already rated — the only permanent exclusion signal
    exclude_ids: set[str] = set()
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
        try:
            profile = await db.get(UserTasteProfile, user_id)
            if profile:
                genre_list = json.loads(profile.genres or "[]")
                liked_artist_ids = json.loads(profile.liked_artist_ids or "[]")
        except Exception:
            # Table may not exist yet on first deploy — degrade gracefully
            pass

    # Fallback to client-sent values (logged-out users or empty server profile)
    if not genre_list:
        genre_list = [g.strip() for g in genres.split(",")] if genres else []
    if not liked_artist_ids:
        liked_artist_ids = [a.strip() for a in liked_artists.split(",")] if liked_artists else []

    # Build disliked artist set — tracks from these artists are excluded
    disliked_ids: set[str] = (
        {a.strip() for a in disliked_artists.split(",") if a.strip()}
        if disliked_artists else set()
    )

    tracks: list[dict] = []
    seen: set[str] = set()

    def _add(batch: list[dict]) -> None:
        for t in batch:
            artist_id = (t.get("artist_ids") or [None])[0]
            if (
                t.get("id")
                and t["id"] not in exclude_ids
                and t["id"] not in seen
                and artist_id not in disliked_ids
            ):
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
            logger.info("discover: tier3 got %d top tracks", len(top))
            random.shuffle(top)
            _add(top)
        except Exception as exc:
            logger.warning("discover: tier3 failed — %s", exc)

    # ── Tier 4: New Music Friday playlist (replaces deprecated new-releases) ──
    if len(tracks) < limit:
        try:
            nmf_tracks = await spotify.get_playlist_tracks(_NEW_MUSIC_FRIDAY_ID, limit=30)
            _add(nmf_tracks)
        except Exception as exc:
            logger.warning("discover: tier4 failed — %s", exc)

    # ── Tier 5: Keyword fallbacks — always produces results ──────────────────
    if len(tracks) < limit:
        fallback_results = await asyncio.gather(*[
            spotify.search_tracks(q, limit=10)
            for q in _FALLBACK_QUERIES
        ], return_exceptions=True)
        for res in fallback_results:
            if isinstance(res, Exception):
                logger.warning("discover: tier5 fallback error — %s", res)
            elif isinstance(res, list):
                _add(res)
            if len(tracks) >= limit:
                break

    # ── Tier 5.5: Nuclear fallback — ignore disliked filter ──────────────────
    # If we still have nothing, the user has disliked so many popular artists
    # that every mainstream track is filtered out.  Serve tracks ignoring the
    # disliked-artist filter so the feed is never blank.
    if not tracks and disliked_ids:
        logger.info("discover: nuclear fallback — ignoring disliked filter (%d artists)", len(disliked_ids))
        try:
            top = await spotify.get_global_top_tracks(limit=50)
            for t in top:
                if t.get("id") and t["id"] not in exclude_ids and t["id"] not in seen:
                    seen.add(t["id"])
                    tracks.append(t)
                if len(tracks) >= limit:
                    break
        except Exception as exc:
            logger.warning("discover: nuclear fallback failed — %s", exc)

    logger.info(
        "discover: returning %d tracks (rated_excluded=%d, genres=%s, artists=%s)",
        len(tracks), len(exclude_ids), genre_list[:2], liked_artist_ids[:2],
    )

    if not tracks:
        logger.error("discover: all tiers failed — returning empty feed")
        return []

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


@router.get("/debug")
async def discover_debug():
    """
    Diagnostic endpoint — tests each feed tier independently and reports
    how many tracks each produced.  Use this to diagnose empty feed issues
    without having to read through logs.
    """
    import time
    import httpx
    from services import spotify as spotify_svc

    results: dict[str, dict] = {}

    # ── Spotify token ─────────────────────────────────────────────────────────
    try:
        t0 = time.monotonic()
        async with httpx.AsyncClient() as client:
            await spotify_svc._get_token(client)
        results["spotify_auth"] = {"ok": True, "latency_ms": round((time.monotonic() - t0) * 1000)}
    except Exception as exc:
        results["spotify_auth"] = {"ok": False, "error": str(exc)}

    # ── Tier 3: Global Top 50 ─────────────────────────────────────────────────
    try:
        t0 = time.monotonic()
        top = await spotify.get_global_top_tracks(limit=50)
        results["tier3_global_top50"] = {
            "ok": True,
            "track_count": len(top),
            "with_preview": sum(1 for t in top if t.get("preview_url")),
            "latency_ms": round((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:
        results["tier3_global_top50"] = {"ok": False, "error": str(exc)}

    # ── Tier 4: New Music Friday playlist ────────────────────────────────────
    try:
        t0 = time.monotonic()
        nmf = await spotify.get_playlist_tracks(_NEW_MUSIC_FRIDAY_ID, limit=10)
        results["tier4_new_music_friday"] = {
            "ok": True,
            "track_count": len(nmf),
            "latency_ms": round((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:
        results["tier4_new_music_friday"] = {"ok": False, "error": str(exc)}

    # ── Tier 2: Genre search (sample) ────────────────────────────────────────
    try:
        t0 = time.monotonic()
        genre_tracks = await spotify.search_tracks_by_genre("pop", limit=10)
        results["tier2_genre_search"] = {
            "ok": True,
            "track_count": len(genre_tracks),
            "latency_ms": round((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:
        results["tier2_genre_search"] = {"ok": False, "error": str(exc)}

    # ── Redis cache ───────────────────────────────────────────────────────────
    try:
        from services import redis_cache
        r = await redis_cache._client()
        if r is not None:
            t0 = time.monotonic()
            await r.ping()
            results["redis"] = {"ok": True, "latency_ms": round((time.monotonic() - t0) * 1000)}
        else:
            results["redis"] = {"ok": False, "note": "not configured — every feed request hits Spotify directly"}
    except Exception as exc:
        results["redis"] = {"ok": False, "error": str(exc)}

    all_ok = all(v.get("ok", False) for v in results.values() if "note" not in v)
    return {"status": "ok" if all_ok else "degraded", "tiers": results}
