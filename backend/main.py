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

    Three-stage strategy:
      Stage 1 — Curated catalog albums:
        A hand-picked list of major releases spanning multiple eras.
        These are searched by artist+title on Spotify so no IDs need to
        be hardcoded.  Last.fm has reliable play counts for all of them.

      Stage 2 — Current Spotify top data:
        Global Top 50 + new releases.  These are recent so Last.fm may
        have limited data, but they're included for freshness.

      Stage 3 — Kworb global list (best-effort):
        Only useful if Railway's IP isn't blocked by Kworb.  Pre-fetches
        stream counts so we can skip the per-album artist page scrape.

    Runs 60 s after startup.  Already-fresh albums are skipped.
    """
    from services import spotify, kworb
    from services import album_cache as cache

    # Curated list — artist/album pairs with strong Last.fm history.
    # Using search (not hardcoded IDs) so we always get the canonical release.
    _CATALOG: list[tuple[str, str]] = [
        ("Ed Sheeran", "÷"),
        ("Ed Sheeran", "x"),
        ("Ed Sheeran", "+"),
        ("Ed Sheeran", "="),
        ("The Weeknd", "After Hours"),
        ("The Weeknd", "Starboy"),
        ("The Weeknd", "Beauty Behind the Madness"),
        ("Taylor Swift", "1989"),
        ("Taylor Swift", "folklore"),
        ("Taylor Swift", "evermore"),
        ("Taylor Swift", "Midnights"),
        ("Taylor Swift", "reputation"),
        ("Taylor Swift", "Lover"),
        ("Billie Eilish", "When We All Fall Asleep, Where Do We Go?"),
        ("Billie Eilish", "Happier Than Ever"),
        ("Dua Lipa", "Future Nostalgia"),
        ("Harry Styles", "Fine Line"),
        ("Harry Styles", "Harry's House"),
        ("Olivia Rodrigo", "SOUR"),
        ("Ariana Grande", "thank u, next"),
        ("Ariana Grande", "Positions"),
        ("Ariana Grande", "Sweetener"),
        ("Ariana Grande", "Dangerous Woman"),
        ("Drake", "Views"),
        ("Drake", "Scorpion"),
        ("Drake", "Take Care"),
        ("Kendrick Lamar", "DAMN."),
        ("Kendrick Lamar", "good kid, m.A.A.d city"),
        ("Kendrick Lamar", "To Pimp a Butterfly"),
        ("Post Malone", "Hollywood's Bleeding"),
        ("Post Malone", "Beerbongs & Bentleys"),
        ("Post Malone", "Stoney"),
        ("Bad Bunny", "Un Verano Sin Ti"),
        ("Bad Bunny", "YHLQMDLG"),
        ("Justin Bieber", "Justice"),
        ("Justin Bieber", "Purpose"),
        ("Adele", "21"),
        ("Adele", "25"),
        ("Adele", "30"),
        ("Beyoncé", "Lemonade"),
        ("Beyoncé", "Renaissance"),
        ("Beyoncé", "4"),
        ("Eminem", "The Marshall Mathers LP"),
        ("Eminem", "Recovery"),
        ("Eminem", "The Slim Shady LP"),
        ("Coldplay", "Music of the Spheres"),
        ("Coldplay", "A Head Full of Dreams"),
        ("Coldplay", "Parachutes"),
        ("Michael Jackson", "Thriller"),
        ("Michael Jackson", "Bad"),
        ("The Beatles", "Abbey Road"),
        ("Rihanna", "Anti"),
        ("Bruno Mars", "24K Magic"),
        ("Bruno Mars", "Unorthodox Jukebox"),
        ("Lana Del Rey", "Norman Fucking Rockwell!"),
        ("Lana Del Rey", "Born to Die"),
        ("SZA", "SOS"),
        ("SZA", "CTRL"),
        ("Frank Ocean", "Blonde"),
        ("Kanye West", "My Beautiful Dark Twisted Fantasy"),
        ("Kanye West", "The College Dropout"),
        ("Tyler, the Creator", "IGOR"),
        ("Tyler, the Creator", "Call Me If You Get Lost"),
    ]

    await asyncio.sleep(60)

    album_ids: list[str] = []
    kworb_entries: dict[str, int] = {}

    # ── Stage 1: curated catalog — search Spotify for each entry ─────────────
    logger.info("Leaderboard seed: searching Spotify for %d catalog albums…", len(_CATALOG))
    for artist_name, album_title in _CATALOG:
        try:
            results = await spotify.search_albums(f"{album_title} {artist_name}", limit=3)
            # Pick the result whose album name most closely matches (case-insensitive)
            target = album_title.lower()
            match = next(
                (r for r in results if r.get("name", "").lower() == target),
                results[0] if results else None,
            )
            if match and match.get("id") and match["id"] not in album_ids:
                album_ids.append(match["id"])
        except Exception as exc:
            logger.debug("Leaderboard seed: catalog search failed for %s / %s — %s", artist_name, album_title, exc)
        await asyncio.sleep(0.1)
    logger.info("Leaderboard seed: %d album IDs from catalog search", len(album_ids))

    # ── Stage 2: current Spotify top data ────────────────────────────────────
    try:
        top_tracks = await spotify.get_global_top_tracks(limit=50)
        for t in top_tracks:
            aid = t.get("album_id")
            if aid and aid not in album_ids:
                album_ids.append(aid)
        logger.info("Leaderboard seed: %d album IDs after Global Top 50", len(album_ids))
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

    # ── Stage 3: Kworb global list (best-effort, may be blocked) ─────────────
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

    from services import lastfm as lastfm_svc  # imported here to avoid circular at module load

    seeded = 0
    kworb_failures = 0       # circuit breaker — skip Kworb after 2 consecutive timeouts
    KWORB_FAILURE_LIMIT = 2  # Railway IPs are often blocked; fail fast

    for spotify_id in album_ids:
        try:
            async with AsyncSessionLocal() as db:
                existing = await cache.get_cached_album(db, spotify_id)
                if existing and not cache.needs_enrichment(existing):
                    continue  # already fresh — skip

            meta = await spotify.get_album(spotify_id)
            async with AsyncSessionLocal() as db:
                await cache.upsert_album(db, meta)

            # Enrichment strategy (same priority order as _enrich_album in albums.py):
            #   1. Pre-fetched Kworb global list streams (fastest — already in memory)
            #   2. Kworb artist albums page scrape
            #   3. Last.fm album.getInfo (reliable REST API, works from any IP)

            streams = kworb_entries.get(spotify_id)
            source = "kworb-list"

            if streams is None and kworb_failures < KWORB_FAILURE_LIMIT:
                artist_ids = meta.get("artist_ids", [])
                if artist_ids:
                    streams = await kworb.get_album_streams(artist_ids[0], meta["name"])
                    if streams:
                        source = "kworb-artist"
                        kworb_failures = 0  # reset on success
                    else:
                        kworb_failures += 1
                        if kworb_failures >= KWORB_FAILURE_LIMIT:
                            logger.warning("Leaderboard seed: Kworb unreachable — skipping for remaining albums")
            elif streams is None and kworb_failures >= KWORB_FAILURE_LIMIT:
                pass  # circuit open — skip Kworb entirely

            if streams is None:
                artists = meta.get("artists", [])
                if artists:
                    streams = await lastfm_svc.get_album_playcount(artists[0], meta["name"])
                    if streams:
                        source = "lastfm"

            async with AsyncSessionLocal() as db:
                await cache.save_kworb_streams(db, spotify_id, streams)

            if streams:
                logger.info("Leaderboard seed: ✓ %s — %s plays [%s]", meta["name"], f"{streams:,}", source)
                seeded += 1
            else:
                logger.info("Leaderboard seed: %s — no play data found", meta["name"])

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
