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

_ALBUM_SEARCH_MIN_CHARS = 3
_ALBUM_SEARCH_DB_SUFFICIENT = 3


async def _persist_album_search_results(albums: list[dict]) -> None:
    """Background-write Spotify album hits into AlbumCache.

    Same idempotent pattern as routers.search._persist_albums but inlined here
    so /albums/search can be used independently. Uses its own session because
    the request session is closed by the time background tasks run.
    """
    if not albums:
        return
    from database import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as session:
            for a in albums:
                existing = (await session.execute(
                    select(AlbumCacheModel).where(AlbumCacheModel.spotify_id == a["id"])
                )).scalar_one_or_none()
                if existing is None:
                    primary_artist = a.get("artists", [""])[0] if a.get("artists") else ""
                    session.add(AlbumCacheModel(
                        spotify_id=a["id"],
                        name=a["name"],
                        artist=primary_artist,
                        release_date=a.get("release_date"),
                        release_date_precision=a.get("release_date_precision"),
                        popularity=a.get("popularity"),
                        image_url=a.get("image_url"),
                        enrichment_status="pending",
                    ))
            await session.commit()
    except Exception as exc:
        logger.warning("[albums.search] persist failed: %s", exc)


@router.get("/search", response_model=List[AlbumResult])
async def search_albums(
    q: str = Query(..., min_length=1),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
):
    """Album-focused search: DB-first, Spotify title-fallback.

    Mirrors the triage in routers/search.py but skips artist resolution
    entirely — every Spotify hit goes through /search?type=album. This avoids
    the "wrong-artist shadows the popular album" failure mode that affects
    the unified endpoint for queries like "utopia", "renaissance", "yeezus",
    where Spotify returns an obscure same-named band and its (often empty)
    discography hides the album the user actually meant.

    Powers the pinned-albums picker on the profile page. The global search
    bar still uses /search (which needs to mix users / albums / tracks).
    """
    q_stripped = q.strip()
    pattern = f"%{q_stripped}%"

    db_rows = (await db.execute(
        select(AlbumCacheModel)
        .where(AlbumCacheModel.name.ilike(pattern) | AlbumCacheModel.artist.ilike(pattern))
        .order_by(AlbumCacheModel.popularity.desc().nulls_last())
        .limit(10)
    )).scalars().all()

    # If DB returns enough, skip Spotify entirely — same DB_SUFFICIENT gate
    # the unified search uses.
    spotify_albums: list = []
    if len(q_stripped) >= _ALBUM_SEARCH_MIN_CHARS and len(db_rows) < _ALBUM_SEARCH_DB_SUFFICIENT:
        try:
            spotify_albums = await spotify.search_albums(q_stripped, limit=10)
        except Exception:
            spotify_albums = []
        if spotify_albums:
            background_tasks.add_task(_persist_album_search_results, spotify_albums)

    seen_ids: set[str] = set()
    merged: list = []

    # Spotify results first — they're the freshest signal for popular albums
    # and the reason this endpoint exists.
    for a in spotify_albums:
        if a["id"] in seen_ids:
            continue
        seen_ids.add(a["id"])
        merged.append(AlbumResult(
            id=a["id"],
            name=a["name"],
            artists=a.get("artists", []),
            artist_ids=a.get("artist_ids", []),
            release_date=a.get("release_date", ""),
            release_date_precision=a.get("release_date_precision", "year"),
            label=a.get("label"),
            popularity=a.get("popularity"),
            image_url=a.get("image_url"),
            external_url=a.get("external_url"),
        ))

    for row in db_rows:
        if row.spotify_id in seen_ids:
            continue
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
        logger.debug("[get_album] cache hit: %s (%s)", album_id, cached.name)
        return _row_to_album_result(cached)

    logger.info("[get_album] cache miss: %s — fetching from Spotify", album_id)
    # Not in cache yet — fetch from Spotify and store it
    try:
        meta = await spotify.get_album(album_id)
        logger.info("[get_album] spotify returned: %s for %s", meta.get('name'), album_id)
        await cache.upsert_album(db, meta)
        return meta
    except Exception as exc:
        logger.warning("[get_album] spotify FAILED for %s: %s", album_id, exc)
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
        background_tasks.add_task(_enrich_album, album_id, meta)

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
                background_tasks.add_task(_enrich_album, album_id, meta)
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
        background_tasks.add_task(_enrich_album, album_id, meta)

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

async def _enrich_album(album_id: str, meta: dict) -> None:
    """
    Fetch play count for an album, then cache result.

    Opens its own AsyncSessionLocal — must not accept a request-scoped session.
    FastAPI tears down `Depends(get_db)` sessions when the request finishes,
    which is *before* a BackgroundTask runs. Writing through a request session
    here would crash on the first execute() and the row would stay "pending"
    forever (see `_persist_album_search_results` for the same pattern).

    Strategy (in priority order):
      1. Kworb artist albums page — most accurate (Spotify streams), but only
         works when the server's IP isn't blocked by Kworb.
      2. Last.fm album.getInfo — reliable REST API, returns lifetime scrobbles.
         Slightly different scale than Spotify streams but suitable for ranking
         and era-adjustment comparisons.
      3. For multi-artist albums: try each credited artist for Kworb, not just
         the first. The first artist isn't always the one with the primary
         Kworb page entry — e.g. a collab where the second-listed artist has
         the better Kworb data.
    """
    import logging as _logging
    from database import AsyncSessionLocal
    _log = _logging.getLogger(__name__)

    artist_ids = meta.get("artist_ids", [])
    artists = meta.get("artists", [])
    name = meta.get("name", "")
    streams: int | None = None
    source: str = "none"

    # 1. Kworb — try each credited artist in order until one returns a hit.
    #    For collab / feature-heavy albums (think Donda with its many credited
    #    artists, or Travis Scott's UTOPIA), the first-listed artist might
    #    not be the one whose Kworb page indexes this album well.
    for aid in (artist_ids or [])[:3]:  # cap at 3 to keep latency bounded
        try:
            streams = await kworb.get_album_streams(aid, name)
        except Exception as exc:
            _log.warning("enrichment: kworb threw for %s/%s — %s", aid, name, exc)
            streams = None
        if streams:
            source = "kworb"
            _log.info("enrichment: kworb  %s (via artist %s) — %s", name, aid, f"{streams:,}")
            break

    # 2. Last.fm fallback — same multi-artist treatment.
    if streams is None and artists:
        from services import lastfm
        for artist in artists[:3]:
            try:
                streams = await lastfm.get_album_playcount(artist, name)
            except Exception as exc:
                _log.warning("enrichment: lastfm threw for %s/%s — %s", artist, name, exc)
                streams = None
            if streams:
                source = "lastfm"
                _log.info("enrichment: lastfm %s (via artist %s) — %s plays", name, artist, f"{streams:,}")
                break

    if streams is None:
        _log.warning(
            "enrichment: FAILED %s — artists=%s artist_ids=%s (both Kworb and Last.fm returned nothing)",
            name, artists, artist_ids,
        )

    try:
        async with AsyncSessionLocal() as db:
            await cache.save_kworb_streams(db, album_id, streams)
    except Exception as exc:
        _log.warning("enrichment: DB write failed for %s — %s", album_id, exc)
