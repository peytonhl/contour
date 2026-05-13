"""Periodic safety net for album stream enrichment.

Defense-in-depth behind the inline spawn_enrichment() that fires on user
views. The inline path covers the common case; this sweeper guarantees
nothing gets stuck if a task is cancelled at shutdown, an external is
briefly unreachable, or the inline call otherwise drops on the floor.

Importantly: the sweeper builds enrichment meta DIRECTLY FROM THE
AlbumCache ROW — it does not call spotify.get_album. Spotify's
/v1/albums/{id} endpoint has been intermittently 404'ing for our
credential (folklore, UTOPIA, and other valid albums hit this), so
making the sweeper depend on it means real albums sit pending forever.
Resolving artist names through the hardcoded _ARTIST_IDS map gets us
Kworb access for the popular long tail; the unknown rest falls through
to Last.fm with just the artist name.

Steady-state behavior: when no rows are stuck, sweep_once() returns 0
and does nothing. Zero pressure on Kworb / Last.fm. Only kicks in to
repair.

Tunables are module-level so a test can monkeypatch them — run_forever
is a thin loop around sweep_once; we unit-test sweep_once instead.
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


def _row_to_meta(row, artist_ids_map: dict[str, str]) -> dict:
    """Synthesize an enrichment meta dict from an AlbumCache row + the
    hardcoded artist-name → Spotify-ID map. Mirrors the shape of what
    spotify.get_album would have returned, minus fields we don't need.

    Empty artist_ids is fine — _enrich_album just skips Kworb and falls
    through to Last.fm using artist names.
    """
    artist_names = (
        [a.strip() for a in row.artist.split(",") if a.strip()]
        if row.artist
        else []
    )
    artist_ids: list[str] = []
    for name in artist_names:
        aid = artist_ids_map.get(name.lower())
        if aid:
            artist_ids.append(aid)

    return {
        "id": row.spotify_id,
        "name": row.name,
        "artists": artist_names,
        "artist_ids": artist_ids,
    }


async def sweep_once(
    *,
    batch_size: int = BATCH_SIZE,
    failed_retry_hours: int = FAILED_RETRY_HOURS,
) -> int:
    """Run one sweep cycle. Returns the number of rows enriched."""
    # Local imports keep this module importable from anywhere without
    # pulling the FastAPI app into the import graph eagerly.
    from database import AsyncSessionLocal
    from models import AlbumCache
    from routers.albums import _ARTIST_IDS, _enrich_album

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
        meta = _row_to_meta(row, _ARTIST_IDS)
        try:
            await _enrich_album(row.spotify_id, meta)
            processed += 1
        except Exception as exc:
            logger.warning(
                "sweeper: _enrich_album crashed for %s — %s", row.spotify_id, exc
            )
        await asyncio.sleep(PACING_SEC)

    return processed


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
