"""
For You feed — personalized track discovery.

Personalization signals (logged-in)
───────────────────────────────────
Read server-side from UserTasteProfile so they follow the user across devices:
  • liked_artist_ids       — set by onboarding + every 4–5★ track rating
  • genres                 — set by onboarding (client also caches own copy)
  • disliked_artist_ids    — explicit "Not interested" clicks (hard exclude)
  • down_weighted_artist_ids — inferred from 1–2★ ratings (soft exclude:
                              dropped from tier 1 personalized pivots,
                              still allowed in baseline chart tiers)

Cold-start vs. personalized
───────────────────────────
There is no hard threshold — *any* liked artist or genre signal is used
immediately (a 5★ on the first card affects the very next batch). When
the user has nothing yet, the feed serves Deezer charts + new music for
variety while the taste profile builds.

Tier ladder (in order, until `limit` tracks are gathered)
─────────────────────────────────────────────────────────
  1. Weighted-genre pivot     — Sample 3 genres from profile.genres weighted
                                by position (decay 0.85^i). Front of the list
                                = most-recent + most-frequent prepend, so a
                                user's top genre lands in ~43% of batches
                                while position-15 still lands in ~4%. For
                                each sampled genre, Spotify search returns
                                a pool that's then popularity-curve-sampled
                                to match the user's average liked-track
                                popularity (target_popularity).
                                  Replaces the older two-tier setup (seed-
                                  artist pivot → profile genres top-3),
                                  which sampled by recency-of-artist only
                                  and treated all liked genres as equal.
  2. Deezer chart baseline    — /chart/0/tracks, no auth, no quota
  3. Deezer new music         — search for fresh tracks
  4. Deezer keyword fallbacks — last-resort, always returns something

Tier 1 honors down-weighted artists. Tiers 2–4 only honor hard dislikes.
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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlbumCache, ArtistCache, Rating, TrackCache, UserTasteProfile
from routers.auth import optional_user_id
from services import spotify
from services import deezer as deezer_svc
from services.limiter import limiter

router = APIRouter(prefix="/discover", tags=["discover"])

# Deezer queries for the new-music and fallback tiers (no Spotify needed).
# Tier 2 uses the chart API directly (no text search → no "Top Hits band" problem).
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


def _weighted_sample(items: list, weights: list[float], k: int) -> list:
    """
    Sample `k` items from `items` without replacement, weighted by `weights`.

    Uses Efraimidis-Spirakis weighted reservoir sampling: assign each item
    a key = U ** (1 / w), sort descending, take top k. Equivalent to
    drawing k times from the discrete distribution and removing the chosen
    item each draw, but in a single sort pass.

    When k >= len(items) returns all items (trivially). When weights and
    items lengths mismatch, zip truncates to the shorter — caller's
    responsibility to keep them aligned.
    """
    if k >= len(items):
        return list(items)
    keyed = [
        (random.random() ** (1.0 / max(w, 1e-9)), x)
        for x, w in zip(items, weights)
    ]
    keyed.sort(key=lambda p: p[0], reverse=True)
    return [x for _, x in keyed[:k]]


async def _compute_target_popularity(db: AsyncSession, user_id: str) -> float | None:
    """
    Average Spotify popularity (0–100) of the tracks this user has rated 4–5★.

    Drives the per-user popularity curve in spotify.search_tracks_by_genre.
    A user whose high-rated tracks average to popularity ~25 (consistent
    niche taste) gets a sampling curve peaked at 25; one whose average is
    ~80 (mainstream-listener) gets a curve peaked at 80. Returns None if
    the user has zero high ratings of tracks we have popularity data for,
    in which case the genre search falls back to a target=70 default
    (mild mainstream lean — fine for cold-start).

    Cheap indexed join (ratings.user_id + track_cache.spotify_id are both
    indexed). Run on every /feed call; no caching beyond what SQLAlchemy's
    session does — the value drifts slowly enough that staleness inside a
    single request isn't a concern, and recomputing keeps it honest as
    the user rates more tracks.
    """
    row = await db.execute(
        select(func.avg(TrackCache.popularity))
        .select_from(Rating)
        .join(TrackCache, Rating.entity_id == TrackCache.spotify_id)
        .where(
            Rating.user_id == user_id,
            Rating.entity_type == "track",
            Rating.value >= 4.0,
            TrackCache.popularity.is_not(None),
        )
    )
    avg = row.scalar()
    return float(avg) if avg is not None else None


def _flatten_shuffle_add(results: list, adder) -> None:
    """
    Flatten per-query results from an asyncio.gather() call, shuffle as a
    single pool, and add to the batch.

    Why: without this, results cluster by source query — all 15 "pop hits"
    in a row, then 15 "indie pop", etc. The feed feels monotone at the top
    even when upstream diversity is healthy.

    Pairs with the removal of the post-slice random.shuffle(result) at the
    end of /feed: tier order is now stable (tier 1 personalized first,
    tier 2 chart baseline later), so within-tier shuffle is what supplies
    the variety the post-slice shuffle used to (badly) provide.
    """
    flat = [t for res in results if isinstance(res, list) for t in res]
    random.shuffle(flat)
    adder(flat)


@router.get("/feed")
@limiter.limit("60/minute")
async def get_discover_feed(
    request: Request,
    genres: Optional[str] = Query(None, description="Comma-separated genre slugs from client prefs (logged-out fallback)"),
    liked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs rated 4–5 stars (logged-out fallback)"),
    disliked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs marked 'not interested' (logged-out fallback; logged-in users use server profile)"),
    exclude: Optional[str] = Query(None, description="Comma-separated track IDs already shown to this user in the current scroll session — excluded from the batch so prefetches don't repeat tracks from earlier batches"),
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

    # Client-supplied session exclusion list — track IDs the user has
    # already seen this scroll session. Prevents prefetch batches from
    # repeating tracks from earlier batches when the same Deezer chart
    # response is still warm in cache.
    if exclude:
        exclude_ids.update(e.strip() for e in exclude.split(",") if e.strip())

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

    # Soft-exclude is the union of dislikes + down-weights for tier 1
    # (personalized genre pivots). Tiers 2–4 (chart baselines) only honor
    # hard dislikes — a single low rating shouldn't blackhole an artist
    # from popular charts.
    soft_excluded = disliked_set | down_weighted_set

    # Per-user popularity target. A user whose 4–5★ track ratings average
    # to popularity=25 has signaled niche-leaning taste; the Laplace curve
    # inside search_tracks_by_genre will peak there. None → cold-start
    # default (target=70, mild mainstream lean). Only relevant for tier 1
    # — tiers 2–4 are mainstream chart baselines by definition.
    target_popularity: float | None = None
    if user_id:
        try:
            target_popularity = await _compute_target_popularity(db, user_id)
        except Exception:
            # If TrackCache hasn't been populated for any of this user's
            # rated tracks yet (e.g. fresh DB on a new deploy), fall back
            # silently to the cold-start default.
            target_popularity = None

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

    # ── Tier 1: Weighted-genre pivot ─────────────────────────────────────────
    # Sample 3 genres from profile.genres weighted by position. Position 0
    # is the most-recent prepend; the list is dedup'd on every 4–5★ rating
    # so a genre that's been rated repeatedly keeps getting re-prepended →
    # stays near the front. Position is therefore a recency × frequency
    # proxy — exactly the signal "preferred genres" wants.
    #
    # Decay 0.85: position-0 genre has weight 1.0, position-19 ≈ 0.046.
    # At k=3, simulation shows:
    #   position 0 → in ~43% of batches
    #   position 5 → in ~21%
    #   position 10 → in ~10%
    #   position 19 → in ~2%
    # Top genres dominate but tail genres still surface — a user who's
    # rated mostly hip-hop with occasional jazz still gets jazz queries
    # in some batches instead of jazz being functionally invisible.
    #
    # Replaces the previous two-tier setup:
    #   - Tier 1 was a seed-artist pivot (random 3 of top-8 most-recent
    #     liked artists, then their Spotify genres). Recency-of-artist
    #     only, no frequency weighting, cost 3 cached artist lookups.
    #   - Tier 2 was profile.genres[:3], deterministic top-3 every batch.
    # Both treated all liked genres as equal once they entered the
    # profile. The new tier 1 unifies them into one probabilistic pick.
    tier1_added_before = len(tracks)
    if genre_list and len(tracks) < limit:
        n_pick = min(3, len(genre_list))
        position_weights = [0.85 ** i for i in range(len(genre_list))]
        sampled_genres = _weighted_sample(genre_list, position_weights, k=n_pick)
        genre_results = await asyncio.gather(*[
            spotify.search_tracks_by_genre(g, limit=15, target_popularity=target_popularity)
            for g in sampled_genres
        ], return_exceptions=True)
        _flatten_shuffle_add(genre_results, add_personalized)
        logger.info(
            "discover: tier1 (weighted-genre) → %d tracks (sampled=%s, target_pop=%s, profile_size=%d)",
            len(tracks) - tier1_added_before, sampled_genres,
            f"{target_popularity:.1f}" if target_popularity is not None else "default",
            len(genre_list),
        )

    # ── Tier 2: Deezer chart baseline ────────────────────────────────────────
    # Uses Deezer's /chart/0/tracks endpoint (actual chart data) instead of
    # searching text like "top hits" which was matching a karaoke artist of
    # the same name and flooding the feed with cover tracks.
    if len(tracks) < limit:
        chart_tracks = await deezer_svc.get_chart_tracks(limit=50)
        if isinstance(chart_tracks, list):
            random.shuffle(chart_tracks)
            add_baseline(chart_tracks)
        logger.info("discover: tier2 (deezer chart) → %d tracks", len(tracks))

    # ── Tier 3: Deezer new music ──────────────────────────────────────────────
    if len(tracks) < limit:
        new_results = await asyncio.gather(*[
            deezer_svc.search_tracks(q, limit=15)
            for q in _DEEZER_NEW_QUERIES
        ], return_exceptions=True)
        _flatten_shuffle_add(new_results, add_baseline)

    # ── Tier 4: Deezer keyword fallbacks — always produces results ────────────
    if len(tracks) < limit:
        fallback_results = await asyncio.gather(*[
            deezer_svc.search_tracks(q, limit=10)
            for q in _DEEZER_FALLBACK_QUERIES
        ], return_exceptions=True)
        _flatten_shuffle_add(fallback_results, add_baseline)

    # ── Tier 4.5: Nuclear fallback — ignore even hard dislikes ───────────────
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
        "discover: returning %d tracks (rated_excluded=%d, seeds=%d, dislikes=%d, down_weighted=%d, target_pop=%s, genres=%s)",
        len(tracks), len(exclude_ids), len(seed_artist_ids),
        len(disliked_set), len(down_weighted_set),
        f"{target_popularity:.1f}" if target_popularity is not None else "default",
        genre_list[:2],
    )

    if not tracks:
        logger.error("discover: all tiers failed — returning empty feed")
        return []

    # Preserve tier order — tier 1 (personalized weighted-genre) first,
    # tier 2 (Deezer chart baseline) and beyond last. Within each tier
    # _flatten_shuffle_add has already shuffled to keep genres/queries
    # from clustering.
    # An earlier random.shuffle(result) here was clobbering this and
    # routinely surfacing generic chart hits above tier-1 personalized
    # results — i.e. the user got the algorithm's worst guesses first.
    result = tracks[:limit]

    # ── Deezer preview enrichment (Spotify tracks only) ───────────────────────
    # Deezer-sourced tracks already carry preview_url from the search response.
    # Only enrich Spotify tracks that are still missing a preview clip.
    no_preview = [t for t in result if not t.get("preview_url") and t.get("_source") != "deezer"]
    if no_preview:
        import logging as _logging
        _log = _logging.getLogger(__name__)
        deezer_tasks = [
            deezer_svc.get_preview(t.get("name", ""), (t.get("artists") or [""])[0])
            for t in no_preview
        ]
        deezer_urls = await asyncio.gather(*deezer_tasks, return_exceptions=True)
        url_iter = iter(deezer_urls)
        filled = 0
        for t in result:
            if not t.get("preview_url") and t.get("_source") != "deezer":
                url = next(url_iter)
                if isinstance(url, str) and url:
                    t["preview_url"] = url
                    filled += 1
        _log.info(
            "[discover] Deezer preview enrichment: %d/%d Spotify tracks filled",
            filled, len(no_preview),
        )

    # Visibility: log the final preview coverage so we can see at a glance how
    # many cards in this batch will get the custom HTML5 audio player vs the
    # Spotify iframe fallback (the latter is buggier in WKWebView).
    if result:
        import logging as _logging
        _log = _logging.getLogger(__name__)
        with_preview = sum(1 for t in result if t.get("preview_url"))
        _log.info(
            "[discover] /feed served %d tracks, %d with preview_url (%d will use iframe fallback)",
            len(result), with_preview, len(result) - with_preview,
        )

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

    # ── Tier 1: seed-artist genre pivot probe ────────────────────────────────
    # Tests the live tier-1 path: fetch a known artist's genres, then verify
    # a genre search returns tracks. /related-artists is no longer in the
    # ladder (Spotify deprecated it).
    try:
        t0 = time.monotonic()
        meta = await spotify_svc.get_artist("06HL4z0CvFAxyc27GXpf02")  # Taylor Swift
        genres = meta.get("genres") or []
        sample_tracks = await spotify.search_tracks_by_genre(genres[0], limit=5) if genres else []
        results["tier1_seed_genre"] = {
            "ok": True,
            "artist_genres": genres[:3],
            "sample_track_count": len(sample_tracks),
            "latency_ms": round((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:
        results["tier1_seed_genre"] = {"ok": False, "error": str(exc)}

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


@router.get("/catalog-stats")
async def catalog_stats(db: AsyncSession = Depends(get_db)):
    """
    Snapshot of what's in our local catalog (TrackCache + ArtistCache + AlbumCache).

    Read-only audit endpoint — the foundation for the catalog-pivot work. The
    long-term goal is to serve the For You feed from local SQL queries against
    these tables rather than text-searching Spotify on every request; this
    endpoint tells us how far we are from that being viable. A catalog with
    ~10k tracks across diverse genres + popularity levels is roughly the
    threshold where DB-served feed batches start matching the variety of
    live-search batches.

    The popularity distribution is the most-watched number — the For You
    weighted-sampling curve needs candidates across the full 0–100 range to
    have anything to sample from. A catalog that's all popularity-80+ would
    serve every niche-leaning user (target_pop=25) zero good matches.

    Genre frequency comes from ArtistCache.genres. We don't have track-level
    genre tags (Spotify doesn't expose them on tracks; we infer from artist),
    so "the catalog has 200 hip-hop tracks" is really "the catalog has tracks
    by 50 artists tagged hip-hop." That's the same logic the For You feed uses.

    Caveat: top_genres scans up to 5000 ArtistCache rows and aggregates in
    Python. Plenty for the current catalog size; if ArtistCache ever grows
    past low-thousands, switch to DB-native JSON aggregation.
    """
    # ── TrackCache ────────────────────────────────────────────────────────────
    total_tracks = await db.scalar(select(func.count()).select_from(TrackCache)) or 0
    tracks_with_popularity = await db.scalar(
        select(func.count()).select_from(TrackCache).where(TrackCache.popularity.is_not(None))
    ) or 0
    tracks_with_artist_ids = await db.scalar(
        select(func.count()).select_from(TrackCache).where(TrackCache.artist_ids_json.is_not(None))
    ) or 0
    tracks_with_image = await db.scalar(
        select(func.count()).select_from(TrackCache).where(TrackCache.image_url.is_not(None))
    ) or 0

    # Popularity buckets — same edges as the algorithm uses to reason about
    # "mainstream vs niche" so the stats line up with the weighting code.
    popularity_buckets: dict[str, int] = {}
    for lo, hi in [(0, 19), (20, 39), (40, 59), (60, 79), (80, 100)]:
        n = await db.scalar(
            select(func.count()).select_from(TrackCache).where(
                TrackCache.popularity >= lo,
                TrackCache.popularity <= hi,
            )
        )
        popularity_buckets[f"{lo}-{hi}"] = n or 0

    # Percentiles via sorted scan — fine at current catalog size, may need
    # a DB-native percentile_cont() switch if TrackCache passes ~100k rows.
    pops = (await db.execute(
        select(TrackCache.popularity)
        .where(TrackCache.popularity.is_not(None))
        .order_by(TrackCache.popularity)
    )).scalars().all()

    def _pct(p: float):
        if not pops:
            return None
        idx = max(0, min(len(pops) - 1, int(len(pops) * p)))
        return pops[idx]

    # ── ArtistCache ───────────────────────────────────────────────────────────
    total_artists = await db.scalar(select(func.count()).select_from(ArtistCache)) or 0
    artists_with_genres = await db.scalar(
        select(func.count()).select_from(ArtistCache).where(ArtistCache.genres.is_not(None))
    ) or 0

    # Top-genres aggregation — parse JSON in Python rather than DB-native
    # because we run on SQLite locally and Postgres in prod, and json_each /
    # jsonb_array_elements_text differ between them.
    from collections import Counter
    genres_rows = (await db.execute(
        select(ArtistCache.genres).where(ArtistCache.genres.is_not(None)).limit(5000)
    )).scalars().all()
    genre_counter: Counter[str] = Counter()
    for g_json in genres_rows:
        try:
            for g in json.loads(g_json or "[]"):
                if g:
                    genre_counter[g] += 1
        except Exception:
            continue
    top_genres = [{"genre": g, "count": c} for g, c in genre_counter.most_common(20)]

    # ── AlbumCache (context) ──────────────────────────────────────────────────
    total_albums = await db.scalar(select(func.count()).select_from(AlbumCache)) or 0

    # ── Ratings (context — drives the target_popularity per-user signal) ──────
    total_track_ratings = await db.scalar(
        select(func.count()).select_from(Rating).where(Rating.entity_type == "track")
    ) or 0
    high_track_ratings = await db.scalar(
        select(func.count()).select_from(Rating).where(
            Rating.entity_type == "track",
            Rating.value >= 4.0,
        )
    ) or 0

    return {
        "tracks": {
            "total": total_tracks,
            "with_popularity": tracks_with_popularity,
            "with_artist_ids": tracks_with_artist_ids,
            "with_image": tracks_with_image,
            "popularity_buckets": popularity_buckets,
            "popularity_percentiles": {
                "p10": _pct(0.10),
                "p25": _pct(0.25),
                "p50": _pct(0.50),
                "p75": _pct(0.75),
                "p90": _pct(0.90),
            },
        },
        "artists": {
            "total": total_artists,
            "with_genres": artists_with_genres,
            "top_genres": top_genres,
            "unique_genres_seen": len(genre_counter),
        },
        "albums": {
            "total": total_albums,
        },
        "ratings_context": {
            "total_track_ratings": total_track_ratings,
            "high_rated_4_plus": high_track_ratings,
        },
    }
