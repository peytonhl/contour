"""Admin-gated diagnostic endpoints.

Born out of the int32-overflow incident, where the actual bug
(`asyncpg.DataError: value out of int32 range` raised inside
`save_kworb_streams`) was invisible until we added branch-level counters
to the persistence step. The /debug/* endpoints used during that
investigation are productionized here behind admin auth.

Endpoints:
  GET  /admin/version       process identity + startup state + sweeper task
  GET  /admin/stats         every counter registered via services.instrumentation
  POST /admin/sweep         run one enrichment sweep cycle synchronously

All three require an admin user (User.is_admin = True). Non-admin users
get 403. No-auth users get 401 via require_user_id.
"""
from __future__ import annotations

import logging
import os
import time
import traceback
from typing import Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

import json as _json

from constants import HIGH_RATING_THRESHOLD
from database import get_db
from models import AlbumCache, AppleMusicLink, Notification, Rating, TrackCache, User, UserTasteProfile
from routers.auth import require_user_id
from services import apple_music, enrichment_sweeper, instrumentation, spotify

router = APIRouter(prefix="/admin", tags=["admin"])


async def _require_admin(db: AsyncSession, user_id: str) -> User:
    """Mirror of routers.moderation._require_admin. Kept local rather
    than imported to avoid coupling two admin areas through one helper."""
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user or not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Process identity / startup state ──────────────────────────────────────────


