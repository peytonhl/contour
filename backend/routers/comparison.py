"""
Comparison endpoint — builds normalized streaming trajectories for two albums or tracks.

Stream counts come from Kworb (populated async). If a cache entry is missing,
the trajectory is empty and enrichment_pending is set so the frontend can retry.
"""

import asyncio
from datetime import date
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from services import spotify
from services import album_cache as cache
from services.normalization import build_trajectory, riaa_milestones, parse_release_date
from routers.albums import _enrich_album, spawn_enrichment
from routers.tracks import spawn_track_enrichment

router = APIRouter(prefix="/compare", tags=["comparison"])


class TrajectoryPoint(BaseModel):
    day: int
    date: str
    streams_cumulative: int
    normalized: float


class AlbumMeta(BaseModel):
    id: str
    name: str
    artists: List[str]
    release_date: str
    label: Optional[str]
    total_streams: Optional[int]
    stream_source: str  # "kworb" | "estimated" | "pending"
    stream_warning: Optional[str]
    popularity: Optional[int]
    image_url: Optional[str]
    riaa_milestones: List[Dict]
    entity_type: str = "album"  # "album" | "track"
    album_name: Optional[str] = None  # populated for tracks


class ComparisonResponse(BaseModel):
    album_a: AlbumMeta
    album_b: AlbumMeta
    # Side C is optional. When the request omits album_c_id (and track_c_id),
    # album_c / trajectory_c are None and the frontend renders a 2-way chart.
    album_c: Optional[AlbumMeta] = None
    trajectory_a: List[TrajectoryPoint]
    trajectory_b: List[TrajectoryPoint]
    trajectory_c: Optional[List[TrajectoryPoint]] = None
    data_disclaimer: str
    enrichment_pending: bool


DISCLAIMER = (
    "Stream trajectories are modeled approximations, not actual historical data. "
    "The curve is calibrated to the known total stream count and uses a standard "
    "streaming decay model (exponential early decay + power-law catalog tail). "
    "Exact day-by-day data requires Luminate licensing."
)


