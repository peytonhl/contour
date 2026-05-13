"""Periodic safety net for album stream enrichment.

Defense-in-depth behind the inline asyncio.create_task(_enrich_album(...))
that fires on user views. The inline path covers the common case; this
sweeper guarantees nothing gets stuck if a task is cancelled at shutdown,
an external (Kworb/Last.fm) is briefly unreachable, or the inline call
otherwise drops on the floor.

Steady-state behavior: when no rows are stuck, sweep_once() returns 0 and
does nothing. Zero pressure on Spotify/Kworb. Only kicks in to repair.

Tunables are module-level so a test can monkeypatch them — the run_forever
loop is the one bit that's not directly testable (infinite loop), so we
keep it as thin as possible and unit-test sweep_once() instead.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import and_, or_, select

logger = logging.getLogger(__name__)

INITIAL_DELAY_SEC = 60   # let startup tasks settle before first sweep
INTERVAL_SEC = 60        # sweep every minute
BATCH_SIZE = 10          # max rows per sweep — keeps pressure bounded
FAILED_RETRY_HOURS = 6   # don't retry failed rows more often than this
PACING_SEC = 0.5         # gentle delay between rows within a batch


async def sweep_once(
    *,
    batch_size: int = BATCH_SIZE,
    failed_retry_hours: int = FAILED_RETRY_HOURS,
) -> int:
    """Run one sweep cycle. Returns the number of rows processed."""
    # Local imports keep this module importable from anywhere without
    # pulling the FastAPI app into the import graph eagerly.
    from database import AsyncSessionLocal
    from models import AlbumCache
    from routers.albums import _enrich_album
    from services import spotify as spotify_svc

    cutoff = datetime.utcnow() - timedelta(hours=failed_retry_hours)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(AlbumCache)
            .where(
                or_(
                    AlbumCache.enrichment_status == "pending",
                    and_(
                        AlbumCache.enrichment_status == "failed",
                        or_(
                            AlbumCache.enriched_at.is_(None),
                            AlbumCache.enriched_at < cutoff,
                        ),
                    ),
                )
            )
            .order_by(AlbumCache.popularity.desc().nulls_last())
            .limit(batch_size)
        )
        rows = result.scalars().all()

    if not rows:
        return 0

    processed = 0
    for row in rows:
        # Fetch meta from Spotify (Redis-cached 30d in normal operation, so
        # this is almost always free). We need fresh artist_ids — the
        # AlbumCache row doesn't store them.
        try:
            meta = await spotify_svc.get_album(row.spotify_id)
        except Exception as exc:
            logger.warning(
                "sweeper: spotify fetch failed for %s — %s", row.spotify_id, exc
            )
            # Mark the row as failed with current timestamp so this same
            # broken ID isn't re-picked every sweep cycle. Without this,
            # any row whose Spotify ID is permanently 404 (delisted album,
            # wrong ID stored, regional block) sits at the top of the
            # priority queue forever and burns the entire batch budget on
            # the same handful of rows. Failed rows get retried after
            # FAILED_RETRY_HOURS, so transient Spotify hiccups self-heal.
            await _mark_failed(row.spotify_id)
            continue

        try:
            await _enrich_album(row.spotify_id, meta)
            processed += 1
        except Exception as exc:
            logger.warning(
                "sweeper: _enrich_album crashed for %s — %s", row.spotify_id, exc
            )

        await asyncio.sleep(PACING_SEC)

    return processed


async def _mark_failed(spotify_id: str) -> None:
    """Stamp a row as failed with the current timestamp. Used by the sweeper
    when an album can't even be fetched from Spotify (404 / persistent error)
    so the same broken ID doesn't dominate every batch."""
    from database import AsyncSessionLocal
    from services import album_cache as cache

    try:
        async with AsyncSessionLocal() as db:
            await cache.save_kworb_streams(db, spotify_id, None)
    except Exception as exc:
        logger.warning("sweeper: failed to mark %s as failed — %s", spotify_id, exc)


async def run_forever() -> None:
    """Long-running task that calls sweep_once on a fixed interval.

    Launch from app startup:
        asyncio.create_task(enrichment_sweeper.run_forever())
    """
    await asyncio.sleep(INITIAL_DELAY_SEC)
    logger.info(
        "enrichment sweeper: starting (interval=%ds batch=%d)",
        INTERVAL_SEC, BATCH_SIZE,
    )
    while True:
        try:
            count = await sweep_once()
            if count > 0:
                logger.info("enrichment sweeper: processed %d row(s)", count)
        except Exception as exc:
            logger.warning("enrichment sweeper: cycle error — %s", exc)
        await asyncio.sleep(INTERVAL_SEC)
