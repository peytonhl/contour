"""
Last.fm API client — album and track scrobble counts.

Last.fm provides cumulative lifetime play counts (scrobbles) for albums and
tracks, queried by artist name + title.  No Spotify ID needed; autocorrect
handles minor spelling variations.

Env var required: LASTFM_API_KEY
Get a free key at https://www.last.fm/api/account/create
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/"
_API_KEY = os.environ.get("LASTFM_API_KEY", "")


async def get_album_playcount(artist: str, album: str) -> Optional[int]:
    """
    Return the total Last.fm scrobble count for an album.

    Uses album.getInfo with autocorrect=1 so minor typos / edition suffixes
    are handled automatically.  Returns None if:
      • No API key is configured
      • The album isn't found in Last.fm
      • Any network/parse error occurs
    """
    if not _API_KEY:
        logger.debug("lastfm: LASTFM_API_KEY not set — skipping")
        return None

    params = {
        "method": "album.getInfo",
        "api_key": _API_KEY,
        "artist": artist,
        "album": album,
        "format": "json",
        "autocorrect": "1",
    }
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(LASTFM_BASE, params=params)
            if resp.status_code != 200:
                logger.warning("lastfm: HTTP %d for %s / %s", resp.status_code, artist, album)
                return None
            data = resp.json()
            if "error" in data:
                logger.debug("lastfm: %s / %s — error %s: %s", artist, album, data["error"], data.get("message"))
                return None
            playcount_str = data.get("album", {}).get("playcount")
            if playcount_str:
                count = int(playcount_str)
                if count > 0:
                    logger.info("lastfm: %s / %s — %s plays", artist, album, f"{count:,}")
                    return count
    except Exception as exc:
        logger.warning("lastfm: get_album_playcount(%s / %s) failed — %s", artist, album, exc)
    return None


async def get_track_playcount(artist: str, track: str) -> Optional[int]:
    """Return the total Last.fm scrobble count for a track."""
    if not _API_KEY:
        return None

    params = {
        "method": "track.getInfo",
        "api_key": _API_KEY,
        "artist": artist,
        "track": track,
        "format": "json",
        "autocorrect": "1",
    }
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(LASTFM_BASE, params=params)
            if resp.status_code != 200:
                return None
            data = resp.json()
            if "error" in data:
                return None
            playcount_str = data.get("track", {}).get("playcount")
            if playcount_str:
                count = int(playcount_str)
                return count if count > 0 else None
    except Exception as exc:
        logger.warning("lastfm: get_track_playcount(%s / %s) failed — %s", artist, track, exc)
    return None
