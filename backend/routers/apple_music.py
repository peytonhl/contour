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
from models import AppleMusicLink
from services import apple_music, spotify

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apple-music", tags=["apple-music"])


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


async def _persist(
    db: AsyncSession,
    spotify_id: str,
    entity_type: str,
    storefront: str,
    apple_music_id: Optional[str],
    match_method: str,
) -> AppleMusicLink:
    row = AppleMusicLink(
        spotify_id=spotify_id,
        entity_type=entity_type,
        storefront=storefront,
        apple_music_id=apple_music_id,
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
    db: AsyncSession = Depends(get_db),
):
    if entity_type not in ("album", "track"):
        raise HTTPException(status_code=400, detail="entity_type must be 'album' or 'track'")

    cached = await _cached_link(db, spotify_id, entity_type, storefront)
    if cached and cached.apple_music_id:
        return {
            "spotify_id": spotify_id,
            "entity_type": entity_type,
            "apple_music_id": cached.apple_music_id,
            "url": apple_music.deep_link(entity_type, cached.apple_music_id, storefront),
            "storefront": storefront,
            "match_method": cached.match_method,
            "cached": True,
        }

    # Negative cache hit — we've already tried to match and failed. Don't
    # spend an HTTP call on every page view.
    if cached and not cached.apple_music_id:
        raise HTTPException(status_code=404, detail="No Apple Music match")

    if not apple_music.is_configured():
        # Don't write a negative-cache row here — once keys land we want the
        # next request to retry, not skip.
        raise HTTPException(status_code=404, detail="Apple Music not configured")

    # Cold cache + service enabled → try matching now.
    apple_music_id: Optional[str] = None
    match_method = "none"

    try:
        if entity_type == "track":
            track = await spotify.get_track(spotify_id)
            isrc = track.get("isrc")
            if isrc:
                match = await apple_music.match_track_by_isrc(isrc, storefront)
                if match and match.get("track_id"):
                    apple_music_id = match["track_id"]
                    match_method = "isrc"
            if not apple_music_id:
                apple_music_id = await apple_music.search_by_text(
                    name=track.get("name", ""),
                    artist=(track.get("artists") or [""])[0],
                    entity_type="track",
                    storefront=storefront,
                )
                if apple_music_id:
                    match_method = "text"
        else:  # album
            album_data = await _get_album_with_first_track_isrc(spotify_id)
            isrc = album_data.get("first_track_isrc")
            if isrc:
                match = await apple_music.match_track_by_isrc(isrc, storefront)
                if match and match.get("album_id"):
                    apple_music_id = match["album_id"]
                    match_method = "isrc"
            if not apple_music_id:
                apple_music_id = await apple_music.search_by_text(
                    name=album_data.get("name", ""),
                    artist=(album_data.get("artists") or [""])[0],
                    entity_type="album",
                    storefront=storefront,
                )
                if apple_music_id:
                    match_method = "text"
    except Exception as exc:
        logger.warning("apple_music match failed for %s/%s: %s", entity_type, spotify_id, exc)

    await _persist(db, spotify_id, entity_type, storefront, apple_music_id, match_method)

    if not apple_music_id:
        raise HTTPException(status_code=404, detail="No Apple Music match")

    return {
        "spotify_id": spotify_id,
        "entity_type": entity_type,
        "apple_music_id": apple_music_id,
        "url": apple_music.deep_link(entity_type, apple_music_id, storefront),
        "storefront": storefront,
        "match_method": match_method,
        "cached": False,
    }


async def _get_album_with_first_track_isrc(spotify_album_id: str) -> dict:
    """Fetch album metadata and the ISRC of its first track. The track-list
    call isn't cached in Redis directly but each track fetch downstream is."""
    album = await spotify.get_album(spotify_album_id)
    isrc = None
    try:
        tracklist = await spotify.get_album_tracks(spotify_album_id)
        if tracklist:
            first_id = tracklist[0].get("id")
            if first_id:
                track = await spotify.get_track(first_id)
                isrc = track.get("isrc")
    except Exception:
        isrc = None
    return {
        "name": album.get("name"),
        "artists": album.get("artists") or [],
        "first_track_isrc": isrc,
    }
