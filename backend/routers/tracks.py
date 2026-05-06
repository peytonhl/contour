"""Track search, metadata, and async stream enrichment endpoints."""

from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import date

from database import get_db
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


@router.get("/search", response_model=List[TrackResult])
async def search_tracks(q: str = Query(..., min_length=1)):
    results = await spotify.search_tracks(q)
    return results or []


@router.get("/{track_id}", response_model=TrackResult)
async def get_track(track_id: str, db: AsyncSession = Depends(get_db)):
    try:
        meta = await spotify.get_track(track_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    await cache.upsert_album(db, meta)
    return meta


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
