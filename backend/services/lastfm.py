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


async def get_artist_tags(artist_name: str, limit: int = 8) -> list[str]:
    """Return Last.fm's top tags for an artist as a list of lowercase strings.

    Last.fm tags are community-applied and skew genre-like for the top
    handful — e.g. Kendrick Lamar returns ['Hip-Hop', 'rap', 'west coast',
    'hip hop', 'compton']. We take the top `limit` and lowercase them so
    they slot into the same genre-matching paths that Spotify's `genres`
    field used to feed.

    Used as a REPLACEMENT for Spotify's artist.genres field, which was
    stripped from /v1/artists/{id} for non-Extended-Access apps in late
    2024 (confirmed empirically 2026-05-18 — every artist in our cache
    returned genres=[] including Kanye, Beyoncé, Kendrick). Contour can't
    get Extended Access (250K MAU bar, see memory). Last.fm tags are the
    obvious fallback — no Spotify quota, no auth-tier gating, and the
    tag vocabulary aligns closely with Spotify's genre vocabulary.

    Cached 30d on hit (artist tags are essentially immutable), 6h on miss
    (so we re-check artists Last.fm hadn't indexed yet).

    Returns [] when:
      - LASTFM_API_KEY not configured
      - Artist not found in Last.fm
      - Any network/parse error
    """
    if not _API_KEY:
        return []
    if not artist_name or not artist_name.strip():
        return []

    cache_key = f"lastfm:artist_tags:{artist_name.lower().strip()}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        # Sentinel: empty list cached as [] still indicates known-miss
        return list(cached) if isinstance(cached, list) else []

    params = {
        "method": "artist.getInfo",
        "api_key": _API_KEY,
        "artist": artist_name,
        "format": "json",
        "autocorrect": "1",
    }
    tags_out: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(LASTFM_BASE, params=params)
            if resp.status_code == 200:
                data = resp.json()
                if "error" not in data:
                    artist = data.get("artist") or {}
                    tags_block = artist.get("tags") or {}
                    raw_tags = tags_block.get("tag") if isinstance(tags_block, dict) else None
                    if isinstance(raw_tags, list):
                        for t in raw_tags[:limit]:
                            if isinstance(t, dict):
                                name = t.get("name")
                                if isinstance(name, str) and name.strip():
                                    tags_out.append(name.lower().strip())
    except Exception as exc:
        logger.warning("lastfm: get_artist_tags(%s) failed — %s", artist_name, exc)

    # Cache positives 30d (tags ~immutable), misses 6h (recheck small artists)
    await redis_cache.set(
        cache_key, tags_out,
        ttl=_TTL_HIT * 30 if tags_out else _TTL_MISS,
    )
    return tags_out


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