@router.get("/version")
async def admin_version(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Identifying info about the running container — git SHA, deployment
    ID, uptime, startup-stage beacons, sweeper task liveness. Use to verify
    "is the new deploy actually serving traffic?" without log access."""
    await _require_admin(db, user_id)

    # Pull the startup-state markers + sweeper-task handle from main.
    # Local import sidesteps a circular import at module load: main
    # already imports this router.
    from main import _STARTUP_STATE, _sweeper_task

    sweeper_state = "not-scheduled"
    sweeper_exception: Optional[str] = None
    if _sweeper_task is not None:
        if _sweeper_task.cancelled():
            sweeper_state = "cancelled"
        elif _sweeper_task.done():
            sweeper_state = "done"  # for an infinite loop this means crashed/GC'd
            try:
                exc = _sweeper_task.exception()
                if exc is not None:
                    sweeper_exception = f"{type(exc).__name__}: {exc}"
            except Exception:
                pass
        else:
            sweeper_state = "running"

    now = time.time()
    return {
        "git_sha": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "unknown"),
        "git_branch": os.environ.get("RAILWAY_GIT_BRANCH", "unknown"),
        "deployment_id": os.environ.get("RAILWAY_DEPLOYMENT_ID", "unknown"),
        "module_import_utc": _STARTUP_STATE["import_time_utc"],
        "uptime_seconds": int(now - _STARTUP_STATE["import_time_utc"]),
        "startup_stage": _STARTUP_STATE["stage"],
        "startup_complete": _STARTUP_STATE["complete"],
        "startup_complete_at_utc": _STARTUP_STATE["complete_at_utc"],
        "sweeper_scheduled": _STARTUP_STATE["sweeper_scheduled"],
        "sweeper_state": sweeper_state,
        "sweeper_exception": sweeper_exception,
        "now_utc": now,
    }


# ── Outcome counters ──────────────────────────────────────────────────────────


@router.get("/stats")
async def admin_stats(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Every counter registered via services.instrumentation.

    Keys are the counter names used at registration site — e.g.
    "album_cache.save_kworb_streams", "spotify._persist_album_to_db".
    Each value is a dict with at minimum:
      called_total       int   — how many times this site was hit
      last_at_utc        str?  — ISO timestamp of the most recent call
      last_outcome       str?  — short summary ("committed", "row_missing",
                                 "errored: <ExceptionType>", etc.)
      last_subject       str?  — entity ID being operated on
    Plus site-specific buckets (committed_total, errored_total, ...).
    """
    await _require_admin(db, user_id)
    return {"counters": instrumentation.snapshot()}


# ── On-demand enrichment sweep ────────────────────────────────────────────────


@router.post("/sweep")
async def admin_sweep(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Run one enrichment sweep cycle synchronously. Decouples
    "does sweep_once() work?" from "is the background task firing?".
    Returns {ok, processed, elapsed_seconds} on success, or {ok: False,
    error_type, error_message, traceback} if the cycle raised."""
    await _require_admin(db, user_id)

    start = time.time()
    try:
        processed = await enrichment_sweeper.sweep_once()
        return {
            "ok": True,
            "processed": processed,
            "elapsed_seconds": round(time.time() - start, 2),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error_type": type(exc).__name__,
            "error_message": str(exc),
            "traceback": traceback.format_exc(),
            "elapsed_seconds": round(time.time() - start, 2),
        }


@router.post("/backfill-track-popularity")
async def backfill_track_popularity(
    max_tracks: int = 200,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Backfill `popularity` on TrackCache rows where it's currently NULL.

    Includes an inline raw-HTTP diagnostic probe in the response so the
    caller can see *exactly* what Spotify's /v1/tracks endpoint returns
    for our app's credentials — status code, response body preview, and
    the popularity field for the first 5 IDs. If the bulk path returns
    fetched=0, the probe tells us why immediately rather than requiring
    a log dive.

    Body params:
      max_tracks: cap on how many rows to scan + backfill in one call.
                  At 50 IDs per Spotify call, max=200 is 4 API calls.

    Returns: {ok, scanned, fetched, updated, elapsed_seconds, sample,
              probe: {status_code, ids_requested, response_preview,
                      raw_popularity_values}}.
    """
    await _require_admin(db, user_id)

    start = time.time()
    rows = (await db.execute(
        select(TrackCache.spotify_id)
        .where(TrackCache.popularity.is_(None))
        .limit(max_tracks)
    )).scalars().all()
    ids = list(rows)
    if not ids:
        return {
            "ok": True,
            "scanned": 0,
            "fetched": 0,
            "updated": 0,
            "elapsed_seconds": round(time.time() - start, 2),
            "note": "no tracks with NULL popularity — backfill is up to date",
        }

    # ── Inline diagnostic probe ──────────────────────────────────────────────
    # Hit /v1/tracks directly with the first 5 IDs and capture every signal
    # we can: status code, response body preview, exception class if it
    # blows up. Without this, get_tracks_batch's per-chunk try/except hides
    # whatever is actually going wrong.
    import httpx as _httpx
    probe: dict = {"ids_requested": ids[:5]}
    try:
        async with _httpx.AsyncClient(timeout=10.0) as client:
            token = await spotify._get_token(client)
            resp = await client.get(
                "https://api.spotify.com/v1/tracks",
                headers={"Authorization": f"Bearer {token}"},
                params={"ids": ",".join(ids[:5]), "market": "US"},
            )
            probe["status_code"] = resp.status_code
            probe["response_preview"] = resp.text[:600]
            if resp.status_code == 200:
                body = resp.json()
                returned = body.get("tracks") or []
                probe["tracks_in_response"] = len(returned)
                probe["raw_popularity_values"] = [
                    {
                        "id": (t or {}).get("id"),
                        "name": (t or {}).get("name"),
                        "popularity": (t or {}).get("popularity"),
                        "popularity_type": type((t or {}).get("popularity")).__name__,
                    }
                    for t in returned
                ]
    except Exception as exc:
        probe["error_type"] = type(exc).__name__
        probe["error_message"] = str(exc)

    # ── Bulk backfill via get_tracks_batch ───────────────────────────────────
    try:
        fetched = await spotify.get_tracks_batch(ids)
    except Exception as exc:
        return {
            "ok": False,
            "scanned": len(ids),
            "error_type": type(exc).__name__,
            "error_message": str(exc),
            "elapsed_seconds": round(time.time() - start, 2),
            "probe": probe,
        }

    # get_tracks_batch fire-and-forgets persistence; settle here so the
    # caller sees an honest "updated" count rather than racing.
    import asyncio as _asyncio
    await _asyncio.sleep(0.5)

    confirmed = (await db.execute(
        select(TrackCache.spotify_id, TrackCache.popularity)
        .where(TrackCache.spotify_id.in_(ids))
    )).all()
    updated = sum(1 for _, p in confirmed if p is not None)

    sample = [
        {"id": t.get("id"), "name": t.get("name"), "popularity": t.get("popularity")}
        for t in fetched[:5]
    ]

    return {
        "ok": True,
        "scanned": len(ids),
        "fetched": len(fetched),
        "updated": updated,
        "elapsed_seconds": round(time.time() - start, 2),
        "sample": sample,
        "probe": probe,
    }


@router.post("/backfill-apple-dates")
async def backfill_apple_dates(
    max_rows: int = 50,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Backfill `original_release_date` on TrackCache/AlbumCache rows that have
    a positive AppleMusicLink but no cached Apple release date — i.e. rows
    that landed before the original_release_date column existed, or whose
    lazy-on-access backfill hasn't been triggered yet because nobody's
    viewed the entity recently.

    Rate-limited internally to 5 requests/sec (200ms sleep between Apple
    calls) — well under Apple's documented 20 req/sec cap and even further
    under any plausible daily quota. Caller picks max_rows to bound total
    runtime. With max_rows=50 a single call takes ~10 seconds.

    Resumable: just call again. The query always picks rows where
    original_release_date IS NULL, so progress is implicit in the data —
    no cursor required.

    Body params:
      max_rows: how many AppleMusicLink rows to process this call. The
                hard ceiling is enforced server-side at 500 to prevent
                accidentally pinning a worker for minutes.

    Returns: {ok, scanned, fetched, updated, skipped, elapsed_seconds,
             remaining_estimate, sample, throttled_at_qps}.
    """
    await _require_admin(db, user_id)

    if not apple_music.is_configured():
        return {
            "ok": False,
            "error": "Apple Music API not configured (missing env vars).",
        }

    # Cap so an accidental "max_rows=99999" doesn't pin a worker for hours.
    # 500 × 200ms = 100s worst case; longer than typical request budgets
    # but acceptable for a manually-triggered admin call.
    max_rows = max(1, min(int(max_rows), 500))

    start = time.time()

    # Find AppleMusicLink rows whose entity cache row needs the date.
    # We select the LINK rows (which have the apple_music_id we need)
    # and filter by the corresponding cache row's NULL original_release_date.
    # Two queries — one for tracks, one for albums — kept separate because
    # the join targets differ.
    track_targets = (await db.execute(
        select(AppleMusicLink.spotify_id, AppleMusicLink.apple_music_id, AppleMusicLink.storefront)
        .join(TrackCache, TrackCache.spotify_id == AppleMusicLink.spotify_id)
        .where(
            AppleMusicLink.entity_type == "track",
            AppleMusicLink.apple_music_id.is_not(None),
            TrackCache.original_release_date.is_(None),
        )
        .limit(max_rows)
    )).all()

    remaining_budget = max_rows - len(track_targets)
    album_targets = []
    if remaining_budget > 0:
        album_targets = (await db.execute(
            select(AppleMusicLink.spotify_id, AppleMusicLink.apple_music_id, AppleMusicLink.storefront)
            .join(AlbumCache, AlbumCache.spotify_id == AppleMusicLink.spotify_id)
            .where(
                AppleMusicLink.entity_type == "album",
                AppleMusicLink.apple_music_id.is_not(None),
                AlbumCache.original_release_date.is_(None),
            )
            .limit(remaining_budget)
        )).all()

    targets: list[tuple[str, str, str, str]] = [
        (row.spotify_id, row.apple_music_id, row.storefront, "track")
        for row in track_targets
    ] + [
        (row.spotify_id, row.apple_music_id, row.storefront, "album")
        for row in album_targets
    ]

    if not targets:
        return {
            "ok": True,
            "scanned": 0,
            "fetched": 0,
            "updated": 0,
            "skipped": 0,
            "elapsed_seconds": round(time.time() - start, 2),
            "remaining_estimate": 0,
            "throttled_at_qps": 5.0,
            "note": "no entities with NULL original_release_date — backfill is up to date",
        }

    # ── Throttled fetch + persist loop ────────────────────────────────────
    # asyncio.sleep(0.2) between Apple calls keeps us at 5 req/sec sustained.
    # We could parallelize at higher QPS but staying serial here means we
    # NEVER overshoot — if the loop ever takes longer than expected
    # (Apple rate-limits us, network slowness, whatever) we self-throttle
    # automatically instead of compounding the problem.
    import asyncio as _asyncio
    fetched = 0
    updated = 0
    skipped = 0
    sample: list[dict] = []
    for spotify_id, apple_music_id, storefront, entity_type in targets:
        try:
            meta = await apple_music.fetch_meta_for_id(
                apple_music_id, entity_type, storefront,
            )
        except Exception as exc:
            logger.warning(
                "admin backfill-apple-dates fetch failed for %s/%s: %s",
                entity_type, spotify_id, exc,
            )
            skipped += 1
            await _asyncio.sleep(0.2)
            continue

        if not meta or not meta.get("release_date"):
            skipped += 1
            await _asyncio.sleep(0.2)
            continue

        fetched += 1
        release_date = meta["release_date"]
        try:
            if entity_type == "track":
                row = (await db.execute(
                    select(TrackCache).where(TrackCache.spotify_id == spotify_id)
                )).scalar_one_or_none()
            else:
                row = (await db.execute(
                    select(AlbumCache).where(AlbumCache.spotify_id == spotify_id)
                )).scalar_one_or_none()
            if row and row.original_release_date != release_date:
                row.original_release_date = release_date
                await db.commit()
                updated += 1
                if len(sample) < 5:
                    sample.append({
                        "spotify_id": spotify_id,
                        "entity_type": entity_type,
                        "original_release_date": release_date,
                    })
        except Exception as exc:
            await db.rollback()
            logger.warning(
                "admin backfill-apple-dates persist failed for %s/%s: %s",
                entity_type, spotify_id, exc,
            )
            skipped += 1

        await _asyncio.sleep(0.2)

    # Estimate remaining — counts of NULL rows on each cache that still
    # have an AppleMusicLink. Just informational so the operator knows
    # how many more batches to run.
    track_remaining = (await db.execute(
        select(func.count())
        .select_from(AppleMusicLink)
        .join(TrackCache, TrackCache.spotify_id == AppleMusicLink.spotify_id)
        .where(
            AppleMusicLink.entity_type == "track",
            AppleMusicLink.apple_music_id.is_not(None),
            TrackCache.original_release_date.is_(None),
        )
    )).scalar() or 0
    album_remaining = (await db.execute(
        select(func.count())
        .select_from(AppleMusicLink)
        .join(AlbumCache, AlbumCache.spotify_id == AppleMusicLink.spotify_id)
        .where(
            AppleMusicLink.entity_type == "album",
            AppleMusicLink.apple_music_id.is_not(None),
            AlbumCache.original_release_date.is_(None),
        )
    )).scalar() or 0

    return {
        "ok": True,
        "scanned": len(targets),
        "fetched": fetched,
        "updated": updated,
        "skipped": skipped,
        "elapsed_seconds": round(time.time() - start, 2),
        "remaining_estimate": int(track_remaining + album_remaining),
        "throttled_at_qps": 5.0,
        "sample": sample,
    }


@router.get("/inspect-my-feed")
async def inspect_my_feed(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    End-to-end view of what tier 1 of the For You feed produces for the
    calling user RIGHT NOW.

    Shows:
      - profile.genres (the source data for tier 1 sampling)
      - liked_artist_ids count (depth of taste history)
      - onboarding_done flag
      - computed target_popularity (drives the Laplace curve center)
      - which 3 genres tier 1 WOULD sample this batch (live weighted-sample
        from profile.genres with position decay 0.85^i)
      - per-genre track counts + a sample of the first 3 tracks returned
        from search_tracks_by_genre, including their (synthetic) popularity

    Tells us in one fetch whether the "For You doesn't match my genres"
    complaint is caused by:
      (a) profile.genres is empty (no onboarding signal, no high ratings) →
          fix is in the onboarding flow or signal pipeline
      (b) profile.genres has the right genres but search returns 0 →
          Spotify is rate-limiting or the genre name doesn't text-search well
      (c) profile.genres + search both produce results but the tracks don't
          feel genre-relevant → quality issue with Spotify's text search
          on niche genres, separate fix needed

    Admin-only because it includes user-specific state. The endpoint scopes
    to the *calling* admin's own profile — no way to inspect other users.
    """
    await _require_admin(db, user_id)

    # Local imports to avoid coupling admin.py to discover.py at module load.
    from routers.discover import _compute_target_popularity, _weighted_sample

    profile = await db.get(UserTasteProfile, user_id)
    genres = _json.loads(profile.genres or "[]") if profile else []
    liked_artists = _json.loads(profile.liked_artist_ids or "[]") if profile else []

    target_pop = None
    try:
        target_pop = await _compute_target_popularity(db, user_id)
    except Exception as exc:
        target_pop_error = f"{type(exc).__name__}: {exc}"
    else:
        target_pop_error = None

    # Total ratings by this user — context for whether the profile is
    # under-developed (low count → cold-start, expected to feel generic).
    total_track_ratings = await db.scalar(
        select(func.count()).select_from(Rating).where(
            Rating.user_id == user_id,
            Rating.entity_type == "track",
        )
    ) or 0
    high_track_ratings = await db.scalar(
        select(func.count()).select_from(Rating).where(
            Rating.user_id == user_id,
            Rating.entity_type == "track",
            Rating.value >= HIGH_RATING_THRESHOLD,
        )
    ) or 0

    # Simulate tier 1 with the user's current profile.
    sampled_genres: list[str] = []
    per_genre: list[dict] = []
    if genres:
        n_pick = min(3, len(genres))
        weights = [0.85 ** i for i in range(len(genres))]
        sampled_genres = _weighted_sample(genres, weights, k=n_pick)
        for g in sampled_genres:
            try:
                tracks = await spotify.search_tracks_by_genre(
                    g, limit=15, target_popularity=target_pop,
                )
                per_genre.append({
                    "genre": g,
                    "tracks_returned": len(tracks),
                    "sample": [
                        {
                            "name": t.get("name"),
                            "artists": t.get("artists"),
                            "popularity": t.get("popularity"),
                        }
                        for t in tracks[:3]
                    ],
                })
            except Exception as exc:
                per_genre.append({
                    "genre": g,
                    "tracks_returned": 0,
                    "error": f"{type(exc).__name__}: {exc}",
                })

    # ── Spotify health probe ─────────────────────────────────────────────────
    # When tier 1 returns 0, the cause is almost always one of:
    #   - circuit breaker open (process-level rate-limit shield)
    #   - Spotify search itself returning empty / errored for our credentials
    #   - the new query variants (tag:hipster, year:) hitting a 400
    # The probe surfaces each so we can stop guessing.
    spotify_probe: dict = {}
    try:
        spotify_probe["circuit_remaining_seconds"] = round(spotify._circuit_remaining(), 2)
    except Exception as exc:
        spotify_probe["circuit_check_error"] = f"{type(exc).__name__}: {exc}"

    # Raw probe — fire each query variant with the FIRST sampled genre
    # directly (not through search_tracks_by_genre), capture status/body.
    if sampled_genres:
        probe_genre = sampled_genres[0]
        variants = [
            ("plain", probe_genre),
            ("hipster", f"{probe_genre} tag:hipster"),
            ("recent", f"{probe_genre} year:2023-2026"),
        ]
        import httpx as _httpx
        variant_results: list[dict] = []
        try:
            async with _httpx.AsyncClient(timeout=10.0) as client:
                token = await spotify._get_token(client)
                for label, q in variants:
                    try:
                        resp = await client.get(
                            "https://api.spotify.com/v1/search",
                            headers={"Authorization": f"Bearer {token}"},
                            params={"q": q, "type": "track", "limit": 5, "market": "US"},
                        )
                        try:
                            body = resp.json()
                        except Exception:
                            body = None
                        item_count = 0
                        first_item = None
                        if isinstance(body, dict):
                            items = (body.get("tracks") or {}).get("items") or []
                            item_count = len(items)
                            if items and isinstance(items[0], dict):
                                first_item = {
                                    "name": items[0].get("name"),
                                    "artists": [a.get("name") for a in items[0].get("artists", []) if isinstance(a, dict)],
                                    "popularity": items[0].get("popularity"),
                                }
                        variant_results.append({
                            "label": label,
                            "query": q,
                            "status_code": resp.status_code,
                            "items_returned": item_count,
                            "first_item": first_item,
                            "response_preview": resp.text[:300] if resp.status_code != 200 else None,
                        })
                    except Exception as exc:
                        variant_results.append({
                            "label": label,
                            "query": q,
                            "error_type": type(exc).__name__,
                            "error_message": str(exc),
                        })
            spotify_probe["variant_results"] = variant_results
        except Exception as exc:
            spotify_probe["probe_error"] = f"{type(exc).__name__}: {exc}"

    return {
        "user_id": user_id,
        "profile": {
            "has_row": profile is not None,
            "onboarding_done": profile.onboarding_done if profile else None,
            "genres": genres,
            "liked_artist_count": len(liked_artists),
        },
        "rating_history": {
            "total_track_ratings": total_track_ratings,
            "high_rated_4_plus": high_track_ratings,
        },
        "computed_target_popularity": target_pop,
        "target_popularity_error": target_pop_error,
        "tier1_simulation": {
            "sampled_genres": sampled_genres,
            "per_genre": per_genre,
        },
        "spotify_probe": spotify_probe,
    }


@router.get("/test-genre-search")
async def test_genre_search(
    genre: str = "hip-hop",
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Mirror the EXACT logic of services.spotify.search_tracks_by_genre but
    capture every step's output for the response, so we can see precisely
    where the function loses tracks between "Spotify returns items" and
    "function returns []".

    The previous probe showed Spotify returning 5/5/3 items (200 OK) across
    all 3 variants, but search_tracks_by_genre returned 0. Suspect: items
    without `id` (region-restricted tracks) being filtered out by the
    `if t.get("id")` gate. This endpoint exposes the id presence on each
    item explicitly.

    Read-only. Admin-only. Hits Redis (read), Spotify, but does NOT write
    anything (cache, DB, etc.) — so safe to run repeatedly.
    """
    await _require_admin(db, user_id)
    import httpx as _httpx

    # Mirror the live function's cache key (currently v4).
    cache_key = f"spotify:genre_pool_v4:{genre}"
    cached = None
    try:
        from services import redis_cache
        cached = await redis_cache.get(cache_key)
    except Exception as exc:
        cached_error = f"{type(exc).__name__}: {exc}"
    else:
        cached_error = None

    variants = [
        ("plain", genre, 90, 30),
        ("hipster", f"{genre} tag:hipster", 5, 40),
        ("recent", f"{genre} year:2023-2026", 70, 40),
    ]

    variant_diagnostics: list[dict] = []
    seen: set[str] = set()
    final_pool: list[dict] = []

    async with _httpx.AsyncClient(timeout=10.0) as client:
        token = await spotify._get_token(client)
        for label, q, pop_start, pop_end in variants:
            entry: dict = {"label": label, "query": q}
            try:
                resp = await client.get(
                    "https://api.spotify.com/v1/search",
                    headers={"Authorization": f"Bearer {token}"},
                    # Mirror the production limit (10) since the whole point
                    # of this endpoint is to reproduce search_tracks_by_genre.
                    # /v1/search caps at 10 for our app tier — see
                    # limit_probe section below for the live cap.
                    params={"q": q, "type": "track", "limit": 10, "market": "US"},
                )
                entry["status_code"] = resp.status_code
                if resp.status_code != 200:
                    entry["response_preview"] = resp.text[:400]
                    variant_diagnostics.append(entry)
                    continue

                body = resp.json()
                items = (body.get("tracks") or {}).get("items") or []
                entry["raw_items_count"] = len(items)

                # Item-by-item inspection — what does each item actually carry?
                item_breakdown: list[dict] = []
                added_count = 0
                parse_errors = 0
                for rank, t in enumerate(items):
                    info: dict = {
                        "rank": rank,
                        "t_is_dict": isinstance(t, dict),
                        "has_id": bool(t and isinstance(t, dict) and t.get("id")),
                        "id": (t or {}).get("id") if isinstance(t, dict) else None,
                        "name": (t or {}).get("name") if isinstance(t, dict) else None,
                    }
                    if t and isinstance(t, dict) and t.get("id"):
                        if t["id"] in seen:
                            info["dropped"] = "duplicate"
                        else:
                            try:
                                parsed = spotify._parse_track(t)
                                seen.add(t["id"])
                                if parsed.get("popularity") is None:
                                    n_denom = max(len(items) - 1, 1)
                                    ratio = rank / n_denom
                                    synth = pop_start + (pop_end - pop_start) * ratio
                                    parsed["popularity"] = max(0, min(100, int(round(synth))))
                                final_pool.append(parsed)
                                added_count += 1
                                info["added"] = True
                            except Exception as exc:
                                parse_errors += 1
                                info["parse_error"] = f"{type(exc).__name__}: {exc}"
                    else:
                        info["dropped"] = "no_id"
                    if rank < 5:  # only show first 5 to keep response bounded
                        item_breakdown.append(info)
                entry["added_to_pool"] = added_count
                entry["parse_errors"] = parse_errors
                entry["first_5_items"] = item_breakdown
            except Exception as exc:
                entry["error_type"] = type(exc).__name__
                entry["error_message"] = str(exc)
            variant_diagnostics.append(entry)

    # ── Genre-keyword filter pass ─────────────────────────────────────────────
    # Replicates the filter step inside search_tracks_by_genre so the
    # diagnostic shows BOTH the raw fetch (above) and the post-filter pool.
    # Pre-fix this was opaque; the diagnostic only reported raw counts and
    # the user couldn't tell if the filter was actually dropping keyword
    # tracks before they hit the For You feed.
    genre_keyword = genre.lower().strip()
    keyword_variants_for_filter = {
        genre_keyword,
        genre_keyword.replace("-", " "),
        genre_keyword.replace("-", ""),
        genre_keyword.replace(" ", "-"),
    }

    def _has_genre_keyword(t: dict) -> bool:
        # Mirror the production filter: track + artist only, NOT album_name.
        # Compilation albums named "Classical Best Of" etc. were producing
        # false positives that dropped legit Beethoven / Bach tracks.
        fields = [
            (t.get("name") or "").lower(),
            " ".join(t.get("artists") or []).lower(),
        ]
        return any(
            kw and any(kw in f for f in fields)
            for kw in keyword_variants_for_filter
        )

    pre_filter_size = len(final_pool)
    keyword_stuffed = [
        {"name": t.get("name"), "artists": t.get("artists"),
         "album_name": t.get("album_name")}
        for t in final_pool if _has_genre_keyword(t)
    ]
    filtered_pool = [t for t in final_pool if not _has_genre_keyword(t)]
    safety_threshold = 3
    if len(filtered_pool) >= safety_threshold:
        post_filter_size = len(filtered_pool)
        filter_applied = True
    else:
        post_filter_size = pre_filter_size
        filter_applied = False

    # ── Limit-cap probe ───────────────────────────────────────────────────────
    # Quickly tells us the maximum `limit` value /v1/search accepts for our
    # app's credentials. Saves a debug cycle the next time we need to know
    # what the safe cap is — Spotify changes this without notice and the
    # error ("Invalid limit") is misleading.
    limit_probe: list[dict] = []
    async with _httpx.AsyncClient(timeout=10.0) as client:
        token = await spotify._get_token(client)
        for cap in [50, 30, 20, 15, 10, 5]:
            try:
                resp = await client.get(
                    "https://api.spotify.com/v1/search",
                    headers={"Authorization": f"Bearer {token}"},
                    params={"q": genre, "type": "track", "limit": cap, "market": "US"},
                )
                limit_probe.append({
                    "limit": cap,
                    "status_code": resp.status_code,
                    "ok": resp.status_code == 200,
                })
            except Exception as exc:
                limit_probe.append({
                    "limit": cap,
                    "error": f"{type(exc).__name__}: {exc}",
                })

    return {
        "genre": genre,
        "cache": {
            "key": cache_key,
            "cached_value_type": type(cached).__name__ if cached is not None else "None",
            "cached_length": (len(cached) if isinstance(cached, list) else None),
            "cached_error": cached_error,
        },
        "variants": variant_diagnostics,
        "pre_filter_pool_size": pre_filter_size,
        "filter": {
            "applied": filter_applied,
            "safety_threshold": safety_threshold,
            "post_filter_pool_size": post_filter_size,
            "dropped_count": pre_filter_size - len(filtered_pool),
            "dropped_examples": keyword_stuffed[:10],
        },
        "final_pool_size": post_filter_size,
        "first_pool_track": (
            {"id": filtered_pool[0].get("id") if filter_applied else final_pool[0].get("id"),
             "name": filtered_pool[0].get("name") if filter_applied else final_pool[0].get("name"),
             "popularity": filtered_pool[0].get("popularity") if filter_applied else final_pool[0].get("popularity")}
            if (filtered_pool if filter_applied else final_pool) else None
        ),
        "limit_probe": limit_probe,
    }


@router.post("/reset-spotify-circuit")
async def reset_spotify_circuit(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Force-close the Spotify circuit breaker. Use when the breaker has tripped
    on a long Retry-After and the actual rate-limit window has since expired
    but the breaker is still holding all Spotify calls back. Returns the
    remaining seconds before-and-after so the caller can verify.

    Admin-only. The breaker is process-wide, so resetting on the live
    container clears it for every user.
    """
    await _require_admin(db, user_id)
    before = spotify._circuit_remaining()
    await spotify.reset_circuit()
    after = spotify._circuit_remaining()
    return {
        "ok": True,
        "circuit_remaining_seconds_before": round(before, 2),
        "circuit_remaining_seconds_after": round(after, 2),
    }


@router.post("/dedup-notifications")
async def dedup_notifications(
    dry_run: bool = True,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """One-shot cleanup for duplicate follow + upvote notifications that
    accumulated BEFORE the create_notification dedup landed (commit
    9b60446, 2026-05-27).

    Reported case: a friend tapped Follow → Unfollow → Follow on
    Peyton's account and his bell showed two follow rows. Going
    forward, create_notification dedups at insert time; this endpoint
    cleans up the backfill.

    Semantics (mirror create_notification's dedup):
      - follow: keep oldest row per (user_id, actor_id), delete rest.
      - upvote: keep oldest row per (user_id, actor_id, review_id),
        delete rest (NULL review_id rows are left alone — likely the
        rare upvote-on-non-review edge case).
      - reply / mention: not touched (no dedup by design).

    Default is dry_run=true — pass ?dry_run=false to actually delete.
    Returns counts of what would-be / was deleted so a curl with
    dry_run=true safely previews the impact first.

    Admin-only because it's a destructive op across all users' data.
    """
    await _require_admin(db, user_id)

    # FOLLOW: rank rows within (user_id, actor_id) by created_at asc,
    # keep rank=1, return ids of rank>1 for deletion.
    follow_rows = (await db.execute(
        select(
            Notification.id,
            Notification.user_id,
            Notification.actor_id,
            Notification.created_at,
        )
        .where(Notification.type == "follow")
        .order_by(Notification.user_id, Notification.actor_id, Notification.created_at)
    )).all()

    follow_to_delete: list[int] = []
    seen_follow: set[tuple[str, str]] = set()
    for row in follow_rows:
        key = (row.user_id, row.actor_id)
        if key in seen_follow:
            follow_to_delete.append(row.id)
        else:
            seen_follow.add(key)

    # UPVOTE: rank within (user_id, actor_id, review_id).
    upvote_rows = (await db.execute(
        select(
            Notification.id,
            Notification.user_id,
            Notification.actor_id,
            Notification.review_id,
            Notification.created_at,
        )
        .where(Notification.type == "upvote")
        .where(Notification.review_id.isnot(None))
        .order_by(
            Notification.user_id, Notification.actor_id,
            Notification.review_id, Notification.created_at,
        )
    )).all()

    upvote_to_delete: list[int] = []
    seen_upvote: set[tuple[str, str, int]] = set()
    for row in upvote_rows:
        key = (row.user_id, row.actor_id, row.review_id)
        if key in seen_upvote:
            upvote_to_delete.append(row.id)
        else:
            seen_upvote.add(key)

    result = {
        "dry_run": dry_run,
        "follow_duplicates": len(follow_to_delete),
        "upvote_duplicates": len(upvote_to_delete),
        "follow_total_after": len(seen_follow),
        "upvote_total_after": len(seen_upvote),
    }

    if not dry_run:
        if follow_to_delete:
            await db.execute(
                delete(Notification).where(Notification.id.in_(follow_to_delete))
            )
        if upvote_to_delete:
            await db.execute(
                delete(Notification).where(Notification.id.in_(upvote_to_delete))
            )
        await db.commit()
        result["deleted"] = True

    return result
