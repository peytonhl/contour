"""Era-adjusted streaming leaderboard."""

import bisect
import os
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlbumCache, Rating
from services.normalization import parse_release_date
from data.spotify_mau import get_mau_for_date

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])

DECADE_RANGES = {
    "2020s": (2020, 2029),
    "2010s": (2010, 2019),
    "2000s": (2000, 2009),
    "1990s": (1990, 1999),
    "1980s": (1980, 1989),
}


def _classify(streams_pct: float, avg_rating: float | None, rating_count: int) -> str | None:
    """
    Classify an album based on the gap between its streaming percentile
    and its community rating percentile.

    underrated  — rated higher than its streams would suggest (hidden gem)
    overrated   — streamed far more than the community thinks it deserves
    acclaimed   — both streams and ratings are in the top tier
    Returns None when there aren't enough ratings to say anything meaningful.
    """
    if not avg_rating or rating_count < 3:
        return None
    rating_pct = (avg_rating / 5.0) * 100
    gap = streams_pct - rating_pct
    if streams_pct > 65 and rating_pct > 65:
        return "acclaimed"
    if gap > 22 and streams_pct > 45:
        return "overrated"
    if gap < -22 and rating_pct > 60:
        return "underrated"
    return None


@router.get("/")
async def get_leaderboard(
    limit: int = Query(50, le=200),
    sort: str = Query("era", pattern="^(era|streams)$"),
    decade: str = Query("all", pattern="^(all|2020s|2010s|2000s|1990s|1980s)$"),
    db: AsyncSession = Depends(get_db),
):
    """
    Return albums ranked by era-adjusted stream count.

    era_adjusted_streams = raw_streams × (current_MAU / release_MAU)

    sort=era    → rank by era-adjusted count (default)
    sort=streams → rank by raw stream count
    decade=all  → all time (default); 2020s/2010s/2000s/1990s/1980s to filter
    """
    result = await db.execute(
        select(AlbumCache)
        .where(AlbumCache.enrichment_status == "done")
        .where(AlbumCache.kworb_streams > 0)
    )
    rows = result.scalars().all()

    # Fetch avg community rating for every album in one query
    ratings_result = await db.execute(
        select(
            Rating.entity_id,
            func.avg(Rating.value).label("avg_rating"),
            func.count(Rating.id).label("rating_count"),
        )
        .where(Rating.entity_type == "album")
        .group_by(Rating.entity_id)
    )
    ratings_map = {
        row.entity_id: {"avg_rating": float(row.avg_rating), "rating_count": int(row.rating_count)}
        for row in ratings_result.all()
    }

    current_mau = get_mau_for_date(date.today())

    entries = []
    for row in rows:
        if not row.release_date:
            continue
        release = parse_release_date(
            row.release_date, row.release_date_precision or "year"
        )
        if release is None:
            continue
        release_mau = get_mau_for_date(release)
        if release_mau <= 0:
            continue
        multiplier = current_mau / release_mau
        era_adjusted = int(row.kworb_streams * multiplier)
        rating_data = ratings_map.get(row.spotify_id, {})
        entries.append({
            "spotify_id": row.spotify_id,
            "name": row.name,
            "artist": row.artist,
            "image_url": row.image_url,
            "release_date": row.release_date,
            "release_year": release.year,
            "streams": row.kworb_streams,
            "era_adjusted_streams": era_adjusted,
            "multiplier": round(multiplier, 1),
            "avg_rating": round(rating_data["avg_rating"], 2) if rating_data.get("avg_rating") else None,
            "rating_count": rating_data.get("rating_count", 0),
        })

    # Decade filter
    if decade != "all":
        start, end = DECADE_RANGES[decade]
        entries = [e for e in entries if start <= e["release_year"] <= end]

    # Sort
    key = "era_adjusted_streams" if sort == "era" else "streams"
    entries.sort(key=lambda x: x[key], reverse=True)

    # Compute stream percentiles across the current filtered set for classification
    stream_vals = sorted(e["era_adjusted_streams"] for e in entries)
    n = len(stream_vals)

    def _pct(val: int) -> float:
        if n == 0:
            return 50.0
        idx = bisect.bisect_left(stream_vals, val)
        return (idx / n) * 100

    for e in entries:
        streams_pct = _pct(e["era_adjusted_streams"])
        e["classification"] = _classify(streams_pct, e["avg_rating"], e["rating_count"])

    # Assign ranks and trim
    for i, e in enumerate(entries[:limit]):
        e["rank"] = i + 1

    return entries[:limit]


@router.get("/debug")
async def leaderboard_debug(db: AsyncSession = Depends(get_db)):
    """
    Diagnostic endpoint — returns DB counts and a Last.fm test call.
    """
    from services import lastfm as lastfm_svc

    counts_result = await db.execute(
        select(AlbumCache.enrichment_status, func.count())
        .group_by(AlbumCache.enrichment_status)
    )
    status_counts = {row[0]: row[1] for row in counts_result.all()}

    done_result = await db.execute(
        select(func.count()).where(
            AlbumCache.enrichment_status == "done",
            AlbumCache.kworb_streams > 0,
        )
    )
    leaderboard_count = done_result.scalar()

    test_artist = "Taylor Swift"
    test_album = "1989"
    lastfm_result = await lastfm_svc.get_album_playcount(test_artist, test_album)

    return {
        "album_cache_counts": status_counts,
        "leaderboard_eligible": leaderboard_count,
        "lastfm_api_key_set": bool(os.environ.get("LASTFM_API_KEY")),
        "lastfm_test": {
            "query": f"{test_artist} / {test_album}",
            "playcount": lastfm_result,
            "working": lastfm_result is not None,
        },
    }
