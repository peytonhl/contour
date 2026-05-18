"""Track search, metadata, and async stream enrichment endpoints."""

import asyncio
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import date

from database import get_db
from models import TrackCache
from services import deezer as deezer_svc
from services import kworb, lastfm, spotify
from services import album_cache as cache
from services import stream_anchors as anchors_svc
from services.normalization import build_trajectory, riaa_milestones, parse_release_date, era_context, data_tier

logger = logging.getLogger(__name__)
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
    # 30-second audio preview clip URL — Spotify when available, otherwise
    # backfilled from Deezer's public API (no key required). Short-lived:
    # Deezer URLs carry an Akamai signature that expires in ~15 minutes, so
    # this is never persisted to the DB — every /tracks/{id} call resolves
    # it fresh (Deezer responses are Redis-cached with TTL clamped to the
    # signature expiry — see services/deezer.py:_signed_url_ttl).
    preview_url: Optional[str] = None


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


async def _attach_preview_url(track: TrackResult) -> TrackResult:
    """
    Ensure `track.preview_url` is populated, querying Deezer if needed.

    Spotify dropped preview_url for most tracks in late 2023 (Extended Access
    only). Deezer's public API still returns 30s previews for the bulk of
    the catalog without an API key. Mirrors the enrichment pass that the
    For You feed does in routers/discover.py.

    Safe to call when preview_url is already set — short-circuits.
    """
    if track.preview_url:
        return track
    primary_artist = track.artists[0] if track.artists else ""
    if not (track.name and primary_artist):
        return track
    try:
        url = await deezer_svc.get_preview(track.name, primary_artist)
    except Exception:
        url = None
    if url:
        track.preview_url = url
    return track


@router.get("/search", response_model=List[TrackResult])
async def search_tracks(q: str = Query(..., min_length=1), db: AsyncSession = Depends(get_db)):
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

    return (spotify_results + db_extras)[:15]


@router.get("/{track_id}", response_model=TrackResult)
async def get_track(track_id: str, db: AsyncSession = Depends(get_db)):
    # Cache short-circuit: if we already have the track locally, return it
    # without a Spotify roundtrip. Mirrors the album endpoint's behavior —
    # the previous code fired Spotify on every page view even when the cache
    # was warm, which burned the rate-limit budget for hot tracks.
    cached = (await db.execute(
        select(TrackCache).where(TrackCache.spotify_id == track_id)
    )).scalar_one_or_none()
    if cached and cached.image_url:
        result = _row_to_track_result(cached)
        return await _attach_preview_url(result)

    try:
        meta = await spotify.get_track(track_id)
        await cache.upsert_album(db, meta)
        await _upsert_track(db, meta)
        # Construct TrackResult so we can backfill preview_url before returning;
        # Pydantic v2 ignores meta's extra keys (isrc, label, etc.) by default.
        result = TrackResult.model_validate(meta)
        return await _attach_preview_url(result)
    except Exception:
        if cached:
            result = _row_to_track_result(cached)
            return await _attach_preview_url(result)
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
        spawn_track_enrichment(track_id, meta)

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
        spawn_track_enrichment(track_id, meta)

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


# Strong-ref set for in-flight enrichment tasks. Mirrors the pattern in
# routers/albums.py — without this, asyncio.create_task can be garbage-
# collected mid-flight (the event loop only keeps weak refs), which was
# the root cause of track enrichments silently never running. The previous
# `background_tasks.add_task(_enrich_track, ..., db)` also passed the
# request-scoped DB session which FastAPI tears down before the task runs,
# so every write would have crashed once the task did execute.
_inflight_track_enrichments: set[asyncio.Task] = set()


def spawn_track_enrichment(track_id: str, meta: dict) -> asyncio.Task:
    """Schedule background enrichment for a track. Fire-and-forget — the task
    is held alive in a module-level set until done."""
    task = asyncio.create_task(_enrich_track(track_id, meta))
    _inflight_track_enrichments.add(task)
    task.add_done_callback(_inflight_track_enrichments.discard)
    return task


async def _enrich_track(track_id: str, meta: dict) -> None:
    """
    Resolve a track's total stream count and persist it.

    Strategy mirrors _enrich_album:
      1. Kworb artist tracks page — exact match against the artist's full
         tracks listing. Works from Railway for the artist-level pages
         (entity pages are blocked).
      2. Last.fm track.getInfo — lifetime scrobbles, reliable REST. This
         fallback is new: previously tracks ONLY tried Kworb and rows
         stuck on enrichment_status="failed" forever when Kworb missed,
         leaving the TrackPage with a blank "Total streams" stat.
      3. For multi-credit tracks, try each credited artist before giving up.

    Opens its own AsyncSessionLocal — must NOT accept the request-scoped
    session because FastAPI tears that down before the background task
    runs. (Previous bug: tracks.py was passing `db` from Depends; every
    write silently failed once the task fired.)
    """
    from database import AsyncSessionLocal

    artist_ids = meta.get("artist_ids", []) or []
    artists = meta.get("artists", []) or []
    name = meta.get("name", "")
    streams: Optional[int] = None
    source: str = "none"

    logger.info(
        "track enrichment: START %s name=%r artists=%s artist_ids=%s",
        track_id, name, artists, artist_ids,
    )

    # 1. Kworb — try each credited artist's tracks page until one returns a hit.
    for aid in artist_ids[:3]:
        try:
            streams = await kworb.get_track_streams(aid, name)
        except Exception as exc:
            logger.warning("track enrichment: kworb threw for %s/%s — %s", aid, name, exc)
            streams = None
        if streams:
            source = "kworb"
            logger.info(
                "track enrichment: kworb  %s (via artist %s) — %s",
                name, aid, f"{streams:,}",
            )
            break

    # 2. Last.fm fallback — primary safety net for tracks Kworb can't resolve.
    if streams is None and artists:
        for artist in artists[:3]:
            try:
                streams = await lastfm.get_track_playcount(artist, name)
            except Exception as exc:
                logger.warning(
                    "track enrichment: lastfm threw for %s/%s — %s",
                    artist, name, exc,
                )
                streams = None
            if streams:
                source = "lastfm"
                logger.info(
                    "track enrichment: lastfm %s (via artist %s) — %s plays",
                    name, artist, f"{streams:,}",
                )
                break

    if streams is None:
        logger.warning(
            "track enrichment: FAILED %s — artists=%s artist_ids=%s (Kworb + Last.fm both missed)",
            name, artists, artist_ids,
        )

    try:
        async with AsyncSessionLocal() as db:
            await cache.save_kworb_streams(db, track_id, streams)
    except Exception as exc:
        logger.warning("track enrichment: DB write failed for %s — %s", track_id, exc)
        logger.info(
            "track enrichment: DONE %s status=error source=%s streams=%s",
            track_id, source, streams,
        )
        return

    logger.info(
        "track enrichment: DONE %s status=%s source=%s streams=%s",
        track_id, "done" if streams is not None else "failed", source, streams,
    )
