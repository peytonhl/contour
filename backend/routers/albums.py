"""Album search, metadata, edition discovery, and async enrichment endpoints."""

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

router = APIRouter(prefix="/albums", tags=["albums"])


class AlbumResult(BaseModel):
    id: str
    name: str
    artists: List[str]
    artist_ids: List[str] = []
    release_date: str
    release_date_precision: str
    label: Optional[str]
    popularity: Optional[int]
    image_url: Optional[str]
    external_url: Optional[str]


class StreamStatus(BaseModel):
    spotify_id: str
    streams: Optional[int]
    enrichment_status: str  # "pending" | "done" | "failed"
    source: str


class EditionResult(BaseModel):
    id: str
    name: str
    release_date: str
    total_tracks: Optional[int]
    image_url: Optional[str]


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@router.get("/search", response_model=List[AlbumResult])
async def search_albums(q: str = Query(..., min_length=1)):
    results = await spotify.search_albums(q)
    return results or []


# ---------------------------------------------------------------------------
# Single album metadata + cache upsert
# ---------------------------------------------------------------------------

@router.get("/{album_id}", response_model=AlbumResult)
async def get_album(album_id: str, db: AsyncSession = Depends(get_db)):
    try:
        meta = await spotify.get_album(album_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    await cache.upsert_album(db, meta)
    return meta


# ---------------------------------------------------------------------------
# Edition discovery — uses Spotify discography, not Kworb fuzzy matching
# ---------------------------------------------------------------------------

@router.get("/{album_id}/editions", response_model=List[EditionResult])
async def get_editions(album_id: str):
    """
    Return all Spotify-catalogued editions of this album (deluxe, explicit,
    alternate, etc.) by scanning the primary artist's full discography.
    """
    try:
        editions = await spotify.find_editions(album_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Edition lookup failed: {e}")
    return [
        EditionResult(
            id=e["id"],
            name=e["name"],
            release_date=e.get("release_date", ""),
            total_tracks=e.get("total_tracks"),
            image_url=e.get("image_url"),
        )
        for e in editions
    ]


# ---------------------------------------------------------------------------
# Stream count — returns cached value + enrichment status
# ---------------------------------------------------------------------------

@router.get("/{album_id}/streams", response_model=StreamStatus)
async def get_streams(
    album_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Return cached stream count. If enrichment is pending or stale,
    kicks off a background Kworb scrape.
    """
    try:
        meta = await spotify.get_album(album_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    row = await cache.upsert_album(db, meta)

    if cache.needs_enrichment(row):
        background_tasks.add_task(_enrich_album, album_id, meta, db)

    return StreamStatus(
        spotify_id=album_id,
        streams=cache.streams_for_album(row),
        enrichment_status=row.enrichment_status,
        source="kworb" if row.enrichment_status == "done" else row.enrichment_status,
    )


# ---------------------------------------------------------------------------
# Bulk stream status for multiple album IDs (used by comparison polling)
# ---------------------------------------------------------------------------

@router.post("/streams/bulk", response_model=List[StreamStatus])
async def bulk_streams(
    album_ids: List[str],
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    results = []
    for album_id in album_ids:
        try:
            meta = await spotify.get_album(album_id)
            row = await cache.upsert_album(db, meta)
            if cache.needs_enrichment(row):
                background_tasks.add_task(_enrich_album, album_id, meta, db)
            results.append(StreamStatus(
                spotify_id=album_id,
                streams=cache.streams_for_album(row),
                enrichment_status=row.enrichment_status,
                source="kworb" if row.enrichment_status == "done" else row.enrichment_status,
            ))
        except Exception:
            results.append(StreamStatus(
                spotify_id=album_id,
                streams=None,
                enrichment_status="failed",
                source="failed",
            ))
    return results


# ---------------------------------------------------------------------------
# Trajectory — single-album streaming curve
# ---------------------------------------------------------------------------

@router.get("/{album_id}/trajectory")
async def get_album_trajectory(
    album_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    try:
        meta = await spotify.get_album(album_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

    row = await cache.upsert_album(db, meta)
    if cache.needs_enrichment(row):
        background_tasks.add_task(_enrich_album, album_id, meta, db)

    streams = cache.streams_for_album(row)

    # No streams yet — nothing to chart
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
    stored_anchors = await anchors_svc.load_anchors(db, album_id, "album")

    if await anchors_svc.needs_wayback_fetch(db, album_id, "album"):
        background_tasks.add_task(
            anchors_svc.fetch_and_store_wayback, db, album_id, "album"
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


# ---------------------------------------------------------------------------
# Tracklist
# ---------------------------------------------------------------------------

@router.get("/{album_id}/tracklist")
async def get_album_tracklist(album_id: str):
    try:
        return await spotify.get_album_tracks(album_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Background enrichment task
# ---------------------------------------------------------------------------

async def _enrich_album(album_id: str, meta: dict, db: AsyncSession) -> None:
    """
    Fetch play count for an album, then cache result.

    Strategy (in priority order):
      1. Kworb artist albums page — most accurate (Spotify streams), but only
         works when the server's IP isn't blocked by Kworb.
      2. Last.fm album.getInfo — reliable REST API, returns lifetime scrobbles.
         Slightly different scale than Spotify streams but suitable for ranking
         and era-adjustment comparisons.
    """
    import logging as _logging
    _log = _logging.getLogger(__name__)

    artist_ids = meta.get("artist_ids", [])
    artists = meta.get("artists", [])
    streams: int | None = None

    # 1. Kworb
    if artist_ids:
        streams = await kworb.get_album_streams(artist_ids[0], meta["name"])
        if streams:
            _log.info("enrichment: kworb  %s — %s", meta["name"], f"{streams:,}")

    # 2. Last.fm fallback
    if streams is None and artists:
        from services import lastfm
        streams = await lastfm.get_album_playcount(artists[0], meta["name"])
        if streams:
            _log.info("enrichment: lastfm %s — %s", meta["name"], f"{streams:,}")

    await cache.save_kworb_streams(db, album_id, streams)
