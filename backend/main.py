"""FastAPI application entry point."""

import asyncio
import logging
import os

# force=True overwrites any handlers uvicorn already installed so our logs actually emit.
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s: %(message)s", force=True)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from services.limiter import limiter

from database import init_db, AsyncSessionLocal
from routers import albums, apple_music, artists, auth, backlog, comparison, discover, featured, feed, imports, leaderboard, lists, moderation, notifications, ratings, reviews, saved_comparisons, search, taste, tracks, trending, users

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Contour — Stream Trajectory Comparison",
    version="0.1.0",
    description="Compare album streaming trajectories normalized against Spotify MAU.",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://contour-rosy.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(search.router)
app.include_router(albums.router)
app.include_router(tracks.router)
app.include_router(artists.router)
app.include_router(comparison.router)
app.include_router(ratings.router)
app.include_router(saved_comparisons.router)
app.include_router(featured.router)
app.include_router(feed.router)
app.include_router(reviews.router)
app.include_router(users.router)
app.include_router(leaderboard.router)
app.include_router(notifications.router)
app.include_router(discover.router)
app.include_router(lists.router)
app.include_router(taste.router)
app.include_router(apple_music.router)
app.include_router(moderation.router)
app.include_router(imports.router)
app.include_router(backlog.router)
app.include_router(trending.router)


# Exact Spotify IDs used on the Compare page "Try these" section.
# Seeded by ID (not name search) so the cache-first get_album always hits.
_COMPARE_PAGE_ALBUMS: list[tuple[str, str]] = [
    ("2fenSS68JI1h4Fo1HkVPNi", "folklore — Taylor Swift"),
    ("151w1FgRZfnKZA9FEcg9Z3", "Midnights — Taylor Swift"),
    ("2jX1778bE1RXvVSIbA5ySh", "After Hours — The Weeknd"),
    ("2ODvWsOgouMbaA5xf0RkJe", "Starboy — The Weeknd"),
    ("4eLPsYPBmXABThSJ821sqY", "DAMN. — Kendrick Lamar"),
    ("3scAn2BRULWR9GxMEkQ40S", "good kid m.A.A.d city — Kendrick Lamar"),
    ("1HNkqx9Ahdgi1Ixy2xkKkZ", "÷ — Ed Sheeran"),
    ("0QaYcvrXxP0bkJXhAzGKuq", "x — Ed Sheeran"),
    ("6KEstFm8vBIHHWiJ9fgPJg", "SOS — SZA"),
    ("5fy0X0JmZRZnVa2UEicIOc", "CTRL — SZA"),
]


async def _seed_compare_page_albums() -> None:
    """Cache the exact Compare page preset albums by Spotify ID at startup.

    The leaderboard seeder finds albums by name search, which can resolve to a
    different edition/ID than what's hardcoded in the frontend SUGGESTED list.
    This function fetches the exact IDs so cache-first get_album always hits.
    """
    from services import spotify
    from services import album_cache as cache

    for spotify_id, label in _COMPARE_PAGE_ALBUMS:
        try:
            async with AsyncSessionLocal() as db:
                existing = await cache.get_cached_album(db, spotify_id)
                if existing and existing.image_url:
                    continue  # already cached with full metadata
                meta = await spotify.get_album(spotify_id)
                await cache.upsert_album(db, meta)
                logger.info("Compare seed: cached %s", label)
        except Exception as exc:
            logger.warning("Compare seed: FAILED %s — %s", label, exc)
        await asyncio.sleep(0.25)



# Module-level boot marker. Set when the @app.on_event("startup") hook
# finishes successfully. Exposed via /debug/version so an external probe
# (e.g. curl from outside Railway) can tell whether the current container
# completed its startup without needing access to Railway logs.
_STARTUP_STATE: dict = {
    "import_time_utc": __import__("time").time(),
    "stage": "not-started",   # set step-by-step in startup()
    "complete": False,
    "complete_at_utc": None,
    "sweeper_scheduled": False,
}

# Strong reference for the long-running sweeper task. Python 3.11+ asyncio
# docs warn that asyncio.create_task return values must be held by a strong
# reference, otherwise the event loop's weak-set may GC the task mid-sleep.
# A 60-second initial-delay sleep at the top of run_forever() is the exact
# pattern that gets bitten — task suspends, no caller holds it, GC runs,
# task vanishes silently with "Task was destroyed but it is pending" if you
# happen to be looking. This is the most likely reason the sweeper was
# scheduled but did zero work in the last hour of production.
_sweeper_task = None


