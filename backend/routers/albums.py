"""Album search, metadata, edition discovery, and async enrichment endpoints."""

import logging
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import date

from database import get_db
from models import AlbumCache as AlbumCacheModel
from services import kworb, spotify
from services import album_cache as cache
from services import stream_anchors as anchors_svc
from services.normalization import build_trajectory, riaa_milestones, parse_release_date, era_context, data_tier

logger = logging.getLogger(__name__)
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
# Artist name → Spotify artist ID lookup
# Spotify /v1/search requires Extended Access (blocked for most apps).
# /v1/artists/{id}/albums works without it — so we resolve artist names here
# and fetch their discography directly.  Aliases and common misspellings included.
# ---------------------------------------------------------------------------
_ARTIST_IDS: dict[str, str] = {
    # Pop / mainstream
    "taylor swift": "06HL4z0CvFAxyc27GXpf02",
    "ed sheeran": "6eUKZXaKkcviH0Ku9w2n3V",
    "ariana grande": "66CXWjxzNUsdJxJ2JdwvnR",
    "dua lipa": "6M2wZ9GZgrQXHCFfjv46we",
    "harry styles": "6KImCVD70vtIoJWnq6nGn3",
    "shawn mendes": "7n2wHs1TKAczGzO7Dd2rGr",
    "olivia rodrigo": "1McMsnEElThX1knmY4oliG",
    "billie eilish": "6qqNVTkY8uBg9cP3Jd7DAH",
    "selena gomez": "0C8ZW7ezQVs4URX5aX7Kqx",
    "miley cyrus": "5YGY8feqx7naU7z4HiWAdv",
    "charlie puth": "6VuMaDnrHyPam3QtqXPOg0",
    "sam smith": "2wY79sveU1sp5g7SokKOiI",
    "lewis capaldi": "4GNC7GD6oZMSxPGyXy4MMB",
    "niall horan": "1Hsdzj7Dlq2I7tHP7501T4",
    "zayn": "5ZsFI1h6hIdQRw2ti0hz81",
    "one direction": "4AK6F7OLvEQ5QYCBNiQWHq",
    "lizzo": "56oDRnqbIiwx4mymNEv7dS",
    "halsey": "26VFTg2z8NyhhzSbeys3Wz",
    "troye sivan": "3sSl11j0lmTd3G7cUcMECR",
    "camila cabello": "4nDoRrQiYLoBzwC5BhVJzF",
    # Pop rock / alternative / emo
    "5 seconds of summer": "5Rl15oVamLq7FbSb0NNBNy",
    "5sos": "5Rl15oVamLq7FbSb0NNBNy",
    "five seconds of summer": "5Rl15oVamLq7FbSb0NNBNy",
    "imagine dragons": "53XhwfbYqKCa1cC15pYq2q",
    "twenty one pilots": "3YQKmKGau1PzlVlkL1iAx3",
    "21 pilots": "3YQKmKGau1PzlVlkL1iAx3",
    "fall out boy": "4UXqAaa6dQYAk18Ol481n9",
    "panic at the disco": "20JZFwl6HVl6yg8a4H3ZqK",
    "panic! at the disco": "20JZFwl6HVl6yg8a4H3ZqK",
    "paramore": "74XFHRwlV6OrjEM0A2NCMF",
    "the 1975": "3mIj9lX2MWuHmhNQjed1gY",
    "green day": "7oPftvlwr6VrsViSDV7fJY",
    "blink-182": "6FBDaR13swtiWwGhX1WQsP",
    "blink 182": "6FBDaR13swtiWwGhX1WQsP",
    "my chemical romance": "1cRXChOBBSfF6x8oVrBL3c",
    "mcr": "1cRXChOBBSfF6x8oVrBL3c",
    "arctic monkeys": "7Ln80lUS6He07XvHI8qqHH",
    "the strokes": "0epOFNiUfyON9EYx7Tpr6V",
    "vampire weekend": "5BvJzeQpmsdsFp4HGUYUEx",
    "tame impala": "5INjqkS1o8h1imAzPqGZng",
    "mac demarco": "5eTHHmAuFevmYfUF63XPPP",
    "rex orange county": "4sRoKGSMQJlxXVPRhTGX8X",
    "wallows": "3dz0NnIZhtKKeXZxLOxedj",
    "the neighbourhood": "77SW9BnxLY8rJ0RciFqkHh",
    "the neighborhood": "77SW9BnxLY8rJ0RciFqkHh",
    # R&B / Soul
    "the weeknd": "1Xyo4u8uXC1ZmMpatF05PJ",
    "sza": "7tYKF4w9nC0nq9CsPZTHyP",
    "frank ocean": "2h93pZq0e7k5yf4dywlkpM",
    "beyonce": "6vWDO969PvNqNYHIOW5v0m",
    "beyoncé": "6vWDO969PvNqNYHIOW5v0m",
    "rihanna": "5pKCCKE2ajJHZ9KAiaK11H",
    "adele": "4dpARuHxo51G3z768sgnrY",
    "h.e.r": "0wVXWdpGRYDhd99tUVBHBL",
    "summer walker": "7rZSdBfNNQlMCFBPJgZJkh",
    "jhene aiko": "1l7ZsJRRS8wlW3WfJfpiUA",
    "kehlani": "3l0CmX0FuQjFxr8SK7Vqag",
    "daniel caesar": "20wkVLutqVOYrc0kxFs7rA",
    # Hip-hop / Rap
    "drake": "3TVXtAsR1Inumwj472S9r4",
    "kendrick lamar": "2YZyLoL8N0Wb9xBt1NhZWg",
    "kanye west": "5K4W6rqBFWDnAN6FQUkS6x",
    "ye": "5K4W6rqBFWDnAN6FQUkS6x",
    "j cole": "6l3HvQ5sa6mXTsMTB19rO5",
    "j. cole": "6l3HvQ5sa6mXTsMTB19rO5",
    "eminem": "7dGJo4pcD2V6oG8kP0tJRR",
    "post malone": "246dkjvS1zLTtiykXe5h60",
    "travis scott": "0Y5tJX1MQlPlqiwlOH1tJY",
    "tyler the creator": "4V8LLVI7d68svsXW0y8y9L",
    "tyler, the creator": "4V8LLVI7d68svsXW0y8y9L",
    "bad bunny": "4q3ewBCX7sLwd24euuV69X",
    "juice wrld": "4MCBfE4596Uoi2O4DtmEMz",
    "juice world": "4MCBfE4596Uoi2O4DtmEMz",
    "lil uzi vert": "4O15NlyKLIASxsJ0PrXPfg",
    "lil baby": "6vDGVr652ztNWKZzHHRKlQ",
    "future": "1RyvyyTE3xzB2ZywiAwp0i",
    "young thug": "50co4Is1HCEo8bhOyUWKpn",
    "gunna": "4r63FhuTkUYEs4YQnmcV5H",
    "21 savage": "1URnnhqYAYcrqrcwql10ft",
    "nicki minaj": "0rmVVUnFR9FRBaJ2i7K8hy",
    "cardi b": "4kYSro6naA4h99UJvo89HB",
    "lana del rey": "00FQb4jTyendYWaN8pK0wa",
    "xxxtentacion": "15UsOTVnJzReFVN1VCnxy4",
    "xxx": "15UsOTVnJzReFVN1VCnxy4",
    # Rock / Classic
    "coldplay": "4gzpq5DPGxSnKTe4SA8HAU",
    "radiohead": "4Z8W4fkeB5StFk8rqc7eGF",
    "the beatles": "3WrFJ7ztbogyGnTHbHJFl2",
    "beatles": "3WrFJ7ztbogyGnTHbHJFl2",
    "pink floyd": "0k17h0D3J5VfsdmQ1iZtE9",
    "queen": "1dfeR4HaWDbWqFHLkxsg1d",
    "led zeppelin": "36QJpDe2go2KgaRleHCDTp",
    "david bowie": "0oSGxfWSnnOXhD2fKuz2Gy",
    "fleetwood mac": "08GQAI4eElDnROBrJRGE0X",
    "the rolling stones": "22bE4uQ6baNwSHPVcDxLCe",
    "rolling stones": "22bE4uQ6baNwSHPVcDxLCe",
    "nirvana": "6olE6TJLqED3rqDCT0FyPh",
    "bruce springsteen": "3eqjTLE0HfPfh78zjh6TqT",
    "u2": "51Blml2LZPmy7TTiAg47vQ",
    # K-Pop / Global
    "bts": "3Nrfpe0tUJi4K4DXYWgMUX",
    "blackpink": "41MozSoPIsD1dJM0CLPjZF",
    "stray kids": "2p1fiYHgMpOd5rBk3ELsvk",
    "exo": "1evhSExS2RhQMaexOO1Byt",
    "nct 127": "7f4ignuCJhLXfZ9giMiyNt",
    "twice": "0JTP4RPKBXRS9aiFLAeKFH",
    "got7": "06WYLSAClbu4mYVTR3BNKL",
    "monsta x": "4LRIM9PYxJPBHEMCY7eHyX",
    # Misc popular
    "bruno mars": "0du5cEVh5yTK9QJze8zA0C",
    "justin bieber": "1uNFoZAHBGtllmzznpCI3s",
    "bieber": "1uNFoZAHBGtllmzznpCI3s",
    "lady gaga": "1HY2Jd0NmPuamShAr6KMms",
    "katy perry": "6jJ0s89eD6GaHleKKya26X",
    "p!nk": "1KCSPY1glIKqW2TotWuXOR",
    "pink": "1KCSPY1glIKqW2TotWuXOR",
    "maroon 5": "04gDigrS5kc9YWfZHwBETP",
}


