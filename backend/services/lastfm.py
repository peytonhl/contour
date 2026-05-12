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

from services import redis_cache

logger = logging.getLogger(__name__)

LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/"
_API_KEY = os.environ.get("LASTFM_API_KEY", "")

# Last.fm scrobble counts drift slowly (weekly-ish). 24h cache is generous
# without going stale enough to matter for chart math. Negative results
# (no album found) cached shorter so we re-check eventually.
_TTL_HIT = 86_400      # 24h
_TTL_MISS = 21_600     # 6h


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

    cache_key = f"lastfm:album:{artist.lower().strip()}:{album.lower().strip()}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        # 0 is our sentinel for a known-miss; surface as None to callers
        return cached or None

    params = {
        "method": "album.getInfo",
        "api_key": _API_KEY,
        "artist": artist,
        "album": album,
        "format": "json",
        "autocorrect": "1",
    }
    result: Optional[int] = None
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(LASTFM_BASE, params=params)
            if resp.status_code != 200:
                logger.warning("lastfm: HTTP %d for %s / %s", resp.status_code, artist, album)
            else:
                data = resp.json()
                if "error" in data:
                    logger.debug("lastfm: %s / %s — error %s: %s", artist, album, data["error"], data.get("message"))
                else:
                    playcount_str = data.get("album", {}).get("playcount")
                    if playcount_str:
                        count = int(playcount_str)
                        if count > 0:
                            logger.info("lastfm: %s / %s — %s plays", artist, album, f"{count:,}")
                            result = count
    except Exception as exc:
        logger.warning("lastfm: get_album_playcount(%s / %s) failed — %s", artist, album, exc)

    # Cache positives long, misses short (so we re-check if Last.fm later indexes it)
    await redis_cache.set(cache_key, result or 0, ttl=_TTL_HIT if result else _TTL_MISS)
    return result


async def get_track_playcount(artist: str, track: str) -> Optional[int]:
    """Return the total Last.fm scrobble count for a track."""
    if not _API_KEY:
        return None

    cache_key = f"lastfm:track:{artist.lower().strip()}:{track.lower().strip()}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        return cached or None

    params = {
        "method": "track.getInfo",
        "api_key": _API_KEY,
        "artist": artist,
        "track": track,
        "format": "json",
        "autocorrect": "1",
    }
    result: Optional[int] = None
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(LASTFM_BASE, params=params)
            if resp.status_code == 200:
                data = resp.json()
                if "error" not in data:
                    playcount_str = data.get("track", {}).get("playcount")
                    if playcount_str:
                        count = int(playcount_str)
                        result = count if count > 0 else None
    except Exception as exc:
        logger.warning("lastfm: get_track_playcount(%s / %s) failed — %s", artist, track, exc)

    await redis_cache.set(cache_key, result or 0, ttl=_TTL_HIT if result else _TTL_MISS)
    return result
