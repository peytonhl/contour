"""Apple Music deep-link resolution router.

GET /apple-music/match/{entity_type}/{spotify_id} — returns the cached or
freshly-matched Apple Music ID + deep link for a Spotify album or track.

Returns 404 when:
  - Apple Music developer token env vars are unset (service disabled), or
  - no match exists in cache AND on-demand matching turned up nothing.

The frontend uses the 404 as a signal to hide the "Play on Apple Music" button.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlbumCache, AppleMusicLink, TrackCache
from services import apple_music, spotify
from services.observability import log_silent_error

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apple-music", tags=["apple-music"])


@router.get("/debug")
async def debug():
    """Diagnostic endpoint — surfaces enough state to figure out why matching
    might be failing without exposing the full private key. Safe to leave on;
    everything returned is presence/length info, no secrets."""
    import os
    pk = os.environ.get("APPLE_MUSIC_PRIVATE_KEY") or ""
    info = {
        "is_configured": apple_music.is_configured(),
        "env": {
            "team_id_value": os.environ.get("APPLE_MUSIC_TEAM_ID"),
            "key_id_value": os.environ.get("APPLE_MUSIC_KEY_ID"),
            "private_key_length": len(pk),
            "private_key_first_30": pk[:30],
            "private_key_last_30": pk[-30:],
            "has_actual_newlines": "\n" in pk,
            "has_escaped_newlines": "\\n" in pk,
            "starts_with_dashes_begin": pk.lstrip().startswith("-----BEGIN"),
        },
    }
    # Try to mint a token
    try:
        token = apple_music._get_dev_token()
        info["token_minted"] = True
        info["token_first_40"] = token[:40] + "..."
    except Exception as e:
        info["token_minted"] = False
        info["token_error"] = f"{type(e).__name__}: {e}"
        return info

    # Try a real search call against Apple
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{apple_music.APPLE_MUSIC_API_BASE}/catalog/us/search",
                headers={"Authorization": f"Bearer {token}"},
                params={"term": "folklore taylor swift", "types": "albums", "limit": 1},
            )
            info["apple_test_status"] = resp.status_code
            info["apple_test_body_first_200"] = resp.text[:200]
    except Exception as e:
        info["apple_test_error"] = f"{type(e).__name__}: {e}"
    return info


async def _cached_link(
    db: AsyncSession, spotify_id: str, entity_type: str, storefront: str
) -> Optional[AppleMusicLink]:
    result = await db.execute(
        select(AppleMusicLink).where(
            AppleMusicLink.spotify_id == spotify_id,
            AppleMusicLink.entity_type == entity_type,
            AppleMusicLink.storefront == storefront,
        )
    )
    return result.scalar_one_or_none()


async def _persist_apple_release_date(
    db: AsyncSession, spotify_id: str, entity_type: str, release_date: Optional[str]
) -> None:
    """Side-channel write: stash Apple's releaseDate on the entity's cache row.

    Apple's date is generally more accurate than Spotify's catalog-upload
    date for vintage music (Spotify often shows the remaster reissue year,
    Apple preserves the original). The discover decade ranker prefers
    original_release_date when populated. Failure here is non-fatal — if
    we can't write it, the ranker just falls back to Spotify's date, which
    is the prior behavior. No-op when the date isn't present in the Apple
    response (it usually is, but some compilations omit it).
    """
    if not release_date:
        return
    try:
        if entity_type == "track":
            row = (await db.execute(
                select(TrackCache).where(TrackCache.spotify_id == spotify_id)
            )).scalar_one_or_none()
            if row and row.original_release_date != release_date:
                row.original_release_date = release_date
                await db.commit()
        elif entity_type == "album":
            row = (await db.execute(
                select(AlbumCache).where(AlbumCache.spotify_id == spotify_id)
            )).scalar_one_or_none()
            if row and row.original_release_date != release_date:
                row.original_release_date = release_date
                await db.commit()
    except Exception as exc:
        logger.warning(
            "apple_music original_release_date persist failed for %s/%s: %s",
            entity_type, spotify_id, exc,
        )


async def _persist(
    db: AsyncSession,
    spotify_id: str,
    entity_type: str,
    storefront: str,
    apple_music_id: Optional[str],
    match_method: str,
    artwork_url: Optional[str] = None,
) -> AppleMusicLink:
    row = AppleMusicLink(
        spotify_id=spotify_id,
        entity_type=entity_type,
        storefront=storefront,
        apple_music_id=apple_music_id,
        artwork_url=artwork_url,
        match_method=match_method,
        matched_at=datetime.utcnow(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/match/{entity_type}/{spotify_id}")
async def match_entity(
    entity_type: str,
    spotify_id: str,
    storefront: str = Query("us"),
    force: bool = Query(False, description="Bypass cache and re-attempt matching"),
    # Fallback hints for entities whose ID isn't a Spotify ID (e.g. tracks
    # surfaced in the For You feed from Deezer — see services/deezer.py).
    # When DB + Spotify lookups fail to resolve the entity's name/artist,
    # the matcher uses these instead so a text search can still succeed.
    # Optional and unused for Spotify-keyed entities (the DB cache covers
    # those cleanly).
    hint_name: Optional[str] = Query(None, description="Track/album name hint when ID is non-Spotify"),
    hint_artist: Optional[str] = Query(None, description="Artist name hint when ID is non-Spotify"),
    db: AsyncSession = Depends(get_db),
):
    if entity_type not in ("album", "track"):
        raise HTTPException(status_code=400, detail="entity_type must be 'album' or 'track'")

    if not force:
        cached = await _cached_link(db, spotify_id, entity_type, storefront)
        if cached and cached.apple_music_id:
            # Lazy backfill for rows that predate the artwork_url and/or
            # original_release_date columns. Same Apple API call covers
            # both fields — extract them together, persist whichever is
            # missing. One round-trip per backfilled entity, then free
            # DB reads forever after. Backfill failures are swallowed so
            # a transient Apple outage never blocks the deep-link
            # response (the button stays usable; the missing data just
            # waits for the next try).
            artwork_url = cached.artwork_url
            needs_artwork = not artwork_url

            # Check the entity's cache row for missing original_release_date.
            # This is the same row the discover decade ranker reads, so it
            # has to be on TrackCache / AlbumCache, not AppleMusicLink.
            entity_row = None
            needs_release_date = False
            if entity_type == "track":
                entity_row = (await db.execute(
                    select(TrackCache).where(TrackCache.spotify_id == spotify_id)
                )).scalar_one_or_none()
            elif entity_type == "album":
                entity_row = (await db.execute(
                    select(AlbumCache).where(AlbumCache.spotify_id == spotify_id)
                )).scalar_one_or_none()
            if entity_row is not None and entity_row.original_release_date is None:
                needs_release_date = True

            if (needs_artwork or needs_release_date) and apple_music.is_configured():
                try:
                    meta = await apple_music.fetch_meta_for_id(
                        cached.apple_music_id, entity_type, storefront,
                    )
                    if meta:
                        wrote = False
                        if needs_artwork and meta.get("artwork_url"):
                            artwork_url = meta["artwork_url"]
                            cached.artwork_url = artwork_url
                            wrote = True
                        if needs_release_date and meta.get("release_date") and entity_row is not None:
                            entity_row.original_release_date = meta["release_date"]
                            wrote = True
                        if wrote:
                            await db.commit()
                except Exception as exc:
                    logger.warning(
                        "apple_music lazy backfill failed for %s/%s: %s",
                        entity_type, spotify_id, exc,
                    )
            return {
                "spotify_id": spotify_id,
                "entity_type": entity_type,
                "apple_music_id": cached.apple_music_id,
                "url": apple_music.deep_link(entity_type, cached.apple_music_id, storefront),
                "artwork_url": artwork_url,
                "storefront": storefront,
                "match_method": cached.match_method,
                "cached": True,
            }
        # Note: negative cache rows are no longer respected — we only cache
        # positive matches. A null row from older code is ignored, and the
        # migration that ships with this change deletes them.

    if not apple_music.is_configured():
        raise HTTPException(status_code=404, detail="Apple Music not configured")

    # Cold cache + service enabled → try matching now.
    apple_music_id: Optional[str] = None
    match_method = "none"
    artwork_url: Optional[str] = None
    # Apple's releaseDate from whichever match path succeeds. Side-channel
    # persisted to TrackCache.original_release_date / AlbumCache.original_release_date
    # below — see _persist_apple_release_date for rationale.
    apple_release_date: Optional[str] = None

    try:
        if entity_type == "track":
            track_meta = await _get_track_meta(spotify_id, db)
            # Fold in caller-provided hints when DB+Spotify failed to resolve
            # the entity (Deezer-keyed For You feed tracks land here). The
            # hints fill in name/artist so the text-search path can succeed
            # even though no ISRC is available.
            if not track_meta.get("name") and hint_name:
                track_meta["name"] = hint_name
            if not (track_meta.get("artists") or []) and hint_artist:
                track_meta["artists"] = [hint_artist]
            isrc = track_meta.get("isrc")
            if isrc:
                match = await apple_music.match_track_by_isrc(isrc, storefront)
                if match and match.get("track_id"):
                    apple_music_id = match["track_id"]
                    artwork_url = match.get("artwork_url")
                    apple_release_date = match.get("release_date")
                    match_method = "isrc"
            if not apple_music_id and track_meta.get("name"):
                search = await apple_music.search_by_text(
                    name=track_meta.get("name", ""),
                    artist=(track_meta.get("artists") or [""])[0],
                    entity_type="track",
                    storefront=storefront,
                )
                if search and search.get("id"):
                    apple_music_id = search["id"]
                    artwork_url = search.get("artwork_url")
                    apple_release_date = search.get("release_date")
                    match_method = "text"
        else:  # album
            album_data = await _get_album_meta(spotify_id, db)
            if not album_data.get("name") and hint_name:
                album_data["name"] = hint_name
            if not (album_data.get("artists") or []) and hint_artist:
                album_data["artists"] = [hint_artist]
            isrc = album_data.get("first_track_isrc")
            if isrc:
                match = await apple_music.match_track_by_isrc(isrc, storefront)
                if match and match.get("album_id"):
                    apple_music_id = match["album_id"]
                    # The ISRC search hits /songs; song artwork == album cover
                    # on Apple Music, so we get the right image for free.
                    artwork_url = match.get("artwork_url")
                    apple_release_date = match.get("release_date")
                    match_method = "isrc"
            if not apple_music_id and album_data.get("name"):
                search = await apple_music.search_by_text(
                    name=album_data.get("name", ""),
                    artist=(album_data.get("artists") or [""])[0],
                    entity_type="album",
                    storefront=storefront,
                )
                if search and search.get("id"):
                    apple_music_id = search["id"]
                    artwork_url = search.get("artwork_url")
                    apple_release_date = search.get("release_date")
                    match_method = "text"
    except Exception as exc:
        logger.warning("apple_music match failed for %s/%s: %s", entity_type, spotify_id, exc)

    # Only persist positive matches. Negative results stay un-cached so a
    # transient Apple API failure (auth glitch during deploy, rate limit,
    # whatever) doesn't permanently hide the button. Match cost is one
    # Apple API call per page view of an unmatched entity — acceptable.
    if apple_music_id:
        # If a (legacy) negative row exists for this entity, replace it.
        existing = await _cached_link(db, spotify_id, entity_type, storefront)
        if existing is not None:
            existing.apple_music_id = apple_music_id
            existing.artwork_url = artwork_url
            existing.match_method = match_method
            existing.matched_at = datetime.utcnow()
            await db.commit()
        else:
            await _persist(
                db, spotify_id, entity_type, storefront,
                apple_music_id, match_method, artwork_url,
            )
        # Side-channel: store Apple's releaseDate on the entity's cache row
        # so the discover decade ranker can prefer it over Spotify's
        # (less-accurate-for-vintage) date.
        await _persist_apple_release_date(db, spotify_id, entity_type, apple_release_date)
    else:
        raise HTTPException(status_code=404, detail="No Apple Music match")

    return {
        "spotify_id": spotify_id,
        "entity_type": entity_type,
        "apple_music_id": apple_music_id,
        "url": apple_music.deep_link(entity_type, apple_music_id, storefront),
        "artwork_url": artwork_url,
        "storefront": storefront,
        "match_method": match_method,
        "cached": False,
    }


async def _get_album_meta(spotify_album_id: str, db: AsyncSession) -> dict:
    """Best-effort album metadata for Apple Music matching.

    Name + artist come from AlbumCache (DB) first — that table is populated
    whenever an album page is viewed and survives Spotify rate limits /
    circuit breaker. Live Spotify is consulted only to fill gaps and to
    attempt an ISRC lookup; any Spotify failure is swallowed. The matcher
    can still fall back to a text search using just the cached name +
    artist when Spotify is down.
    """
    name: Optional[str] = None
    artist: Optional[str] = None
    isrc: Optional[str] = None

    # 1. DB cache (survives Spotify outages)
    cached = (await db.execute(
        select(AlbumCache).where(AlbumCache.spotify_id == spotify_album_id)
    )).scalar_one_or_none()
    if cached:
        name = cached.name
        artist = cached.artist

    # 2. Live Spotify (best-effort fill + ISRC fetch)
    try:
        album = await spotify.get_album(spotify_album_id)
        if album:
            if not name:
                name = album.get("name")
            if not artist:
                artist = (album.get("artists") or [""])[0]
        try:
            tracklist = await spotify.get_album_tracks(spotify_album_id)
            if tracklist:
                first_id = tracklist[0].get("id")
                if first_id:
                    track = await spotify.get_track(first_id)
                    isrc = track.get("isrc")
        except Exception as e:
            log_silent_error("apple_music_album_meta_tracklist_fetch", e,
                             spotify_album_id=spotify_album_id)
    except Exception as e:
        log_silent_error("apple_music_album_meta_album_fetch", e,
                         spotify_album_id=spotify_album_id)

    return {
        "name": name,
        "artists": [artist] if artist else [],
        "first_track_isrc": isrc,
    }


async def _get_track_meta(spotify_track_id: str, db: AsyncSession) -> dict:
    """Best-effort track metadata. Mirrors _get_album_meta — TrackCache is
    consulted first; live Spotify is only used to fetch ISRC when reachable."""
    name: Optional[str] = None
    artist: Optional[str] = None
    isrc: Optional[str] = None

    cached = (await db.execute(
        select(TrackCache).where(TrackCache.spotify_id == spotify_track_id)
    )).scalar_one_or_none()
    if cached:
        name = cached.name
        artist = cached.artist

    try:
        track = await spotify.get_track(spotify_track_id)
        if track:
            if not name:
                name = track.get("name")
            if not artist:
                artist = (track.get("artists") or [""])[0]
            isrc = track.get("isrc")
    except Exception as e:
        log_silent_error("apple_music_track_meta_spotify_fetch", e,
                         spotify_track_id=spotify_track_id)

    return {
        "name": name,
        "artists": [artist] if artist else [],
        "isrc": isrc,
    }
