"""
For You feed — personalized track discovery.

Personalization signals (logged-in)
───────────────────────────────────
Read server-side from UserTasteProfile so they follow the user across devices:
  • liked_artist_ids       — set by onboarding + every 4–5★ track rating
  • genres                 — set by onboarding (client also caches own copy)
  • disliked_artist_ids    — explicit "Not interested" clicks (hard exclude)
  • down_weighted_artist_ids — inferred from 1–2★ ratings (soft exclude:
                              dropped from personalized seeds & tiers 1–2,
                              still allowed in baseline chart tiers)

Cold-start vs. personalized
───────────────────────────
There is no hard threshold — *any* liked artist or genre signal is used
immediately (a 5★ on the first card affects the very next batch). When
the user has nothing yet, the feed serves Deezer charts + new music for
variety while the taste profile builds.

Tier ladder (in order, until `limit` tracks are gathered)
─────────────────────────────────────────────────────────
  1. Related-artist tracks  — Spotify /related-artists (often 404 these days
                              for non-Extended-Access apps; we detect that
                              and fall straight to tier 1b)
  1b. Genre-of-liked-artist  — fallback used when tier 1 returns nothing.
                              We fetch each seed artist's own genres and
                              search those, which keeps the result tied to
                              what the user actually liked.
  2. Genre-filtered search   — Spotify search across the user's profile
                              genres
  3. Deezer chart baseline   — /chart/0/tracks, no auth, no quota
  4. Deezer new music        — search for fresh tracks
  5. Deezer keyword fallbacks — last-resort, always returns something

Tiers 1–2 honor down-weighted artists. Tiers 3–5 only honor hard dislikes.
This means a single low rating won't blackhole an artist from charts, but
explicit "Not interested" will.
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

# Deezer queries for the new-music and fallback tiers (no Spotify needed).
# Tier 3 now uses the chart API directly (no text search → no "Top Hits band" problem).
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
    genres: Optional[str] = Query(None, description="Comma-separated genre slugs from client prefs (logged-out fallback)"),
    liked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs rated 4–5 stars (logged-out fallback)"),
    disliked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs marked 'not interested' (logged-out fallback; logged-in users use server profile)"),
    english_only: bool = Query(True, description="Filter to tracks with Latin/English titles and artist names"),
    limit: int = Query(10, le=20),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """
    Return a batch of tracks for the For You scroll feed.
    For logged-in users every personalization signal is read server-side from
    UserTasteProfile; client params act as a fallback for logged-out users.
    """
    # Exclude tracks this user has already rated — track-level signal,
    # independent of artist-level dislikes.
    exclude_ids: set[str] = set()
    if user_id:
        rated_ids = (await db.execute(
            select(Rating.entity_id).where(
                Rating.user_id == user_id,
                Rating.entity_type == "track",
            )
        )).scalars().all()
        exclude_ids.update(rated_ids)

    # ── Resolve preferences from server profile or client fallback ───────────
    genre_list: list[str] = []
    liked_artist_ids: list[str] = []
    disliked_set: set[str] = set()
    down_weighted_set: set[str] = set()

    if user_id:
        try:
            profile = await db.get(UserTasteProfile, user_id)
            if profile:
                genre_list = json.loads(profile.genres or "[]")
                liked_artist_ids = json.loads(profile.liked_artist_ids or "[]")
                disliked_set = set(json.loads(profile.disliked_artist_ids or "[]"))
                down_weighted_set = set(json.loads(profile.down_weighted_artist_ids or "[]"))
        except Exception:
            # Table or new columns may not exist yet on first deploy
            pass

    # Logged-out (or empty server profile) → use client-provided values
    if not genre_list:
        genre_list = [g.strip() for g in genres.split(",")] if genres else []
    if not liked_artist_ids:
        liked_artist_ids = [a.strip() for a in liked_artists.split(",")] if liked_artists else []
    if not disliked_set and disliked_artists:
        disliked_set = {a.strip() for a in disliked_artists.split(",") if a.strip()}

    # Seed list for personalized tiers — exclude both hard dislikes and
    # down-weighted artists. We use a low rating as a "don't pivot off this
    # artist" signal even if it was previously liked.
    seed_artist_ids = [
        a for a in liked_artist_ids
        if a not in disliked_set and a not in down_weighted_set
    ]

    # Soft-exclude is the union of dislikes + down-weights for tiers 1–2.
    # Tiers 3–5 (chart baselines) only honor hard dislikes — a single low
    # rating shouldn't blackhole an artist from popular charts.
    soft_excluded = disliked_set | down_weighted_set

    tracks: list[dict] = []
    seen: set[str] = set()

    def _make_adder(excluded: set[str]):
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
                    and artist_id not in excluded
                ):
                    seen.add(t["id"])
                    tracks.append(t)
        return _add

    add_personalized = _make_adder(soft_excluded)
    add_baseline = _make_adder(disliked_set)

    # ── Tier 1: Related-artist tracks (most personalized) ────────────────────
    # Falls through silently if Spotify's deprecated /related-artists 404s.
    tier1_added_before = len(tracks)
    related_ids: list[str] = []
    if seed_artist_ids:
        related_results = await asyncio.gather(*[
            spotify.get_related_artists(aid)
            for aid in seed_artist_ids[:3]
        ], return_exceptions=True)

        for r in related_results:
            if isinstance(r, list):
                related_ids.extend(r[:4])
        related_ids = [a for a in dict.fromkeys(related_ids) if a not in soft_excluded]
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
                        add_personalized([random.choice(candidates)])
    tier1_count = len(tracks) - tier1_added_before
    logger.info("discover: tier1 (related) → %d tracks (related_ids=%d)", tier1_count, len(related_ids))

    # ── Tier 1b: Seed-artist genre fallback (only if tier 1 produced nothing) ─
    # When /related-artists is dead (the common case for non-Extended-Access
    # apps), pivot off the seed artists' *own* genres so the result is still
    # tied to what the user actually liked, not generic profile genres.
    if seed_artist_ids and tier1_count == 0 and len(tracks) < limit:
        artist_meta = await asyncio.gather(*[
            spotify.get_artist(aid) for aid in seed_artist_ids[:3]
        ], return_exceptions=True)
        seed_genres: list[str] = []
        for meta in artist_meta:
            if isinstance(meta, dict):
                seed_genres.extend((meta.get("genres") or [])[:2])
        seed_genres = list(dict.fromkeys(seed_genres))[:3]
        if seed_genres:
            seed_genre_results = await asyncio.gather(*[
                spotify.search_tracks_by_genre(g, limit=15)
                for g in seed_genres
            ], return_exceptions=True)
            for res in seed_genre_results:
                if isinstance(res, list):
                    add_personalized(res)
            logger.info(
                "discover: tier1b (seed-artist genre fallback) → %d tracks (genres=%s)",
                len(tracks) - tier1_added_before, seed_genres,
            )

    # ── Tier 2: Profile-genre search ─────────────────────────────────────────
    if genre_list and len(tracks) < limit:
        genre_results = await asyncio.gather(*[
            spotify.search_tracks_by_genre(g, limit=15)
            for g in genre_list[:3]
        ], return_exceptions=True)
        for res in genre_results:
            if isinstance(res, list):
                add_personalized(res)

    # ── Tier 3: Deezer chart baseline ────────────────────────────────────────
    # Uses Deezer's /chart/0/tracks endpoint (actual chart data) instead of
    # searching text like "top hits" which was matching a karaoke artist of
    # the same name and flooding the feed with cover tracks.
    if len(tracks) < limit:
        chart_tracks = await deezer_svc.get_chart_tracks(limit=50)
        if isinstance(chart_tracks, list):
            random.shuffle(chart_tracks)
            add_baseline(chart_tracks)
        logger.info("discover: tier3 (deezer chart) → %d tracks", len(tracks))

    # ── Tier 4: Deezer new music ──────────────────────────────────────────────
    if len(tracks) < limit:
        new_results = await asyncio.gather(*[
            deezer_svc.search_tracks(q, limit=15)
            for q in _DEEZER_NEW_QUERIES
        ], return_exceptions=True)
        for res in new_results:
            if isinstance(res, list):
                add_baseline(res)
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
                add_baseline(res)
            if len(tracks) >= limit:
                break

    # ── Tier 5.5: Nuclear fallback — ignore even hard dislikes ───────────────
    # Only triggers when every tier above produced zero. Keeps the feed alive
    # if upstreams are down rather than showing an empty page.
    if not tracks and disliked_set:
        logger.info("discover: nuclear fallback — ignoring disliked filter (%d artists)", len(disliked_set))
        nuclear = await deezer_svc.get_chart_tracks(limit=50)
        for t in nuclear:
            if t.get("id") and t["id"] not in exclude_ids and t["id"] not in seen:
                seen.add(t["id"])
                tracks.append(t)
            if len(tracks) >= limit:
                break

    logger.info(
        "discover: returning %d tracks (rated_excluded=%d, seeds=%d, dislikes=%d, down_weighted=%d, genres=%s)",
        len(tracks), len(exclude_ids), len(seed_artist_ids),
        len(disliked_set), len(down_weighted_set), genre_list[:2],
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

    # ── Tier 1: /related-artists liveness probe ───────────────────────────────
    # Pings a known artist (Taylor Swift). 404 here means tier 1 will silently
    # produce zero candidates and the feed runs on tier 1b/2/3 instead.
    try:
        t0 = time.monotonic()
        related = await spotify_svc.get_related_artists("06HL4z0CvFAxyc27GXpf02")
        results["tier1_related_artists"] = {
            "ok": True,
            "count": len(related),
            "deprecated_signal": len(related) == 0,
            "latency_ms": round((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:
        results["tier1_related_artists"] = {"ok": False, "error": str(exc)}

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
