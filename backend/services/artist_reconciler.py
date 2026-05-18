"""
Background reconciler — keeps ArtistCache in sync with TrackCache.

Why this exists
───────────────
Every track persisted to TrackCache (from any path: feed fetches, search,
album-page views, ratings, etc.) carries `artist_ids_json`, but no path
EXPLICITLY guarantees the primary artist also lands in ArtistCache with
genre tags. Historically the only artist-persistence path was
`_fetch_and_persist_artist_genres` inside `search_tracks_by_genre`, and
it only fires on COLD genre-pool fetches. Plenty of TrackCache writes
went without a corresponding ArtistCache write.

Result before this worker: 909 tracks in TrackCache, only 30 artists in
ArtistCache. The artist-genre verification filter, the per-genre rating
affinity, and the catalog-pivot tier all rely on ArtistCache being
populated — without it, those features silently degrade.

What this does
──────────────
Every RECONCILE_INTERVAL_SECONDS (default 5 min), the worker:
  1. Queries TrackCache for unique primary artist IDs.
  2. Subtracts the set already present in ArtistCache.
  3. Takes the first `BATCH_SIZE` (=50, matching Spotify's per-call cap).
  4. Calls `spotify._fetch_and_persist_artist_genres(batch)`, which
     bulk-upserts via the same reliable path used elsewhere.

If the Spotify circuit is open (Redis-backed deadline), the call short-
circuits without spending any quota. If the call itself fails, the
worker logs and continues — next cycle picks up where this one left off.

Cost
────
1 Spotify /v1/artists?ids=... call per cycle. At 5-min intervals: 12
calls/hour, 288 calls/day. Well below any rate limit. Cached pools
mean steady-state is much lower (most new tracks' artists already in
cache after a few hours of operation).

Catch-up time
─────────────
For an N-artist backlog at BATCH_SIZE=50, RECONCILE_INTERVAL_SECONDS=300:
  N / 50 cycles × 5 min = N / 10 minutes
So 600 artists clear in ~60 min. New tracks added in the meantime get
picked up on subsequent cycles.

Pattern note
────────────
Holds a strong module-level reference to the asyncio task (set by
main.py:_artist_reconciler_task) so the long sleep at the top of
run_forever doesn't get GC'd. Same lesson as the enrichment sweeper.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

from sqlalchemy import select

from database import AsyncSessionLocal
from models import ArtistCache, TrackCache

logger = logging.getLogger(__name__)

# Tunables — env var override for ops without code changes.
RECONCILE_INTERVAL_SECONDS = int(os.environ.get("ARTIST_RECONCILE_INTERVAL", "300"))
BATCH_SIZE = int(os.environ.get("ARTIST_RECONCILE_BATCH_SIZE", "50"))
# Wait this long after startup before the FIRST cycle. Gives the rest of
# the boot sequence (alembic, sweeper, etc.) time to settle so we don't
# pile on at the moment the app is most fragile.
STARTUP_DELAY_SECONDS = int(os.environ.get("ARTIST_RECONCILE_STARTUP_DELAY", "90"))


async def _find_unmapped_primary_artists(limit: int) -> list[str]:
    """Return up to `limit` primary artist IDs that appear in TrackCache
    but not in ArtistCache. Result is deterministic across runs (sorted)
    so successive cycles process the same backlog in stable order rather
    than re-shuffling — useful for diagnosing progress."""
    async with AsyncSessionLocal() as session:
        # Pull all primary artist IDs from TrackCache. JSON parsing in
        # Python so the query is DB-agnostic (Postgres prod, SQLite dev).
        track_rows = (await session.execute(
            select(TrackCache.artist_ids_json)
            .where(TrackCache.artist_ids_json.is_not(None))
        )).scalars().all()
        primary_ids: set[str] = set()
        for aids_json in track_rows:
            try:
                ids = json.loads(aids_json or "[]")
                if ids:
                    primary_ids.add(ids[0])
            except Exception:
                continue
        if not primary_ids:
            return []

        cached_ids = set((await session.execute(
            select(ArtistCache.spotify_id).where(ArtistCache.spotify_id.in_(primary_ids))
        )).scalars().all())

    unmapped = sorted(primary_ids - cached_ids)
    return unmapped[:limit]


async def run_forever() -> None:
    """Long-running reconciliation loop. Scheduled from main.py startup
    as a fire-and-hold-reference task. Never returns under normal
    operation — only exits if the event loop is shutting down."""
    logger.info(
        "[artist_reconciler] starting (interval=%ds, batch=%d, startup_delay=%ds)",
        RECONCILE_INTERVAL_SECONDS, BATCH_SIZE, STARTUP_DELAY_SECONDS,
    )
    try:
        await asyncio.sleep(STARTUP_DELAY_SECONDS)
    except asyncio.CancelledError:
        return

    # Import here (not at module level) to avoid a circular import:
    # spotify.py imports from services/redis_cache.py which imports
    # nothing from us, but keeping the cycle clean is good hygiene
    # in case future code restructuring adds back-edges.
    from services import spotify

    while True:
        try:
            unmapped = await _find_unmapped_primary_artists(BATCH_SIZE)
            if not unmapped:
                logger.debug("[artist_reconciler] cycle clear (all primary artists cached)")
            else:
                # _fetch_and_persist_artist_genres respects the Spotify
                # circuit breaker internally — if open, this returns {}
                # immediately without spending quota. The unmapped artists
                # stay un-cached and are picked up by the next cycle.
                fetched = await spotify._fetch_and_persist_artist_genres(unmapped)
                logger.info(
                    "[artist_reconciler] cycle: %d unmapped, %d fetched + persisted",
                    len(unmapped), len(fetched),
                )
        except Exception as exc:
            # Never let an exception kill the loop — log and continue.
            # Common transient errors: DB connection blip, Redis timeout,
            # Spotify auth refresh hiccup. Next cycle will retry.
            logger.warning("[artist_reconciler] cycle failed (will retry): %s", exc)

        try:
            await asyncio.sleep(RECONCILE_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("[artist_reconciler] cancelled, exiting")
            return