def _artist_id_for_query(q: str) -> Optional[str]:
    """Return a Spotify artist ID from the hardcoded map if the query closely matches."""
    normalized = q.lower().strip()
    if normalized in _ARTIST_IDS:
        return _ARTIST_IDS[normalized]
    for name, aid in _ARTIST_IDS.items():
        if normalized in name or name in normalized:
            return aid
    return None


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@router.get("/search", response_model=List[AlbumResult])
async def search_albums(q: str = Query(..., min_length=1), db: AsyncSession = Depends(get_db)):
    import asyncio

    print(f"[search_albums] q={q!r}", flush=True)

    # Source 1: artist discography via /artists/{id}/albums — primary path.
    # Spotify /v1/search for albums requires Extended Access (blocked) and causes
    # 429s on every call. We skip it. Instead we resolve the artist from the query
    # and fetch their discography directly — works for any artist, no Extended Access needed.
    async def artist_search():
        artist_id = _artist_id_for_query(q)

        # Only hit Spotify for dynamic lookup if query is meaningful (3+ chars).
        # Short queries like "f" or "ca" are too ambiguous and waste rate limit quota.
        if not artist_id and len(q.strip()) >= 3:
            try:
                artists = await spotify.search_artists(q, limit=1)
                if artists:
                    artist_id = artists[0]["id"]
                    print(f"[search_albums] dynamic artist lookup: {artists[0]['name']} → {artist_id}", flush=True)
            except Exception as exc:
                print(f"[search_albums] dynamic artist lookup FAILED for q={q!r}: {exc}", flush=True)

        if not artist_id:
            print(f"[search_albums] no artist ID found for q={q!r}", flush=True)
            return []

        print(f"[search_albums] artist_id={artist_id} for q={q!r}", flush=True)
        try:
            results = await spotify.get_artist_albums_limited(artist_id, limit=10)
            print(f"[search_albums] artist discography: {len(results)} results for q={q!r}", flush=True)
            return results
        except Exception as exc:
            print(f"[search_albums] artist discography FAILED for q={q!r} artist_id={artist_id}: {exc}", flush=True)
            return []

    # Source 2: local AlbumCache — fast fallback for seeded albums by title.
    async def db_search():
        pattern = f"%{q}%"
        rows = (await db.execute(
            select(AlbumCacheModel)
            .where(AlbumCacheModel.name.ilike(pattern) | AlbumCacheModel.artist.ilike(pattern))
            .order_by(AlbumCacheModel.popularity.desc().nulls_last())
            .limit(10)
        )).scalars().all()
        print(f"[search_albums] db: {len(rows)} results for q={q!r}", flush=True)
        return rows

    artist_results, db_rows = await asyncio.gather(artist_search(), db_search())

    # Merge: artist discography first (most relevant when query is an artist name),
    # then DB cache for any album-title matches not covered by the discography.
    seen_ids: set[str] = set()
    merged: list = []

    for result in artist_results:
        if result["id"] not in seen_ids:
            seen_ids.add(result["id"])
            merged.append(result)

    for row in db_rows:
        if row.spotify_id not in seen_ids:
            seen_ids.add(row.spotify_id)
            merged.append(AlbumResult(
                id=row.spotify_id,
                name=row.name,
                artists=[a.strip() for a in row.artist.split(",")],
                artist_ids=[],
                release_date=row.release_date or "",
                release_date_precision=row.release_date_precision or "year",
                label=row.label,
                popularity=row.popularity,
                image_url=row.image_url,
                external_url=f"https://open.spotify.com/album/{row.spotify_id}",
            ))

    print(f"[search_albums] returning {len(merged[:15])} merged results for q={q!r}", flush=True)
    return merged[:15]


