"""Era-adjusted streaming leaderboard."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
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
