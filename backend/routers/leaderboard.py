"""Era-adjusted streaming leaderboard."""

import os
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession


from database import get_db
from models import AlbumCache
from services.normalization import parse_release_date
from data.spotify_mau import get_mau_for_date

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.get("/")
async def get_leaderboard(
    limit: int = Query(50, le=200),
    sort: str = Query("era", regex="^(era|streams)$"),
    db: AsyncSession = Depends(get_db),
):
    """
    Return albums ranked by era-adjusted stream count by default.

    era_adjusted_streams = raw_streams × (current_MAU / release_MAU)
    This answers: "how many streams would this album have if released today?"

    sort=era   → rank by era-adjusted count (default)
    sort=streams → rank by raw stream count
    """
    result = await db.execute(
        select(AlbumCache)
        .where(AlbumCache.enrichment_status == "done")
        .where(AlbumCache.kworb_streams > 0)
    )
    rows = result.scalars().all()

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
        entries.append({
            "spotify_id": row.spotify_id,
            "name": row.name,
            "artist": row.artist,
            "image_url": row.image_url,
            "release_date": row.release_date,
            "streams": row.kworb_streams,
            "era_adjusted_streams": era_adjusted,
            "multiplier": round(multiplier, 1),
        })

    key = "era_adjusted_streams" if sort == "era" else "streams"
    entries.sort(key=lambda x: x[key], reverse=True)

    for i, e in enumerate(entries[:limit]):
        e["rank"] = i + 1

    return entries[:limit]


@router.get("/debug")
async def leaderboard_debug(db: AsyncSession = Depends(get_db)):
    """
    Diagnostic endpoint — returns DB counts and a Last.fm test call.
    Hit /leaderboard/debug to see exactly why the leaderboard is empty.
    """
    from services import lastfm as lastfm_svc

    # Count rows by enrichment status
    counts_result = await db.execute(
        select(AlbumCache.enrichment_status, func.count())
        .group_by(AlbumCache.enrichment_status)
    )
    status_counts = {row[0]: row[1] for row in counts_result.all()}

    # Count rows that would appear on the leaderboard
    done_result = await db.execute(
        select(func.count()).where(
            AlbumCache.enrichment_status == "done",
            AlbumCache.kworb_streams > 0,
        )
    )
    leaderboard_count = done_result.scalar()

    # Quick Last.fm test with a well-known album
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