# ---------------------------------------------------------------------------
# Single album metadata + cache upsert
# ---------------------------------------------------------------------------

def _row_to_album_result(row: AlbumCacheModel) -> AlbumResult:
    return AlbumResult(
        id=row.spotify_id,
        name=row.name,
        artists=[a.strip() for a in row.artist.split(",")],
        artist_ids=[],
        release_date=row.release_date or "",
        release_date_precision=row.release_date_precision or "year",
        label=row.label,
        popularity=row.popularity,
        image_url=row.image_url,
        external_url=f"https://open.spotify.com/album/{row.spotify_id}",
    )


@router.get("/{album_id}", response_model=AlbumResult)
async def get_album(album_id: str, db: AsyncSession = Depends(get_db)):
    # Cache-first: seeded/visited albums are served instantly from DB without touching Spotify.
    # This prevents rate-limiting when multiple albums are fetched in quick succession
    # (e.g. Compare page loading Side A and Side B).
    cached = (await db.execute(
        select(AlbumCacheModel).where(AlbumCacheModel.spotify_id == album_id)
    )).scalar_one_or_none()

    if cached and cached.image_url:
        print(f"[get_album] cache hit: {album_id} ({cached.name})", flush=True)
        return _row_to_album_result(cached)

    print(f"[get_album] cache miss: {album_id} — fetching from Spotify", flush=True)
    # Not in cache yet — fetch from Spotify and store it
    try:
        meta = await spotify.get_album(album_id)
        print(f"[get_album] spotify returned: {meta.get('name')} for {album_id}", flush=True)
        await cache.upsert_album(db, meta)
        return meta
    except Exception as exc:
        print(f"[get_album] spotify FAILED for {album_id}: {exc}", flush=True)
        if cached:
            return _row_to_album_result(cached)
        raise HTTPException(status_code=404, detail=f"Album {album_id} not found")


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
