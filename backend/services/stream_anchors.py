"""
Stream anchor service — load, store, and refresh real stream data points.

Coordinates between kworb (daily chart data), wayback (historical snapshots),
and the stream_anchors / anchor_fetch_status DB tables.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AnchorFetchStatus, StreamAnchor
from services import kworb, wayback

# Re-fetch live Kworb daily data after this many days (it updates as songs chart)
KWORB_DAILY_TTL_DAYS = 3

# Never re-fetch Wayback — historical data is immutable
# We do a one-time fetch and that's it.


async def load_anchors(
    db: AsyncSession,
    entity_id: str,
    entity_type: str,
) -> list[dict]:
    """
    Load all stored anchor points for an entity, sorted by date.
    Returns [{date, streams_cumulative, source}].
    """
    result = await db.execute(
        select(StreamAnchor)
        .where(StreamAnchor.entity_id == entity_id)
        .where(StreamAnchor.entity_type == entity_type)
        .order_by(StreamAnchor.snapshot_date)
    )
    rows = result.scalars().all()
    return [
        {
            "date": row.snapshot_date,
            "streams_cumulative": row.stream_count,
            "source": row.source,
        }
        for row in rows
    ]


async def needs_kworb_daily_refresh(
    db: AsyncSession,
    entity_id: str,
    entity_type: str,
) -> bool:
    """True if the Kworb daily data is stale or has never been fetched."""
    result = await db.execute(
        select(AnchorFetchStatus)
        .where(AnchorFetchStatus.entity_id == entity_id)
        .where(AnchorFetchStatus.entity_type == entity_type)
    )
    status = result.scalar_one_or_none()
    if status is None or status.kworb_daily_fetched_at is None:
        return True
    age = datetime.utcnow() - status.kworb_daily_fetched_at
    return age > timedelta(days=KWORB_DAILY_TTL_DAYS)


async def needs_wayback_fetch(
    db: AsyncSession,
    entity_id: str,
    entity_type: str,
) -> bool:
    """True if we've never attempted a Wayback fetch for this entity."""
    result = await db.execute(
        select(AnchorFetchStatus)
        .where(AnchorFetchStatus.entity_id == entity_id)
        .where(AnchorFetchStatus.entity_type == entity_type)
    )
    status = result.scalar_one_or_none()
    return status is None or status.wayback_fetched_at is None


async def fetch_and_store_kworb_daily(
    db: AsyncSession,
    entity_id: str,
    entity_type: str,
) -> int:
    """
    Fetch the live Kworb entity page, store all charting days as anchor points.
    Replaces existing kworb_daily anchors (data may have been corrected).
    Returns number of anchor points stored.
    """
    daily_data = await kworb.get_entity_daily_data(entity_id, entity_type)

    if daily_data:
        # Replace existing kworb_daily anchors for this entity
        await db.execute(
            delete(StreamAnchor)
            .where(StreamAnchor.entity_id == entity_id)
            .where(StreamAnchor.entity_type == entity_type)
            .where(StreamAnchor.source == "kworb_daily")
        )
        for point in daily_data:
            db.add(StreamAnchor(
                entity_id=entity_id,
                entity_type=entity_type,
                snapshot_date=point["date"],
                stream_count=point["streams_cumulative"],
                source="kworb_daily",
            ))

    await _mark_kworb_daily_fetched(db, entity_id, entity_type)
    await db.commit()
    return len(daily_data)


async def fetch_and_store_wayback(
    db: AsyncSession,
    entity_id: str,
    entity_type: str,
) -> int:
    """
    Fetch Wayback Machine snapshots, store as anchor points.
    Only runs once per entity — historical data is immutable.
    Returns number of anchor points stored.
    """
    anchors = await wayback.get_wayback_anchors(entity_id, entity_type)

    if anchors:
        for a in anchors:
            # Don't overwrite existing wayback anchors for the same date
            existing = await db.execute(
                select(StreamAnchor)
                .where(StreamAnchor.entity_id == entity_id)
                .where(StreamAnchor.entity_type == entity_type)
                .where(StreamAnchor.source == "wayback")
                .where(StreamAnchor.snapshot_date == a["date"])
            )
            if existing.scalar_one_or_none() is None:
                db.add(StreamAnchor(
                    entity_id=entity_id,
                    entity_type=entity_type,
                    snapshot_date=a["date"],
                    stream_count=a["streams"],
                    source="wayback",
                ))

    await _mark_wayback_fetched(db, entity_id, entity_type)
    await db.commit()
    return len(anchors)


async def _mark_kworb_daily_fetched(
    db: AsyncSession, entity_id: str, entity_type: str
) -> None:
    result = await db.execute(
        select(AnchorFetchStatus)
        .where(AnchorFetchStatus.entity_id == entity_id)
        .where(AnchorFetchStatus.entity_type == entity_type)
    )
    status = result.scalar_one_or_none()
    if status is None:
        db.add(AnchorFetchStatus(
            entity_id=entity_id,
            entity_type=entity_type,
            kworb_daily_fetched_at=datetime.utcnow(),
        ))
    else:
        status.kworb_daily_fetched_at = datetime.utcnow()


async def _mark_wayback_fetched(
    db: AsyncSession, entity_id: str, entity_type: str
) -> None:
    result = await db.execute(
        select(AnchorFetchStatus)
        .where(AnchorFetchStatus.entity_id == entity_id)
        .where(AnchorFetchStatus.entity_type == entity_type)
    )
    status = result.scalar_one_or_none()
    if status is None:
        db.add(AnchorFetchStatus(
            entity_id=entity_id,
            entity_type=entity_type,
            wayback_fetched_at=datetime.utcnow(),
        ))
    else:
        status.wayback_fetched_at = datetime.utcnow()
