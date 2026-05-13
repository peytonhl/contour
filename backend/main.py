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



@app.on_event("startup")
async def startup():
    # Run pending Alembic migrations so every deploy is schema-current.
    # This keeps user data (reviews, ratings, follows) safe — we never drop
    # tables, only add columns / new tables as migrations land.
    # Falls back to create_all if alembic.ini is missing (e.g. CI environments).
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

    # Always run create_all as a safety net for models not yet covered by
    # Alembic migrations (e.g. UserTasteProfile added without a migration file).
    # SQLAlchemy create_all is idempotent — it only creates tables that are
    # missing; it never drops or alters existing ones.
    await init_db()

    # Pre-cache the exact Compare page preset albums in the background.
    # Running as a task so startup isn't blocked if Spotify is slow.
    asyncio.create_task(_seed_compare_page_albums())

    # Enrichment safety-net sweeper — picks up any AlbumCache rows stuck on
    # pending/failed status and re-runs the enrichment pipeline against them.
    # Pairs with the inline asyncio.create_task(_enrich_album(...)) in
    # routers/albums.py: the inline path handles fresh views, the sweeper
    # guarantees nothing gets permanently stuck if an inline task drops.
    from services import enrichment_sweeper
    asyncio.create_task(enrichment_sweeper.run_forever())

    # One-time cleanup: delete ratings/reviews whose entity_id is a pure numeric
    # string (Deezer IDs that leaked in via the /review endpoint before validation
    # was added).  Idempotent — safe to run on every startup until rows are gone.
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

    logger.info("=== Contour startup complete — app is ready to serve requests ===")


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
