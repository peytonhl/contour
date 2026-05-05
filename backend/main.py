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

    Strategy:
      1. Scrape Kworb's own top-albums list (kworb.net/spotify/albums.html).
         These entries already have Spotify IDs and confirmed stream counts so
         no per-artist scraping guesswork is needed.
      2. For each album, fetch Spotify metadata (name, art, release date) and
         upsert into AlbumCache with the stream count pre-filled.
      3. Skip albums that were enriched recently (TTL from album_cache).

    This runs 60 s after startup so early user requests don't compete for
    Spotify quota.  A 1 s delay between Spotify calls avoids rate-limiting.
    Already-enriched albums are skipped quickly so repeated deploys are cheap.
    """
    from services import spotify, kworb
    from services import album_cache as cache

    # Wait 60 s after startup before hitting external APIs.
    await asyncio.sleep(60)

    logger.info("Leaderboard seed: fetching Kworb top albums list…")
    try:
        top_albums = await kworb.get_top_albums(limit=200)
    except Exception as exc:
        logger.warning("Leaderboard seed: failed to fetch Kworb top albums: %s", exc)
        return

    if not top_albums:
        logger.warning("Leaderboard seed: Kworb top albums returned empty list")
        return

    logger.info("Leaderboard seed: seeding %d albums from Kworb", len(top_albums))

    for entry in top_albums:
        spotify_id = entry["spotify_id"]
        try:
            async with AsyncSessionLocal() as db:
                existing = await cache.get_cached_album(db, spotify_id)
                if existing and not cache.needs_enrichment(existing):
                    continue  # already fresh — skip

            meta = await spotify.get_album(spotify_id)
            async with AsyncSessionLocal() as db:
                await cache.upsert_album(db, meta)
                await cache.save_kworb_streams(db, spotify_id, entry["streams"])
                logger.info(
                    "Leaderboard seed: %s — %s streams",
                    meta["name"],
                    f"{entry['streams']:,}",
                )
        except Exception as exc:
            logger.warning("Leaderboard seed: skipped %s (%s) — %s", spotify_id, entry.get("name"), exc)

        # Polite delay between Spotify calls — always fires, even on failure
        await asyncio.sleep(1)

    logger.info("Leaderboard seed: complete")


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
