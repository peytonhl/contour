"""Track search, metadata, and async stream enrichment endpoints."""

from typing import List, Optional

import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import date

from database import get_db
from models import TrackCache
from services import kworb, spotify
from services import album_cache as cache
from services import stream_anchors as anchors_svc
from services.normalization import build_trajectory, riaa_milestones, parse_release_date, era_context, data_tier

router = APIRouter(prefix="/tracks", tags=["tracks"])


class TrackResult(BaseModel):
    id: str
    name: str
    artists: List[str]
    artist_ids: List[str] = []
    album_name: str
    album_id: Optional[str]
    release_date: str
    duration_ms: Optional[int]
    popularity: Optional[int]
    explicit: bool
    image_url: Optional[str]
    external_url: Optional[str]


class TrackStreamStatus(BaseModel):
    spotify_id: str
    streams: Optional[int]
    enrichment_status: str
    source: str


async def _upsert_track(db: AsyncSession, meta: dict) -> None:
    """Cache track metadata in the local DB for search fallback."""
    existing = (await db.execute(
        select(TrackCache).where(TrackCache.spotify_id == meta["id"])
    )).scalar_one_or_none()
    artist_ids_json = json.dumps(meta.get("artist_ids", []))
    if existing:
        existing.name = meta["name"]
        existing.artist = ", ".join(meta.get("artists", []))
        existing.album_name = meta.get("album_name")
        existing.album_id = meta.get("album_id")
        existing.release_date = meta.get("release_date")
        existing.duration_ms = meta.get("duration_ms")
        existing.explicit = meta.get("explicit", False)
        existing.popularity = meta.get("popularity")
        existing.image_url = meta.get("image_url")
        existing.external_url = meta.get("external_url")
        existing.artist_ids_json = artist_ids_json
    else:
        db.add(TrackCache(
            spotify_id=meta["id"],
            name=meta["name"],
            artist=", ".join(meta.get("artists", [])),
            album_name=meta.get("album_name"),
            album_id=meta.get("album_id"),
            release_date=meta.get("release_date"),
            duration_ms=meta.get("duration_ms"),
            explicit=meta.get("explicit", False),
            popularity=meta.get("popularity"),
            image_url=meta.get("image_url"),
            external_url=meta.get("external_url"),
            artist_ids_json=artist_ids_json,
        ))
    await db.commit()


def _row_to_track_result(row: TrackCache) -> TrackResult:
    return TrackResult(
        id=row.spotify_id,
        name=row.name,
        artists=[a.strip() for a in row.artist.split(",")],
        artist_ids=json.loads(row.artist_ids_json or "[]"),
        album_name=row.album_name or "",
        album_id=row.album_id,
        release_date=row.release_date or "",
        duration_ms=row.duration_ms,
        popularity=row.popularity,
        explicit=bool(row.explicit),
        image_url=row.image_url,
        external_url=row.external_url,
    )


@router.get("/search", response_model=List[TrackResult])
async def search_tracks(q: str = Query(..., min_length=1), db: AsyncSession = Depends(get_db)):
    import asyncio

    async def spotify_search():
        try:
            return await spotify.search_tracks(q)
        except Exception:
            return []

    async def db_search():
        pattern = f"%{q}%"
        rows = (await db.execute(
            select(TrackCache)
            .where(TrackCache.name.ilike(pattern) | TrackCache.artist.ilike(pattern))
            .order_by(TrackCache.popularity.desc().nulls_last())
            .limit(10)
        )).scalars().all()
        return rows

    spotify_results, db_rows = await asyncio.gather(spotify_search(), db_search())

    seen_ids = {r["id"] for r in spotify_results}
    db_extras = [_row_to_track_result(row) for row in db_rows if row.spotify_id not in seen_ids]

    return (spotify_results + db_extras)[:10]


@router.get("/{track_id}", response_model=TrackResult)
async def get_track(track_id: str, db: AsyncSession = Depends(get_db)):
    # Check local cache first
    cached = (await db.execute(
        select(TrackCache).where(TrackCache.spotify_id == track_id)
    )).scalar_one_or_none()

    try:
        meta = await spotify.get_track(track_id)
        await cache.upsert_album(db, meta)
        await _upsert_track(db, meta)
        return meta
    except Exception:
        if cached:
            return _row_to_track_result(cached)
        raise HTTPException(status_code=404, detail=f"Track {track_id} not found")


@router.get("/{track_id}/streams", response_model=TrackStreamStatus)
async def get_track_streams(
    track_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    try:
        meta = await spotify.get_track(track_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    row = await cache.upsert_album(db, meta)

    if cache.needs_enrichment(row):
        background_tasks.add_task(_enrich_track, track_id, meta, db)

    return TrackStreamStatus(
        spotify_id=track_id,
        streams=cache.streams_for_album(row),
        enrichment_status=row.enrichment_status,
        source="kworb" if row.enrichment_status == "done" else row.enrichment_status,
    )


@router.get("/{track_id}/trajectory")
async def get_track_trajectory(
    track_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    try:
        meta = await spotify.get_track(track_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    row = await cache.upsert_album(db, meta)
    if cache.needs_enrichment(row):
        background_tasks.add_task(_enrich_track, track_id, meta, db)

    streams = cache.streams_for_album(row)

    # No streams at all — nothing to chart yet
    if streams is None:
        return {
            "trajectory": [],
            "total_streams": None,
            "stream_source": "none",
            "riaa_milestones": [],
            "enrichment_pending": True,
            "era_context": None,
        }

    release = parse_release_date(meta["release_date"], meta["release_date_precision"])
    if release is None:
        raise HTTPException(status_code=422, detail="Could not parse release date")
    today = date.today()
    if release > today:
        release = today

    # Load stored anchor points; schedule Wayback fetch if never attempted.
    # Kworb entity pages are blocked from Railway IPs so we skip that fetch.
    stored_anchors = await anchors_svc.load_anchors(db, track_id, "track")

    if await anchors_svc.needs_wayback_fetch(db, track_id, "track"):
        background_tasks.add_task(
            anchors_svc.fetch_and_store_wayback, db, track_id, "track"
        )

    sources = list({a["source"] for a in stored_anchors})
    tier = data_tier(sources)

    return {
        "trajectory": build_trajectory(release, streams, anchors=stored_anchors),
        "total_streams": streams,
        "stream_source": tier,
        "riaa_milestones": riaa_milestones(streams),
        "enrichment_pending": row.enrichment_status == "pending",
        "era_context": era_context(release, streams),
    }


async def _enrich_track(track_id: str, meta: dict, db: AsyncSession) -> None:
    """Scrape Kworb for track stream count using Spotify artist ID."""
    artist_ids = meta.get("artist_ids", [])
    if not artist_ids:
        await cache.save_kworb_streams(db, track_id, None)
        return
    streams = await kworb.get_track_streams(artist_ids[0], meta["name"])
    await cache.save_kworb_streams(db, track_id, streams)
