"""FastAPI application entry point."""

import asyncio
import logging
import os

# Ensure all application loggers emit at INFO level so Railway shows them.
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s: %(message)s")
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from services.limiter import limiter

from database import init_db, AsyncSessionLocal
from routers import albums, artists, auth, comparison, discover, featured, feed, leaderboard, lists, notifications, ratings, reviews, saved_comparisons, taste, tracks, users

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


async def _seed_leaderboard() -> None:
    """
    Background task: prime the leaderboard with popular albums on startup.

    Two-stage strategy:
      Stage 1 — Spotify-sourced IDs (reliable):
        Pull album IDs from the Global Top 50 playlist + new releases.
        For each, fetch Kworb's individual album page to get total streams.
        Individual Kworb album pages (same ones used for trajectory data)
        are more reliably parseable than the global listing page.

      Stage 2 — Kworb global list (bonus, best-effort):
        Also try kworb.net/spotify/albums.html for additional historically
        popular albums.  Falls back silently if the page can't be parsed.

    Runs 60 s after startup.  Already-fresh albums are skipped.
    """
    from services import spotify, kworb
    from services import album_cache as cache

    await asyncio.sleep(60)

    # ── Stage 1: collect album IDs from Spotify's own top data ───────────────
    album_ids: list[str] = []

    try:
        top_tracks = await spotify.get_global_top_tracks(limit=50)
        for t in top_tracks:
            aid = t.get("album_id")
            if aid and aid not in album_ids:
                album_ids.append(aid)
        logger.info("Leaderboard seed: %d album IDs from Global Top 50", len(album_ids))
    except Exception as exc:
        logger.warning("Leaderboard seed: top tracks fetch failed — %s", exc)

    try:
        releases = await spotify.get_new_releases(limit=20)
        for a in releases:
            if a.get("id") and a["id"] not in album_ids:
                album_ids.append(a["id"])
        logger.info("Leaderboard seed: %d album IDs after new releases", len(album_ids))
    except Exception as exc:
        logger.warning("Leaderboard seed: new releases fetch failed — %s", exc)

    # ── Stage 2: bonus IDs from Kworb global list ─────────────────────────────
    kworb_entries: dict[str, int] = {}  # spotify_id → streams (pre-fetched)
    try:
        top_albums = await kworb.get_top_albums(limit=200)
        for entry in top_albums:
            sid = entry["spotify_id"]
            kworb_entries[sid] = entry["streams"]
            if sid not in album_ids:
                album_ids.append(sid)
        logger.info("Leaderboard seed: %d album IDs after Kworb list (%d with pre-fetched streams)",
                    len(album_ids), len(kworb_entries))
    except Exception as exc:
        logger.warning("Leaderboard seed: Kworb global list skipped — %s", exc)

    if not album_ids:
        logger.warning("Leaderboard seed: no album IDs found — aborting")
        return

    logger.info("Leaderboard seed: processing %d albums…", len(album_ids))

    seeded = 0
    for spotify_id in album_ids:
        try:
            async with AsyncSessionLocal() as db:
                existing = await cache.get_cached_album(db, spotify_id)
                if existing and not cache.needs_enrichment(existing):
                    continue  # already fresh — skip

            meta = await spotify.get_album(spotify_id)
            async with AsyncSessionLocal() as db:
                await cache.upsert_album(db, meta)

            # Use the same enrichment path as _enrich_album in albums.py:
            # scrape the Kworb *artist* page (proven to work) rather than the
            # individual album entity page (which only exists for charted albums).
            streams = kworb_entries.get(spotify_id)
            if streams is None:
                artist_ids = meta.get("artist_ids", [])
                if artist_ids:
                    streams = await kworb.get_album_streams(artist_ids[0], meta["name"])

            async with AsyncSessionLocal() as db:
                await cache.save_kworb_streams(db, spotify_id, streams)

            if streams:
                logger.info("Leaderboard seed: ✓ %s — %s streams", meta["name"], f"{streams:,}")
                seeded += 1
            else:
                logger.info("Leaderboard seed: %s — no Kworb data", meta["name"])

        except Exception as exc:
            logger.warning("Leaderboard seed: skipped %s — %s", spotify_id, exc)

        await asyncio.sleep(0.5)

    logger.info("Leaderboard seed: complete — %d albums with stream data", seeded)


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

    # Seed the leaderboard in the background so startup doesn't block.
    # The task self-skips albums that are already enriched and fresh.
    asyncio.create_task(_seed_leaderboard())


@app.get("/health")
async def health():
    return {"status": "ok"}