@router.get("/", response_model=ComparisonResponse)
async def compare_albums(
    album_a_id: str = Query(...),
    album_b_id: str = Query(...),
    album_c_id: Optional[str] = Query(None, description="Optional third album to overlay"),
    edition_ids_a: Optional[str] = Query(None, description="Comma-separated Spotify IDs to aggregate for album A"),
    edition_ids_b: Optional[str] = Query(None, description="Comma-separated Spotify IDs to aggregate for album B"),
    edition_ids_c: Optional[str] = Query(None, description="Comma-separated Spotify IDs to aggregate for album C"),
    track_a_id: Optional[str] = Query(None, description="If set, treat slot A as a track instead of an album"),
    track_b_id: Optional[str] = Query(None, description="If set, treat slot B as a track instead of an album"),
    track_c_id: Optional[str] = Query(None, description="If set, treat slot C as a track instead of an album"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns immediately. If Kworb stream counts aren't cached yet, trajectory is
    empty and enrichment_pending=true. The frontend should retry once enrichment
    completes.

    Pass track_a_id / track_b_id to compare individual songs instead of albums.
    """
    # --- Slot A ---
    if track_a_id:
        try:
            meta_a = await spotify.get_track(track_a_id)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Track A not found: {e}")
        streams_a, source_a, pending_a = await _resolve_track_streams(track_a_id, meta_a, background_tasks, db)
        entity_type_a, album_name_a = "track", meta_a.get("album_name")
    else:
        ids_a = [i.strip() for i in edition_ids_a.split(",")] if edition_ids_a else [album_a_id]
        try:
            meta_a = await spotify.get_album(album_a_id)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Album A not found: {e}")
        streams_a, source_a, pending_a = await _resolve_streams(ids_a, meta_a, background_tasks, db)
        entity_type_a, album_name_a = "album", None

    # --- Slot B ---
    if track_b_id:
        try:
            meta_b = await spotify.get_track(track_b_id)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Track B not found: {e}")
        streams_b, source_b, pending_b = await _resolve_track_streams(track_b_id, meta_b, background_tasks, db)
        entity_type_b, album_name_b = "track", meta_b.get("album_name")
    else:
        ids_b = [i.strip() for i in edition_ids_b.split(",")] if edition_ids_b else [album_b_id]
        try:
            meta_b = await spotify.get_album(album_b_id)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Album B not found: {e}")
        streams_b, source_b, pending_b = await _resolve_streams(ids_b, meta_b, background_tasks, db)
        entity_type_b, album_name_b = "album", None

    # --- Slot C (optional) ---
    meta_c = None
    streams_c = None
    source_c = "none"
    pending_c = False
    entity_type_c = "album"
    album_name_c = None
    if track_c_id:
        try:
            meta_c = await spotify.get_track(track_c_id)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Track C not found: {e}")
        streams_c, source_c, pending_c = await _resolve_track_streams(track_c_id, meta_c, background_tasks, db)
        entity_type_c, album_name_c = "track", meta_c.get("album_name")
    elif album_c_id:
        ids_c = [i.strip() for i in edition_ids_c.split(",")] if edition_ids_c else [album_c_id]
        try:
            meta_c = await spotify.get_album(album_c_id)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Album C not found: {e}")
        streams_c, source_c, pending_c = await _resolve_streams(ids_c, meta_c, background_tasks, db)

    release_a = parse_release_date(meta_a["release_date"], meta_a["release_date_precision"])
    release_b = parse_release_date(meta_b["release_date"], meta_b["release_date_precision"])
    release_c = parse_release_date(meta_c["release_date"], meta_c["release_date_precision"]) if meta_c else None

    today = date.today()
    if release_a is None or release_a.year < 2006:
        raise HTTPException(status_code=422, detail="Item A released before 2006. Pre-2006 is not supported — Spotify launched in 2008 and reliable stream totals require at least a few years of platform history.")
    if release_b is None or release_b.year < 2006:
        raise HTTPException(status_code=422, detail="Item B released before 2006. Pre-2006 is not supported — Spotify launched in 2008 and reliable stream totals require at least a few years of platform history.")
    if meta_c is not None and (release_c is None or release_c.year < 2006):
        raise HTTPException(status_code=422, detail="Item C released before 2006. Pre-2006 is not supported — Spotify launched in 2008 and reliable stream totals require at least a few years of platform history.")
    if release_a > today:
        release_a = today
    if release_b > today:
        release_b = today
    if release_c and release_c > today:
        release_c = today

    traj_a = build_trajectory(release_a, streams_a) if streams_a else []
    traj_b = build_trajectory(release_b, streams_b) if streams_b else []
    traj_c = build_trajectory(release_c, streams_c) if (release_c and streams_c) else []

    album_c_meta = None
    if meta_c is not None:
        album_c_meta = AlbumMeta(
            id=meta_c["id"],
            name=meta_c["name"],
            artists=meta_c["artists"],
            release_date=meta_c["release_date"],
            label=meta_c.get("label"),
            total_streams=streams_c,
            stream_source=source_c,
            stream_warning=_warning(source_c, meta_c["name"]),
            popularity=meta_c.get("popularity"),
            image_url=meta_c.get("image_url"),
            riaa_milestones=riaa_milestones(streams_c),
            entity_type=entity_type_c,
            album_name=album_name_c,
        )

    return ComparisonResponse(
        album_a=AlbumMeta(
            id=meta_a["id"],
            name=meta_a["name"],
            artists=meta_a["artists"],
            release_date=meta_a["release_date"],
            label=meta_a.get("label"),
            total_streams=streams_a,
            stream_source=source_a,
            stream_warning=_warning(source_a, meta_a["name"]),
            popularity=meta_a.get("popularity"),
            image_url=meta_a.get("image_url"),
            riaa_milestones=riaa_milestones(streams_a),
            entity_type=entity_type_a,
            album_name=album_name_a,
        ),
        album_b=AlbumMeta(
            id=meta_b["id"],
            name=meta_b["name"],
            artists=meta_b["artists"],
            release_date=meta_b["release_date"],
            label=meta_b.get("label"),
            total_streams=streams_b,
            stream_source=source_b,
            stream_warning=_warning(source_b, meta_b["name"]),
            popularity=meta_b.get("popularity"),
            image_url=meta_b.get("image_url"),
            riaa_milestones=riaa_milestones(streams_b),
            entity_type=entity_type_b,
            album_name=album_name_b,
        ),
        album_c=album_c_meta,
        trajectory_a=[TrajectoryPoint(**p) for p in traj_a],
        trajectory_b=[TrajectoryPoint(**p) for p in traj_b],
        trajectory_c=[TrajectoryPoint(**p) for p in traj_c] if album_c_meta else None,
        data_disclaimer=DISCLAIMER,
        enrichment_pending=pending_a or pending_b or pending_c,
    )


@router.get("/default", response_model=ComparisonResponse)
async def default_comparison(
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
):
    """JID — The Forever Story vs God Does Like Ugly (all editions aggregated)."""
    TFS_ID = "4rJDCELWL0fjdmN9Gn4f4g"  # The Forever Story (Extended Version)

    # All confirmed GDLU editions on Spotify (standard, preluxe, alternate, second standard)
    GDLU_IDS = ",".join([
        "2tU04u3hxtziB4sOVJKak3",  # standard (15 tracks)
        "4QtC07On8yiD1cZN1zn4RG",  # preluxe (19 tracks)
        "1wD9BC4z0nChaws7elZs4F",  # alternate (16 tracks)
        "02JZ3Fonwh7jfHJ2DsRb0j",  # second standard (15 tracks)
    ])

    # NOTE: call every parameter explicitly. compare_albums is a FastAPI route
    # whose optional params default to Query(...) FieldInfo objects, not None.
    # When invoked directly as a plain function (as here), any omitted param
    # keeps its FieldInfo sentinel — and `if track_a_id:` then reads truthy,
    # sending the stringified FieldInfo to Spotify as a track ID → 400 → the
    # whole default comparison 500s. Pass None for every unused slot.
    return await compare_albums(
        album_a_id=TFS_ID,
        album_b_id="2tU04u3hxtziB4sOVJKak3",
        album_c_id=None,
        edition_ids_a=None,
        edition_ids_b=GDLU_IDS,
        edition_ids_c=None,
        track_a_id=None,
        track_b_id=None,
        track_c_id=None,
        background_tasks=background_tasks,
        db=db,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _resolve_track_streams(
    track_id: str,
    meta: dict,
    background_tasks: BackgroundTasks,
    db: AsyncSession,
) -> tuple:
    """Resolve stream count for a single track. Returns (streams, source, is_pending)."""
    row = await cache.upsert_album(db, meta)
    if cache.needs_enrichment(row):
        # spawn_track_enrichment opens its own AsyncSession internally — the
        # request-scoped `db` here would be closed before any BackgroundTask
        # could write through it (same root-cause as the silent enrichment
        # failure tracked in routers/tracks.py).
        spawn_track_enrichment(track_id, meta)
        pending = True
    else:
        pending = False

    streams = cache.streams_for_album(row)
    if streams is None:
        return None, "none", pending

    source = "kworb" if not pending else "partial"
    return streams, source, pending


async def _resolve_streams(
    spotify_ids: List[str],
    primary_meta: dict,
    background_tasks: BackgroundTasks,
    db: AsyncSession,
) -> tuple:
    """
    Sum stream counts across all provided edition IDs.
    Returns (total_streams, source, is_pending).
    """
    total = 0
    any_pending = False

    for sid in spotify_ids:
        try:
            meta = await spotify.get_album(sid)
        except Exception:
            meta = primary_meta

        row = await cache.upsert_album(db, meta)
        if cache.needs_enrichment(row):
            spawn_enrichment(sid, meta)
            any_pending = True

        streams = cache.streams_for_album(row)
        if streams is not None:
            total += streams

    if total == 0:
        return None, "none", any_pending

    source = "kworb" if not any_pending else "partial"
    return total, source, any_pending


def _warning(source: str, name: str) -> Optional[str]:
    if source == "kworb":
        return None
    if source == "none":
        return f'Stream count for "{name}" not yet available — enriching in background.'
    if source == "partial":
        return f'Some editions of "{name}" are still being enriched. Stream count may update shortly.'
    return None
