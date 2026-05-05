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


# Curated catalog — used by both the startup seeder and the /leaderboard/seed-catalog endpoint.
# Artist/album name pairs that Last.fm reliably has play counts for.
_CATALOG: list[tuple[str, str]] = [
    ("Ed Sheeran", "÷"), ("Ed Sheeran", "x"), ("Ed Sheeran", "+"), ("Ed Sheeran", "="),
    ("The Weeknd", "After Hours"), ("The Weeknd", "Starboy"), ("The Weeknd", "Beauty Behind the Madness"),
    ("Taylor Swift", "1989"), ("Taylor Swift", "folklore"), ("Taylor Swift", "evermore"),
    ("Taylor Swift", "Midnights"), ("Taylor Swift", "reputation"), ("Taylor Swift", "Lover"),
    ("Billie Eilish", "When We All Fall Asleep, Where Do We Go?"), ("Billie Eilish", "Happier Than Ever"),
    ("Dua Lipa", "Future Nostalgia"),
    ("Harry Styles", "Fine Line"), ("Harry Styles", "Harry's House"),
    ("Olivia Rodrigo", "SOUR"),
    ("Ariana Grande", "thank u, next"), ("Ariana Grande", "Positions"),
    ("Ariana Grande", "Sweetener"), ("Ariana Grande", "Dangerous Woman"),
    ("Drake", "Views"), ("Drake", "Scorpion"), ("Drake", "Take Care"),
    ("Kendrick Lamar", "DAMN."), ("Kendrick Lamar", "good kid, m.A.A.d city"),
    ("Kendrick Lamar", "To Pimp a Butterfly"),
    ("Post Malone", "Hollywood's Bleeding"), ("Post Malone", "Beerbongs & Bentleys"),
    ("Bad Bunny", "Un Verano Sin Ti"), ("Bad Bunny", "YHLQMDLG"),
    ("Justin Bieber", "Justice"), ("Justin Bieber", "Purpose"),
    ("Adele", "21"), ("Adele", "25"), ("Adele", "30"),
    ("Beyoncé", "Lemonade"), ("Beyoncé", "Renaissance"),
    ("Eminem", "The Marshall Mathers LP"), ("Eminem", "Recovery"),
    ("Coldplay", "Music of the Spheres"), ("Coldplay", "Parachutes"),
    ("Michael Jackson", "Thriller"),
    ("The Beatles", "Abbey Road"),
    ("Rihanna", "Anti"),
    ("Bruno Mars", "24K Magic"), ("Bruno Mars", "Unorthodox Jukebox"),
    ("Lana Del Rey", "Norman Fucking Rockwell!"), ("Lana Del Rey", "Born to Die"),
    ("SZA", "SOS"), ("SZA", "CTRL"),
    ("Frank Ocean", "Blonde"),
    ("Kanye West", "My Beautiful Dark Twisted Fantasy"), ("Kanye West", "The College Dropout"),
    ("Tyler, the Creator", "IGOR"),
]


async def _enrich_album_ids(album_ids: list[str], label: str = "seed") -> int:
    """
    Fetch Spotify metadata + Last.fm play count for a list of album IDs.
    Skips albums that are already fresh.  Returns count of successfully enriched albums.
    """
    from services import spotify
    from services import album_cache as cache
    from services import lastfm as lastfm_svc

    seeded = 0
    for spotify_id in album_ids:
        try:
            async with AsyncSessionLocal() as db:
                existing = await cache.get_cached_album(db, spotify_id)
                if existing and not cache.needs_enrichment(existing):
                    continue

            meta = await spotify.get_album(spotify_id)
            async with AsyncSessionLocal() as db:
                await cache.upsert_album(db, meta)

            artists = meta.get("artists", [])
            streams = None
            if artists:
                streams = await lastfm_svc.get_album_playcount(artists[0], meta["name"])

            async with AsyncSessionLocal() as db:
                await cache.save_kworb_streams(db, spotify_id, streams)

            if streams:
                logger.info("%s: ✓ %s — %s plays", label, meta["name"], f"{streams:,}")
                seeded += 1
            else:
                logger.info("%s: %s — no Last.fm data", label, meta["name"])

        except Exception as exc:
            logger.warning("%s: skipped %s — %s", label, spotify_id, exc)

        await asyncio.sleep(0.3)

    return seeded


async def _seed_leaderboard() -> None:
    """
    Background task: seed the leaderboard from Spotify's current top data.
    Runs 60 s after startup.  Catalog albums are seeded separately via
    POST /leaderboard/seed-catalog.
    """
    from services import spotify

    await asyncio.sleep(60)

    album_ids: list[str] = []

    try:
        top_tracks = await spotify.get_global_top_tracks(limit=50)
        for t in top_tracks:
            aid = t.get("album_id")
            if aid and aid not in album_ids:
                album_ids.append(aid)
        logger.info("Seed: %d album IDs from Global Top 50", len(album_ids))
    except Exception as exc:
        logger.warning("Seed: top tracks failed — %s", exc)

    try:
        releases = await spotify.get_new_releases(limit=20)
        for a in releases:
            if a.get("id") and a["id"] not in album_ids:
                album_ids.append(a["id"])
        logger.info("Seed: %d album IDs after new releases", len(album_ids))
    except Exception as exc:
        logger.warning("Seed: new releases failed — %s", exc)

    if not album_ids:
        logger.warning("Seed: no album IDs — aborting")
        return

    seeded = await _enrich_album_ids(album_ids, label="Seed")
    logger.info("Seed: complete — %d/%d albums with play data", seeded, len(album_ids))


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
