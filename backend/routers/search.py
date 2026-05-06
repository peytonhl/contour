"""Unified search endpoint — users, albums, and tracks in a single request.

Triage strategy (minimises Spotify API calls):
  1. Always search the local DB first (free, instant).
  2. If DB returns enough results (≥ DB_SUFFICIENT) for a type → skip Spotify.
  3. Queries shorter than MIN_CHARS → DB only, no Spotify.
  4. For albums: try to resolve the query to an artist ID.
       - Artist found → fetch their discography (/artists/{id}/albums, no Extended Access needed).
       - Artist not found → skip album Spotify call (query is probably a song title).
  5. For tracks: only call Spotify if no artist was resolved AND DB track results are thin.
       - This avoids burning rate limits on artist queries.
  6. Users are always DB-only — never touch Spotify.
"""

import asyncio
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlbumCache as AlbumCacheModel, TrackCache, User
from services import spotify
from routers.albums import _artist_id_for_query, _row_to_album_result, AlbumResult
from routers.tracks import _row_to_track_result, TrackResult

router = APIRouter(prefix="/search", tags=["search"])

# Minimum query length before making any Spotify call
MIN_CHARS = 3
# If DB returns at least this many results for a type, skip Spotify for that type
DB_SUFFICIENT = 3


class UserResult(BaseModel):
    id: str
    display_name: str
    image_url: Optional[str] = None
    bio: Optional[str] = None


class SearchResponse(BaseModel):
    users: List[UserResult]
    albums: List[AlbumResult]
    tracks: List[TrackResult]


@router.get("", response_model=SearchResponse)
async def unified_search(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    q_stripped = q.strip()
    pattern = f"%{q_stripped}%"

    # ── Step 1: DB searches — always run, always free ─────────────────────────

    async def db_users():
        rows = (await db.execute(
            select(User)
            .where(User.display_name.ilike(pattern))
            .order_by(User.display_name)
            .limit(5)
        )).scalars().all()
        return [
            UserResult(id=u.id, display_name=u.display_name, image_url=u.image_url, bio=u.bio)
            for u in rows
        ]

    async def db_albums():
        rows = (await db.execute(
            select(AlbumCacheModel)
            .where(AlbumCacheModel.name.ilike(pattern) | AlbumCacheModel.artist.ilike(pattern))
            .order_by(AlbumCacheModel.popularity.desc().nulls_last())
            .limit(10)
        )).scalars().all()
        return rows

    async def db_tracks():
        rows = (await db.execute(
            select(TrackCache)
            .where(TrackCache.name.ilike(pattern) | TrackCache.artist.ilike(pattern))
            .order_by(TrackCache.popularity.desc().nulls_last())
            .limit(10)
        )).scalars().all()
        return rows

    db_user_results, db_album_rows, db_track_rows = await asyncio.gather(
        db_users(), db_albums(), db_tracks()
    )

    # ── Step 2: Triage — decide which Spotify calls to make ───────────────────

    spotify_albums: list = []
    spotify_tracks: list = []

    if len(q_stripped) >= MIN_CHARS:
        need_albums = len(db_album_rows) < DB_SUFFICIENT
        need_tracks = len(db_track_rows) < DB_SUFFICIENT

        if need_albums or need_tracks:
            # Try to resolve query to an artist ID (hardcoded map first, then live lookup)
            artist_id = _artist_id_for_query(q_stripped)

            if not artist_id:
                try:
                    artists = await spotify.search_artists(q_stripped, limit=1)
                    if artists:
                        artist_id = artists[0]["id"]
                        print(f"[search] dynamic artist: {artists[0]['name']} → {artist_id}", flush=True)
                except Exception as exc:
                    print(f"[search] artist lookup failed for q={q_stripped!r}: {exc}", flush=True)

            if artist_id and need_albums:
                # Query is an artist name → fetch their discography
                try:
                    spotify_albums = await spotify.get_artist_albums_limited(artist_id, limit=10)
                except Exception as exc:
                    print(f"[search] discography failed for artist_id={artist_id}: {exc}", flush=True)

            elif not artist_id and need_tracks:
                # Query doesn't resolve to an artist → probably a song/album title
                # Only call track search; skip album search entirely
                try:
                    spotify_tracks = await spotify.search_tracks(q_stripped, limit=10)
                except Exception as exc:
                    print(f"[search] track search failed for q={q_stripped!r}: {exc}", flush=True)

    # ── Step 3: Merge, deduplicate, return ────────────────────────────────────

    seen_album_ids: set[str] = set()
    albums: list[AlbumResult] = []

    for a in spotify_albums:
        if a["id"] not in seen_album_ids:
            seen_album_ids.add(a["id"])
            albums.append(AlbumResult(
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

    for row in db_album_rows:
        if row.spotify_id not in seen_album_ids:
            seen_album_ids.add(row.spotify_id)
            albums.append(_row_to_album_result(row))

    seen_track_ids: set[str] = set()
    tracks: list[TrackResult] = []

    for t in spotify_tracks:
        if t["id"] not in seen_track_ids:
            seen_track_ids.add(t["id"])
            tracks.append(TrackResult(
                id=t["id"],
                name=t["name"],
                artists=t.get("artists", []),
                artist_ids=t.get("artist_ids", []),
                album_name=t.get("album_name", ""),
                album_id=t.get("album_id"),
                release_date=t.get("release_date", ""),
                duration_ms=t.get("duration_ms"),
                popularity=t.get("popularity"),
                explicit=t.get("explicit", False),
                image_url=t.get("image_url"),
                external_url=t.get("external_url"),
            ))

    for row in db_track_rows:
        if row.spotify_id not in seen_track_ids:
            seen_track_ids.add(row.spotify_id)
            tracks.append(_row_to_track_result(row))

    return SearchResponse(
        users=db_user_results,
        albums=albums[:10],
        tracks=tracks[:8],
    )
