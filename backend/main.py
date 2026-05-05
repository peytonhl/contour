"""FastAPI application entry point."""

import asyncio
import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from database import init_db, AsyncSessionLocal
from routers import albums, artists, auth, comparison, discover, featured, feed, leaderboard, lists, notifications, ratings, reviews, saved_comparisons, taste, tracks, users
from services.limiter import limiter

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Contour — Stream Trajectory Comparison",
    version="0.1.0",
    description="Compare album streaming trajectories normalized against Spotify MAU.",
)

# Rate limiting
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

    Fetches the Global Top 50 playlist, extracts unique albums, upserts each
    one to AlbumCache, and runs Kworb enrichment for any that haven't been
    scraped yet (or whose data is stale).  Rate-limited to avoid hammering Kworb.
    Already-enriched albums are skipped quickly so repeated deploys are cheap.
    """
    from services import spotify, kworb
    from services import album_cache as cache

    # Wait 60 s after startup before hitting Spotify so early user requests
    # (which also call Spotify) aren't competing for quota at the same moment.
    await asyncio.sleep(60)

    try:
        tracks = await spotify.get_global_top_tracks(limit=50)
    except Exception as exc:
        logger.warning("Leaderboard seed: failed to fetch top tracks: %s", exc)
        return

    # Collect unique album IDs in playlist order
    seen: set[str] = set()
    album_ids: list[str] = []
    for t in tracks:
        aid = t.get("album_id")
        if aid and aid not in seen:
            seen.add(aid)
            album_ids.append(aid)

    logger.info("Leaderboard seed: seeding %d albums from Global Top 50", len(album_ids))

    for album_id in album_ids:
        try:
            meta = await spotify.get_album(album_id)
            async with AsyncSessionLocal() as db:
                row = await cache.upsert_album(db, meta)
                if cache.needs_enrichment(row):
                    artist_ids = meta.get("artist_ids", [])
                    if artist_ids:
                        streams = await kworb.get_album_streams(artist_ids[0], meta["name"])
                        await cache.save_kworb_streams(db, album_id, streams)
                        logger.info(
                            "Leaderboard seed: %s — %s streams",
                            meta["name"],
                            f"{streams:,}" if streams else "none",
                        )
                    else:
                        await cache.save_kworb_streams(db, album_id, None)
        except Exception as exc:
            logger.warning("Leaderboard seed: skipped %s — %s", album_id, exc)
        # Polite delay between Kworb scrapes — always fires, even on failure
        await asyncio.sleep(2)

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
            logger.warning("Alembic migration failed — falling back to create_all: %s", exc)
            await init_db()
    else:
        await init_db()

    # Seed the leaderboard in the background so startup doesn't block.
    # The task self-skips albums that are already enriched and fresh.
    asyncio.create_task(_seed_leaderboard())


@app.get("/health")
async def health():
    return {"status": "ok"}
