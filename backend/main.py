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
    Background loop: seed and refresh the leaderboard.

    Runs 60 s after startup, then repeats every 24 hours so play counts
    stay current without needing a redeploy.

    Phase 1 (fast, ~1 min): Global Top 50 + new releases via Last.fm.
    Phase 2 (catalog, ~3 min first run / ~instant on refresh): curated
      catalog of 57 major releases.  Already-fresh albums are skipped.
    """
    from services import spotify

    await asyncio.sleep(60)  # initial delay — let the app finish starting

    while True:

        # ── Phase 1: current hits ─────────────────────────────────────────
        album_ids: list[str] = []

        try:
            top_tracks = await spotify.get_global_top_tracks(limit=50)
            for t in top_tracks:
                aid = t.get("album_id")
                if aid and aid not in album_ids:
                    album_ids.append(aid)
            logger.info("Seed phase1: %d album IDs from Global Top 50", len(album_ids))
        except Exception as exc:
            logger.warning("Seed phase1: top tracks failed — %s", exc)

        try:
            releases = await spotify.get_new_releases(limit=20)
            for a in releases:
                if a.get("id") and a["id"] not in album_ids:
                    album_ids.append(a["id"])
            logger.info("Seed phase1: %d album IDs after new releases", len(album_ids))
        except Exception as exc:
            logger.warning("Seed phase1: new releases failed — %s", exc)

        if album_ids:
            seeded = await _enrich_album_ids(album_ids, label="Seed/hits")
            logger.info("Seed phase1: complete — %d/%d with play data", seeded, len(album_ids))

        # ── Phase 2: curated catalog ──────────────────────────────────────
        # 0.4 s between searches keeps us under Spotify's rate limit.
        # Already-fresh albums are skipped, so daily refreshes are fast.
        logger.info("Seed phase2: searching catalog (%d entries)…", len(_CATALOG))
        catalog_ids: list[str] = []
        for artist_name, album_title in _CATALOG:
            try:
                results = await spotify.search_albums(f"{album_title} {artist_name}", limit=3)
                target = album_title.lower()
                match = next(
                    (r for r in results if r.get("name", "").lower() == target),
                    results[0] if results else None,
                )
                if match and match.get("id") and match["id"] not in catalog_ids:
                    catalog_ids.append(match["id"])
            except Exception as exc:
                logger.debug("Seed phase2: search failed %s/%s — %s", artist_name, album_title, exc)
            await asyncio.sleep(0.4)

        logger.info("Seed phase2: %d catalog album IDs found", len(catalog_ids))
        if catalog_ids:
            seeded = await _enrich_album_ids(catalog_ids, label="Seed/catalog")
            logger.info("Seed phase2: complete — %d/%d with play data", seeded, len(catalog_ids))

        # Sleep 24 hours then refresh play counts again
        logger.info("Seed: next refresh in 24 h")
        await asyncio.sleep(24 * 60 * 60)


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

    # Pre-cache the exact Compare page preset albums synchronously — must finish
    # before the app starts serving requests so get_album cache-first always hits.
    await _seed_compare_page_albums()

    # Seed the leaderboard in the background so startup doesn't block.
    # The task self-skips albums that are already enriched and fresh.
    asyncio.create_task(_seed_leaderboard())


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
        results["spotify"] = {"ok": True, "latency_ms": round((time.monotonic() - t0) * 1000)}
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

    from fastapi.responses import JSONResponse
    status_code = 200 if healthy else 503
    return JSONResponse(
        content={"status": "ok" if healthy else "degraded", "checks": results},
        status_code=status_code,
    )
