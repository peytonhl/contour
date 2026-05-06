"""
For You feed — personalized track discovery.

Personalization tiers
─────────────────────
Logged-in users:
  Taste profile is read server-side from UserTasteProfile (populated by the
  onboarding genre picker and auto-updated on 4–5 star track ratings).

Cold start (logged-out, or logged-in but no server profile yet):
  Falls back to client-sent genres/liked_artists from localStorage.
  If neither exist, serves Deezer chart tracks + new music so the user
  gets variety while their taste is being learned.

Warm / hot (genres or liked_artists present):
  1. Related-artist tracks  — top tracks from artists similar to ones the user
                              rated 4–5 stars (Spotify, most personalized)
  2. Genre-filtered search  — Spotify search filtered to learned genres
  3. Deezer popular baseline — no API key required, always has preview URLs
  4. Deezer new music       — fresh tracks via Deezer search, no quota issues
  5. Deezer keyword fallbacks — last-resort, always returns something

Tiers 3–5 use Deezer because Spotify's search/playlist endpoints return
empty results for apps not enrolled in Extended Access review.
Deezer's public API requires no authentication and returns 30s previews.
"""

import asyncio
import json
import logging
import random
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

logger = logging.getLogger(__name__)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Rating, UserTasteProfile
from routers.auth import optional_user_id
from services import spotify
from services import deezer as deezer_svc
from services.limiter import limiter

router = APIRouter(prefix="/discover", tags=["discover"])

# Deezer queries for the baseline / fallback tiers (no Spotify needed)
_DEEZER_POPULAR_QUERIES = ["top hits", "global hits", "chart music", "viral songs"]
_DEEZER_NEW_QUERIES = ["new music 2025", "new songs 2025", "fresh music"]
_DEEZER_FALLBACK_QUERIES = [
    "pop hits",
    "hip hop",
    "indie pop",
    "r&b",
    "alternative rock",
]


def _is_likely_english(text: str) -> bool:
    """
    Return True if the text looks like it's primarily Latin/English.
    Filters out Cyrillic, CJK, Arabic, etc. while allowing French/Spanish
    accented chars (which are ≤30 % of most Western-language titles).
    """
    if not text:
        return True
    non_ascii = sum(1 for c in text if ord(c) > 127)
    return (non_ascii / len(text)) < 0.3


@router.get("/feed")
@limiter.limit("60/minute")
async def get_discover_feed(
    request: Request,
    genres: Optional[str] = Query(None, description="Comma-separated genre slugs from client prefs"),
    liked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs rated 4–5 stars"),
    disliked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs the user has marked 'not interested'"),
    english_only: bool = Query(True, description="Filter to tracks with Latin/English titles and artist names"),
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
            if english_only:
                title_ok = _is_likely_english(t.get("name", ""))
                artist_ok = _is_likely_english((t.get("artists") or [""])[0])
                if not (title_ok and artist_ok):
                    continue
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

    # ── Tier 3: Deezer popular baseline ──────────────────────────────────────
    # Deezer's public API requires no auth, returns 30s previews, and is
    # unaffected by Spotify's Extended Access restrictions.
    if len(tracks) < limit:
        popular_results = await asyncio.gather(*[
            deezer_svc.search_tracks(q, limit=20)
            for q in _DEEZER_POPULAR_QUERIES
        ], return_exceptions=True)
        for res in popular_results:
            if isinstance(res, list):
                random.shuffle(res)
                _add(res)
            if len(tracks) >= limit:
                break
        logger.info("discover: tier3 (deezer popular) → %d tracks", len(tracks))

    # ── Tier 4: Deezer new music ──────────────────────────────────────────────
    if len(tracks) < limit:
        new_results = await asyncio.gather(*[
            deezer_svc.search_tracks(q, limit=15)
            for q in _DEEZER_NEW_QUERIES
        ], return_exceptions=True)
        for res in new_results:
            if isinstance(res, list):
                _add(res)
            if len(tracks) >= limit:
                break

    # ── Tier 5: Deezer keyword fallbacks — always produces results ────────────
    if len(tracks) < limit:
        fallback_results = await asyncio.gather(*[
            deezer_svc.search_tracks(q, limit=10)
            for q in _DEEZER_FALLBACK_QUERIES
        ], return_exceptions=True)
        for res in fallback_results:
            if isinstance(res, list):
                _add(res)
            if len(tracks) >= limit:
                break

    # ── Tier 5.5: Nuclear fallback — ignore disliked filter ──────────────────
    if not tracks and disliked_ids:
        logger.info("discover: nuclear fallback — ignoring disliked filter (%d artists)", len(disliked_ids))
        nuclear = await deezer_svc.search_tracks("top hits", limit=50)
        for t in nuclear:
            if t.get("id") and t["id"] not in exclude_ids and t["id"] not in seen:
                seen.add(t["id"])
                tracks.append(t)
            if len(tracks) >= limit:
                break

    logger.info(
        "discover: returning %d tracks (rated_excluded=%d, genres=%s, artists=%s)",
        len(tracks), len(exclude_ids), genre_list[:2], liked_artist_ids[:2],
    )

    if not tracks:
        logger.error("discover: all tiers failed — returning empty feed")
        return []

    result = tracks[:limit]
    random.shuffle(result)

    # ── Deezer preview enrichment (Spotify tracks only) ───────────────────────
    # Deezer-sourced tracks already carry preview_url from the search response.
    # Only enrich Spotify tracks that are still missing a preview clip.
    no_preview = [t for t in result if not t.get("preview_url") and t.get("_source") != "deezer"]
    if no_preview:
        deezer_tasks = [
            deezer_svc.get_preview(t.get("name", ""), (t.get("artists") or [""])[0])
            for t in no_preview
        ]
        deezer_urls = await asyncio.gather(*deezer_tasks, return_exceptions=True)
        url_iter = iter(deezer_urls)
        for t in result:
            if not t.get("preview_url") and t.get("_source") != "deezer":
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

    # ── Tier 3: Deezer popular search ────────────────────────────────────────
    try:
        t0 = time.monotonic()
        deezer_pop = await deezer_svc.search_tracks("top hits", limit=10)
        results["tier3_deezer_popular"] = {
            "ok": True,
            "track_count": len(deezer_pop),
            "with_preview": sum(1 for t in deezer_pop if t.get("preview_url")),
            "latency_ms": round((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:
        results["tier3_deezer_popular"] = {"ok": False, "error": str(exc)}

    # ── Tier 4: Deezer new music ──────────────────────────────────────────────
    try:
        t0 = time.monotonic()
        deezer_new = await deezer_svc.search_tracks("new music 2025", limit=10)
        results["tier4_deezer_new"] = {
            "ok": True,
            "track_count": len(deezer_new),
            "latency_ms": round((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:
        results["tier4_deezer_new"] = {"ok": False, "error": str(exc)}

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
