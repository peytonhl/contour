"""Unified search endpoint — users, albums, and tracks in a single request.

Triage strategy (minimises Spotify API calls):
  1. Always search the local DB first (free, instant).
  2. If DB returns enough results (≥ DB_SUFFICIENT) for a type → skip Spotify.
  3. Queries shorter than MIN_CHARS → DB only, no Spotify.
  4. Multi-word queries (e.g. "cardigan don toliver") → track search only, no artist
     resolution. Multi-word strings are almost never pure artist names, and attempting
     artist lookup would risk a discography fetch (429-heavy endpoint).
  5. Single-word queries → try to resolve to an artist ID first.
       - Artist found (name validated against query) → fetch discography.
       - Artist not found / rejected → track search instead.
  6. Users are always DB-only — never touch Spotify.
  7. On any 429 / network error → silently return whatever DB has.

Permanent enrichment:
  Every successful Spotify response (albums or tracks) is written to the DB as a
  background task. Future searches find those results in DB for free — no Spotify
  call needed, no Redis TTL to worry about.
"""

import asyncio
import json
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, AsyncSessionLocal
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


# ── Background DB persistence ─────────────────────────────────────────────────
# Called after the response is sent — never blocks the user.
# Uses its own session (the request session is already closed by then).

async def _persist_albums(albums: list[dict]) -> None:
    """Upsert Spotify album results into AlbumCache for permanent DB enrichment."""
    if not albums:
        return
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
            print(f"[search] persisted {len(albums)} albums to DB cache", flush=True)
    except Exception as exc:
        print(f"[search] album persist failed: {exc}", flush=True)


async def _persist_tracks(tracks: list[dict]) -> None:
    """Upsert Spotify track results into TrackCache for permanent DB enrichment."""
    if not tracks:
        return
    try:
        async with AsyncSessionLocal() as session:
            for t in tracks:
                existing = (await session.execute(
                    select(TrackCache).where(TrackCache.spotify_id == t["id"])
                )).scalar_one_or_none()
                if existing is None:
                    primary_artist = t.get("artists", [""])[0] if t.get("artists") else ""
                    session.add(TrackCache(
                        spotify_id=t["id"],
                        name=t["name"],
                        artist=primary_artist,
                        album_name=t.get("album_name"),
                        album_id=t.get("album_id"),
                        release_date=t.get("release_date"),
                        duration_ms=t.get("duration_ms"),
                        explicit=t.get("explicit", False),
                        popularity=t.get("popularity"),
                        image_url=t.get("image_url"),
                        external_url=t.get("external_url"),
                        artist_ids_json=json.dumps(t.get("artist_ids", [])),
                    ))
            await session.commit()
            print(f"[search] persisted {len(tracks)} tracks to DB cache", flush=True)
    except Exception as exc:
        print(f"[search] track persist failed: {exc}", flush=True)


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("", response_model=SearchResponse)
async def unified_search(
    q: str = Query(..., min_length=1),
    background_tasks: BackgroundTasks = BackgroundTasks(),
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
    # Rule: only hit Spotify if DB results are thin AND query is long enough.
    # On 429, silently fall back to DB results — never surface an error to the user.

    spotify_albums: list = []
    spotify_tracks: list = []

    if len(q_stripped) >= MIN_CHARS:
        need_albums = len(db_album_rows) < DB_SUFFICIENT
        need_tracks = len(db_track_rows) < DB_SUFFICIENT

        if need_albums or need_tracks:
            words = q_stripped.split()
            query_is_multiword = len(words) > 1

            if query_is_multiword:
                # Multi-word query (e.g. "cardigan don toliver", "love sick") —
                # skip artist lookup entirely. These are almost never pure artist
                # names; treating them as song/album searches avoids wasting a
                # Spotify call on artist resolution that then triggers a discography
                # fetch (the 429-heavy endpoint).
                if need_tracks:
                    try:
                        spotify_tracks = await spotify.search_tracks(q_stripped, limit=10)
                    except Exception:
                        pass
            else:
                # Single-word query — try to resolve to an artist for discography.
                artist_id = _artist_id_for_query(q_stripped)

                if not artist_id:
                    try:
                        artists = await spotify.search_artists(q_stripped, limit=1)
                        if artists:
                            matched_name = artists[0]["name"].lower()
                            name_words = matched_name.split()
                            q_lower = q_stripped.lower()
                            # Validate: at least one meaningful word from the matched
                            # artist name must appear in the query to avoid false matches.
                            if any(w in q_lower for w in name_words if len(w) > 3):
                                artist_id = artists[0]["id"]
                                print(f"[search] dynamic artist: {artists[0]['name']} → {artist_id}", flush=True)
                            else:
                                print(f"[search] dynamic artist rejected: '{artists[0]['name']}' not in '{q_stripped}'", flush=True)
                    except Exception:
                        # 429 or network error — fall through to DB-only results silently
                        pass

                if artist_id and need_albums:
                    try:
                        spotify_albums = await spotify.get_artist_albums_limited(artist_id, limit=10)
                    except Exception:
                        pass
                elif need_tracks:
                    # No artist match on single-word query → treat as track/album title
                    try:
                        spotify_tracks = await spotify.search_tracks(q_stripped, limit=10)
                    except Exception:
                        pass

    # ── Step 2b: Persist new Spotify results to DB (background, non-blocking) ──
    if spotify_albums:
        background_tasks.add_task(_persist_albums, spotify_albums)
    if spotify_tracks:
        background_tasks.add_task(_persist_tracks, spotify_tracks)

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
