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


async def get_artist_tags(artist_name: str, limit: int = 15) -> list[dict]:
    """Return Last.fm's top tags for an artist as [{name, count}, ...] dicts.

    Switched from artist.getInfo to artist.getTopTags so we get the
    community-vote `count` per tag. Counts let downstream code compute a
    confidence score for each tag relative to that artist's tag mass —
    necessary to distinguish a real genre signal (e.g. Bieber pop=100,
    rnb=34) from a high-count meme/prank (Bieber black-metal=58). The
    artist.getInfo endpoint only returned top 5 tag names without counts.

    Returns a list of {name, count} dicts, lowercased name, in
    descending count order (Last.fm's natural ordering). Empty list on
    failure or if Last.fm doesn't index the artist.

    Cached 30d on hit (tags ~immutable), 6h on miss (so a small artist
    that Last.fm hadn't tagged yet gets re-checked once it might be).

    Example return for Kendrick Lamar:
        [{"name": "hip-hop", "count": 100},
         {"name": "rap", "count": 70},
         {"name": "west coast", "count": 19},
         {"name": "hip hop", "count": 16},
         {"name": "compton", "count": 6}, ...]
    """
    if not _API_KEY:
        return []
    if not artist_name or not artist_name.strip():
        return []

    # Cache key bumped to v2 to invalidate the old format (list of
    # strings, no counts) from the artist.getInfo era. Old keys naturally
    # expire via TTL but bumping forces the upgrade for active artists.
    cache_key = f"lastfm:artist_tags_v2:{artist_name.lower().strip()}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        if isinstance(cached, list):
            # Defensive: each item should be a dict with name + count
            return [t for t in cached if isinstance(t, dict) and t.get("name")]
        return []

    params = {
        "method": "artist.getTopTags",
        "api_key": _API_KEY,
        "artist": artist_name,
        "format": "json",
        "autocorrect": "1",
    }
    tags_out: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(LASTFM_BASE, params=params)
            if resp.status_code == 200:
                data = resp.json()
                if "error" not in data:
                    toptags = data.get("toptags") or {}
                    raw_tags = toptags.get("tag") if isinstance(toptags, dict) else None
                    if isinstance(raw_tags, list):
                        for t in raw_tags[:limit]:
                            if not isinstance(t, dict):
                                continue
                            name = t.get("name")
                            if not isinstance(name, str) or not name.strip():
                                continue
                            # Last.fm `count` is a string in some responses,
                            # int in others. Coerce; missing/garbage → 0.
                            raw_count = t.get("count")
                            try:
                                count = int(raw_count)
                            except (TypeError, ValueError):
                                count = 0
                            tags_out.append({
                                "name": name.lower().strip(),
                                "count": count,
                            })
    except Exception as exc:
        logger.warning("lastfm: get_artist_tags(%s) failed — %s", artist_name, exc)

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