@app.on_event("startup")
async def startup():
    # PROGRESS BEACONS — each stage writes its name into _STARTUP_STATE and
    # logs an "[startup] entering: X" line. If production gets stuck at
    # stage "Y", both /debug/version (external) and Railway logs (internal)
    # surface "Y" before hanging — pinpointing the broken stage without
    # needing a stack trace. Previously the startup hang happened
    # somewhere between "Waiting for application startup" and the next
    # "Started server process" with no signal which stage held the lock.
    def _enter(stage: str) -> None:
        _STARTUP_STATE["stage"] = stage
        logger.info("[startup] entering: %s", stage)

    _enter("alembic_migrations")

    alembic_ini = os.path.join(os.path.dirname(__file__), "alembic.ini")
    if os.path.exists(alembic_ini):
        try:
            from alembic import command as alembic_command
            from alembic.config import Config as AlembicConfig

            def _run_migrations():
                cfg = AlembicConfig(alembic_ini)
                alembic_command.upgrade(cfg, "head")

            await asyncio.get_event_loop().run_in_executor(None, _run_migrations)
            logger.info("Alembic migrations applied successfully.")
        except Exception as exc:
            logger.warning("Alembic migration failed: %s", exc)

    _enter("init_db_create_all")
    # SQLAlchemy create_all as a safety net for models not yet covered by
    # Alembic migrations. Idempotent — only creates missing tables.
    await init_db()

    _enter("schedule_compare_seed")
    asyncio.create_task(_seed_compare_page_albums())

    _enter("schedule_enrichment_sweeper")
    # Wrap in try/except so a sweeper import error / scheduling error can't
    # kill the whole startup. The app should serve traffic even if the
    # background sweeper isn't running — sweeper is defense-in-depth, not
    # the only enrichment path.
    try:
        from services import enrichment_sweeper
        global _sweeper_task
        _sweeper_task = asyncio.create_task(enrichment_sweeper.run_forever())
        _STARTUP_STATE["sweeper_scheduled"] = True
    except Exception as exc:
        logger.warning("Enrichment sweeper failed to schedule (non-fatal): %s", exc)

    _enter("cleanup_numeric_entity_ids")
    # One-time cleanup: delete ratings/reviews whose entity_id is a pure
    # numeric string (Deezer IDs that leaked in before validation).
    try:
        from sqlalchemy import text
        async with AsyncSessionLocal() as _db:
            result = await _db.execute(
                text("DELETE FROM ratings WHERE entity_id ~ '^[0-9]+$'")
            )
            deleted_ratings = result.rowcount
            result2 = await _db.execute(
                text("DELETE FROM reviews WHERE entity_id ~ '^[0-9]+$'")
            )
            deleted_reviews = result2.rowcount
            await _db.commit()
            if deleted_ratings or deleted_reviews:
                logger.info(
                    "Startup cleanup: removed %d numeric-ID ratings and %d numeric-ID reviews",
                    deleted_ratings, deleted_reviews,
                )
    except Exception as exc:
        logger.warning("Startup cleanup failed (non-fatal): %s", exc)

    _enter("complete")
    _STARTUP_STATE["complete"] = True
    _STARTUP_STATE["complete_at_utc"] = __import__("time").time()
    logger.info("=== Contour startup complete — app is ready to serve requests ===")


