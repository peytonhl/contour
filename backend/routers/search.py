"""Unified search endpoint — users, albums, and tracks in a single request.

Triage strategy (minimises Spotify API calls):
  1. Always search the local DB first (free, instant).
  2. If DB returns enough results (≥ DB_SUFFICIENT) for a type → skip Spotify.
  3. Queries shorter than MIN_CHARS → DB only, no Spotify.
  4. Multi-word queries (e.g. "cardigan don toliver") → track search only, no artist
     resolution. Multi-word strings are almost never pure artist names, and attempting
     artist lookup would risk a discography fetch (429-heavy endpoint).
  5. Single-word queries → try to resolve to an artist ID first.
       - Artist found → check ArtistCache freshness (24-hour window).
       - If stale or never fetched → re-fetch discography from Spotify synchronously
         so the user sees new releases immediately, then persist in background.
       - If fresh → serve DB results with no Spotify call.
       - Artist not found → track search instead.
  6. Users are always DB-only — never touch Spotify.
  7. On any 429 / network error → silently return whatever DB has.

Permanent enrichment:
  Every successful Spotify response is written to AlbumCache / TrackCache as a
  background task. ArtistCache records when each artist's discography was last
  fetched so we refresh at most once per day.
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import List, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, AsyncSessionLocal
from models import AlbumCache as AlbumCacheModel, ArtistCache, SearchEvent, TrackCache, User
from routers.auth import optional_user_id
from services import spotify
from routers.albums import _artist_id_for_query, _row_to_album_result, AlbumResult
from routers.tracks import _row_to_track_result, TrackResult

router = APIRouter(prefix="/search", tags=["search"])

# Minimum query length before making any Spotify call
MIN_CHARS = 3
# If DB returns at least this many results for a type, skip Spotify for that type
DB_SUFFICIENT = 3
# Re-fetch an artist's discography if it hasn't been refreshed within this window
DISCOGRAPHY_TTL = timedelta(hours=24)


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
# Always called after the response is sent — never blocks the user.
# Uses its own session (the request session is closed by then).

async def _persist_albums(albums: list[dict]) -> None:
    """Upsert Spotify album results into AlbumCache (insert only — no overwrite)."""
    if not albums:
        return
    try:
        async with AsyncSessionLocal() as session:
            new_count = 0
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
                    new_count += 1
            await session.commit()
            if new_count:
                logger.info("[search] persisted %d new albums to DB", new_count)
    except Exception as exc:
        logger.warning("[search] album persist failed: %s", exc)


async def _persist_tracks(tracks: list[dict]) -> None:
    """Upsert Spotify track results into TrackCache (insert only — no overwrite)."""
    if not tracks:
        return
    try:
        async with AsyncSessionLocal() as session:
            new_count = 0
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
                    new_count += 1
            await session.commit()
            if new_count:
                logger.info("[search] persisted %d new tracks to DB", new_count)
    except Exception as exc:
        logger.warning("[search] track persist failed: %s", exc)


async def _persist_discography(artist_id: str, artist_name: str, albums: list[dict]) -> None:
    """Persist discography albums and stamp ArtistCache with current timestamp."""
    await _persist_albums(albums)
    try:
        async with AsyncSessionLocal() as session:
            row = (await session.execute(
                select(ArtistCache).where(ArtistCache.spotify_id == artist_id)
            )).scalar_one_or_none()
            if row:
                row.discography_fetched_at = datetime.utcnow()
                if artist_name:
                    row.name = artist_name
            else:
                session.add(ArtistCache(
                    spotify_id=artist_id,
                    name=artist_name or artist_id,
                    discography_fetched_at=datetime.utcnow(),
                ))
            await session.commit()
            logger.info("[search] artist_cache updated: %s", artist_name or artist_id)
    except Exception as exc:
        logger.warning("[search] artist_cache update failed: %s", exc)


# ── Endpoint ──────────────────────────────────────────────────────────────────

async def _log_search_event(q_norm: str, user_id: Optional[str]) -> None:
    """Persist a search event in its own session so it never breaks the response.

    Runs as a background task because the request-scoped session may be closed
    by the time the queue gets to it. Failures here are silently swallowed —
    trending searches is a nice-to-have surface, not a critical path.
    """
    try:
        async with AsyncSessionLocal() as ev_db:
            ev_db.add(SearchEvent(query=q_norm, user_id=user_id))
            await ev_db.commit()
    except Exception:
        logger.debug("search event log failed (non-fatal)", exc_info=False)


@router.get("", response_model=SearchResponse)
async def unified_search(
    q: str = Query(..., min_length=1),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    q_stripped = q.strip()
    pattern = f"%{q_stripped}%"

    # Log search events for queries that look like real intent (≥ MIN_CHARS).
    # Powers the /trending/searched endpoint. Capped length protects the index.
    q_norm = q_stripped.lower()[:128]
    if len(q_norm) >= MIN_CHARS:
        background_tasks.add_task(_log_search_event, q_norm, user_id)

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
            words = q_stripped.split()
            query_is_multiword = len(words) > 1

            if query_is_multiword:
                # Multi-word → straight to title search for albums + tracks, no
                # artist resolution (avoids the 429-heavy discography endpoint).
                if need_albums:
                    try:
                        spotify_albums = await spotify.search_albums(q_stripped, limit=10)
                    except Exception:
                        pass
                if need_tracks:
                    try:
                        spotify_tracks = await spotify.search_tracks(q_stripped, limit=10)
                    except Exception:
                        pass
            else:
                # Single-word → try to resolve to an artist for discography.
                artist_id = _artist_id_for_query(q_stripped)
                artist_name_hint = ""

                if not artist_id:
                    try:
                        artists = await spotify.search_artists(q_stripped, limit=1)
                        if artists:
                            matched_name = artists[0]["name"].lower()
                            name_words = matched_name.split()
                            q_lower = q_stripped.lower()
                            if any(w in q_lower for w in name_words if len(w) > 3):
                                artist_id = artists[0]["id"]
                                artist_name_hint = artists[0]["name"]
                                logger.info("[search] dynamic artist: %s → %s", artists[0]['name'], artist_id)
                            else:
                                logger.debug("[search] dynamic artist rejected: '%s' not in '%s'", artists[0]['name'], q_stripped)
                    except Exception:
                        pass

                if artist_id:
                    # Check freshness — re-fetch if not refreshed within 24 hours
                    artist_row = (await db.execute(
                        select(ArtistCache).where(ArtistCache.spotify_id == artist_id)
                    )).scalar_one_or_none()

                    data_is_stale = (
                        artist_row is None
                        or artist_row.discography_fetched_at is None
                        or (datetime.utcnow() - artist_row.discography_fetched_at) > DISCOGRAPHY_TTL
                    )

                    if data_is_stale or need_albums:
                        # Fetch synchronously so user sees new releases immediately.
                        # Falls back to DB silently if Spotify 429s.
                        try:
                            fresh = await spotify.get_artist_albums_limited(artist_id, limit=20)
                            if fresh:
                                spotify_albums = fresh
                                name = artist_name_hint or (artist_row.name if artist_row else "")
                                background_tasks.add_task(_persist_discography, artist_id, name, fresh)
                        except Exception:
                            pass

                else:
                    # No artist match → treat the query as a title and search
                    # both albums and tracks. Previously this branch only
                    # searched tracks, which broke single-word album titles
                    # like "donda" or "lemonade" (no Spotify artist match →
                    # zero albums returned).
                    if need_albums:
                        try:
                            spotify_albums = await spotify.search_albums(q_stripped, limit=10)
                        except Exception:
                            pass
                    if need_tracks:
                        try:
                            spotify_tracks = await spotify.search_tracks(q_stripped, limit=10)
                        except Exception:
                            pass

    # ── Step 2b: Persist search results to DB (background) ───────────────────
    # Albums fetched via the title-search fallback aren't covered by
    # _persist_discography (which only runs for confirmed artist matches), so
    # we persist them here too — otherwise the same query would re-hit Spotify
    # forever instead of falling into the DB-only fast path on subsequent calls.
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