@app.get("/debug/version")
async def debug_version():
    """Identifying info about the running container.

    Exists so an external probe can answer "is the new deploy actually
    serving traffic?" without depending on Railway's log UI. Reads
    RAILWAY_GIT_COMMIT_SHA (set automatically by Railway at build time)
    plus the _STARTUP_STATE markers the startup hook writes as it
    progresses. If `stage` is anything other than "complete" and
    `complete` is False, that container is wedged mid-startup.
    """
    import time as _time
    now = _time.time()

    # Report the sweeper task's actual runtime state — not just "was it
    # scheduled" but "is it still alive". done()=True means the task
    # finished (which for an infinite loop means it crashed or was GC'd
    # — both bad). cancelled()=True also means it's dead.
    sweeper_state = "not-scheduled"
    sweeper_exception = None
    if _sweeper_task is not None:
        if _sweeper_task.cancelled():
            sweeper_state = "cancelled"
        elif _sweeper_task.done():
            sweeper_state = "done"  # infinite loop ended = bad
            try:
                exc = _sweeper_task.exception()
                if exc is not None:
                    sweeper_exception = f"{type(exc).__name__}: {exc}"
            except Exception:
                pass
        else:
            sweeper_state = "running"

    # Pull the sweeper's own activity counters so we can see if it's
    # actually completing cycles vs. just sitting in a "running" Task state.
    try:
        from services.enrichment_sweeper import STATS as _SW_STATS
        sweeper_stats = dict(_SW_STATS)
    except Exception:
        sweeper_stats = None

    # Pull the persistence-layer counters too. Sweeper reports "processed"
    # rows but that only means _enrich_album returned without raising —
    # save_kworb_streams may have silently early-returned if the row
    # lookup didn't match. These counters tell us which branch fired.
    try:
        from services.album_cache import SAVE_STATS as _SAVE_STATS
        save_stats = dict(_SAVE_STATS)
    except Exception:
        save_stats = None

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
        "sweeper_stats": sweeper_stats,
        "save_stats": save_stats,
        "now_utc": now,
    }


@app.post("/debug/sweep")
async def debug_sweep():
    """Run one sweeper cycle synchronously and return what happened.

    Independent of the background run_forever() task. Lets us answer
    "does sweep_once() ACTUALLY work in production right now?" by
    invoking it directly from a request handler and inspecting the
    return value + any exception. If a manual sweep returns
    processed=N>0, the sweep logic is sound and any failure of the
    background task to make progress is a scheduling/timing issue.
    If it returns 0 with no exception, the query is selecting nothing
    despite 706 pending rows in the table — different bug. If it
    raises, the exception text tells us what's broken inline.
    """
    import time as _time
    from services import enrichment_sweeper
    start = _time.time()
    try:
        processed = await enrichment_sweeper.sweep_once()
        return {
            "ok": True,
            "processed": processed,
            "elapsed_seconds": round(_time.time() - start, 2),
        }
    except Exception as exc:
        import traceback
        return {
            "ok": False,
            "error_type": type(exc).__name__,
            "error_message": str(exc),
            "traceback": traceback.format_exc(),
            "elapsed_seconds": round(_time.time() - start, 2),
        }


@app.get("/health")
async def health():
    """
    Dependency health check — Railway monitors this endpoint.
    Returns 200 only when all critical dependencies are reachable.
    Returns 503 with a breakdown if anything is down.
    """
    import time
    from sqlalchemy import text

    results: dict[str, dict] = {}
    healthy = True

    # ── Database ──────────────────────────────────────────────────────────────
    try:
        t0 = time.monotonic()
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        results["database"] = {"ok": True, "latency_ms": round((time.monotonic() - t0) * 1000)}
    except Exception as exc:
        results["database"] = {"ok": False, "error": str(exc)}
        healthy = False

    # ── Spotify token ─────────────────────────────────────────────────────────
    try:
        from services import spotify as spotify_svc
        import httpx
        t0 = time.monotonic()
        async with httpx.AsyncClient() as client:
            await spotify_svc._get_token(client)
        circuit_left = int(spotify_svc._circuit_remaining())
        results["spotify"] = {
            "ok": True,
            "latency_ms": round((time.monotonic() - t0) * 1000),
            "circuit_open": circuit_left > 0,
            "circuit_seconds_remaining": circuit_left,
        }
    except Exception as exc:
        results["spotify"] = {"ok": False, "error": str(exc)}
        healthy = False  # Spotify down = feed broken

    # ── Last.fm key ───────────────────────────────────────────────────────────
    import os
    lastfm_key_set = bool(os.environ.get("LASTFM_API_KEY"))
    results["lastfm"] = {"ok": lastfm_key_set, "key_set": lastfm_key_set}
    # Last.fm missing = leaderboard won't seed, but app still works

    # ── Redis ─────────────────────────────────────────────────────────────────
    try:
        from services import redis_cache
        r = await redis_cache._client()
        if r is not None:
            t0 = time.monotonic()
            await r.ping()
            results["redis"] = {"ok": True, "latency_ms": round((time.monotonic() - t0) * 1000)}
        else:
            results["redis"] = {"ok": False, "note": "not configured (REDIS_URL missing) — caching disabled"}
    except Exception as exc:
        results["redis"] = {"ok": False, "error": str(exc)}
    # Redis missing = slower but not broken

    # ── Kworb reachability ────────────────────────────────────────────────────
    # Two separate checks because artist pages and entity pages hit different
    # URL patterns and may be blocked independently.
    #
    # Artist pages  → kworb.net/spotify/artist/{ID}_albums.html
    #   Powers: leaderboard stream totals (via get_album_streams)
    #
    # Entity pages  → kworb.net/spotify/track/{ID}.html
    #   Powers: album detail page trajectory anchors (via get_entity_daily_data)
    try:
        import time as _time
        from services import kworb as kworb_svc

        # Artist page — Ed Sheeran
        t0 = _time.monotonic()
        albums = await kworb_svc.get_artist_albums_by_id("6eUKZXaKkcviH0Ku9w2n3V")
        latency = round((_time.monotonic() - t0) * 1000)
        if albums:
            results["kworb_artist"] = {"ok": True, "latency_ms": latency, "albums_returned": len(albums)}
        else:
            results["kworb_artist"] = {
                "ok": False, "latency_ms": latency,
                "note": "returned empty — artist pages may be IP-blocked.",
            }
    except Exception as exc:
        results["kworb_artist"] = {"ok": False, "error": str(exc)}

    try:
        # Entity page — "Blinding Lights" by The Weeknd (one of the most-charted
        # songs ever; guaranteed to have a Kworb entity page with daily data)
        t0 = _time.monotonic()
        daily = await kworb_svc.get_entity_daily_data("0VjIjW4GlUZAMYd2vXMi3b", "track")
        latency = round((_time.monotonic() - t0) * 1000)
        if daily:
            results["kworb_entity"] = {
                "ok": True, "latency_ms": latency,
                "data_points": len(daily),
                "note": "Blinding Lights daily chart data — album detail trajectories will use real anchors.",
            }
        else:
            results["kworb_entity"] = {
                "ok": False, "latency_ms": latency,
                "note": "entity pages returned empty — album detail trajectories will fall back to decay model only.",
            }
    except Exception as exc:
        results["kworb_entity"] = {"ok": False, "error": str(exc)}
    # Kworb down = album detail trajectories degrade to decay model; rest of app still works

    # ── Leaderboard data ──────────────────────────────────────────────────────
    try:
        from sqlalchemy import select, func
        from models import AlbumCache
        async with AsyncSessionLocal() as db:
            count = (await db.execute(
                select(func.count()).where(
                    AlbumCache.enrichment_status == "done",
                    AlbumCache.kworb_streams > 0,
                )
            )).scalar()
        results["leaderboard"] = {"ok": count > 0, "eligible_albums": count}
    except Exception as exc:
        results["leaderboard"] = {"ok": False, "error": str(exc)}

    # ── DB cache stats + duplicate check ─────────────────────────────────────
    try:
        from sqlalchemy import select, func, text
        from models import AlbumCache, TrackCache, ArtistCache
        from datetime import datetime, timedelta
        async with AsyncSessionLocal() as db:
            album_total = (await db.execute(select(func.count()).select_from(AlbumCache))).scalar()
            track_total = (await db.execute(select(func.count()).select_from(TrackCache))).scalar()
            artist_seeded = (await db.execute(
                select(func.count()).select_from(ArtistCache)
                .where(ArtistCache.discography_fetched_at > datetime.utcnow() - timedelta(days=7))
            )).scalar()
            # Check for duplicates — should always be 0 due to unique constraints
            dup_albums = (await db.execute(
                text("SELECT COUNT(*) FROM (SELECT spotify_id FROM album_cache GROUP BY spotify_id HAVING COUNT(*) > 1) x")
            )).scalar()
            dup_tracks = (await db.execute(
                text("SELECT COUNT(*) FROM (SELECT spotify_id FROM track_cache GROUP BY spotify_id HAVING COUNT(*) > 1) x")
            )).scalar()
        results["db_cache"] = {
            "ok": True,
            "albums": album_total,
            "tracks": track_total,
            "artists_seeded_7d": artist_seeded,
            "duplicate_album_ids": dup_albums,
            "duplicate_track_ids": dup_tracks,
        }
    except Exception as exc:
        results["db_cache"] = {"ok": False, "error": str(exc)}

    from fastapi.responses import JSONResponse
    status_code = 200 if healthy else 503
    return JSONResponse(
        content={"status": "ok" if healthy else "degraded", "checks": results},
        status_code=status_code,
    )
