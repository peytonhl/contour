"""
Deezer public API — track search and 30-second preview URLs.

Spotify deprecated preview_url for most tracks in late 2023, and their
search/playlist APIs now return empty results for apps not in Extended
Access mode.  Deezer's public search API requires NO API key and returns
30-second preview MP3 clips for the vast majority of tracks.

Used by the discover feed as the primary source for baseline tiers, and
as a preview-URL enrichment fallback for Spotify tracks.
"""

import asyncio
import hashlib

import httpx

from services import redis_cache

_BASE = "https://api.deezer.com/search"
_CHART_URL = "https://api.deezer.com/chart/0/tracks"
# Bumped from 6s → 10s. The For You feed fires N parallel get_preview()
# calls for Spotify-source tracks missing preview_url (Spotify dropped
# previews for most tracks late 2023). Under burst load Deezer's response
# times can climb above 6s, especially cold-cache, and a timeout there
# silently drops the preview clip — the frontend then has to fall back
# to a Spotify iframe which has its own UX issues in WKWebView.
_TIMEOUT = 10.0  # seconds

# Artist names that indicate compilation / karaoke / cover releases — skip them.
_JUNK_ARTISTS = {
    "top hits", "various artists", "karaoke", "tribute", "cover nation",
    "hits", "chart hits", "billboard hits", "now hits", "pop hits",
}


def _parse_deezer_track(t: dict) -> dict:
    """Normalise a Deezer track object to the shape expected by the discover feed."""
    artist = t.get("artist") or {}
    album = t.get("album") or {}
    return {
        "id": str(t["id"]),
        "name": t.get("title", ""),
        "artists": [artist.get("name", "")] if artist.get("name") else [],
        "artist_ids": [str(artist["id"])] if artist.get("id") else [],
        "album_id": str(album["id"]) if album.get("id") else None,
        "album_name": album.get("title", ""),
        "release_date": "",
        "duration_ms": (t.get("duration") or 0) * 1000,
        "explicit": t.get("explicit_lyrics", False),
        "image_url": album.get("cover_medium") or album.get("cover"),
        "preview_url": t.get("preview"),
        "external_url": t.get("link"),
        "_source": "deezer",  # lets callers know this is a Deezer-native track
    }


async def search_tracks(query: str, limit: int = 20) -> list[dict]:
    """
    Search Deezer for tracks matching the query.
    Results are cached for 6 hours (shorter than Spotify's 24h since
    Deezer returns slightly different orderings each time).
    """
    cache_key = f"deezer:search:{hashlib.md5(f'{query}:{limit}'.encode()).hexdigest()}"
    cached = await redis_cache.get(cache_key)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_BASE, params={"q": query, "limit": limit})
            resp.raise_for_status()
            items = resp.json().get("data", [])
        result = [
            _parse_deezer_track(t) for t in items
            if t.get("id") and t.get("preview")
            and (t.get("artist") or {}).get("name", "").lower() not in _JUNK_ARTISTS
        ]
        if result:
            await redis_cache.set(cache_key, result, ttl=21_600)  # 6 h
        return result
    except Exception:
        return []


async def get_chart_tracks(limit: int = 50) -> list[dict]:
    """
    Return Deezer's global chart tracks (real chart data, not a text search).
    Avoids the "Top Hits band" problem caused by searching the string "top hits".
    Cached 24h — charts don't shift hour-to-hour and this is hit on every For You
    batch.
    """
    cache_key = f"deezer:chart:{limit}"
    cached = await redis_cache.get(cache_key)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_CHART_URL, params={"limit": limit})
            resp.raise_for_status()
            items = resp.json().get("data", [])
        result = [
            _parse_deezer_track(t) for t in items
            if t.get("id") and t.get("preview")
            and (t.get("artist") or {}).get("name", "").lower() not in _JUNK_ARTISTS
        ]
        if result:
            await redis_cache.set(cache_key, result, ttl=86_400)  # 24 h
        return result
    except Exception:
        return []


async def get_preview(track_name: str, artist_name: str) -> str | None:
    """
    Search Deezer for a matching track and return its 30-second preview URL.
    Returns None if no match is found or the request fails.
    Cached 30d — preview URLs are immutable; this is called as a fallback for
    Spotify tracks missing preview_url, so every For You card potentially fires
    one of these on first show.
    """
    cache_key = f"deezer:preview:{artist_name.lower().strip()}:{track_name.lower().strip()}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        # Cache hit (could be a real URL or an explicit empty-string sentinel
        # marking a previous miss — both are valid "we already tried this" signals)
        return cached or None

    query = f"{artist_name} {track_name}"
    result: str | None = None
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_BASE, params={"q": query, "limit": 1})
            resp.raise_for_status()
            items = resp.json().get("data", [])
            if items and items[0].get("preview"):
                result = items[0]["preview"]
    except Exception:
        pass

    # Store hits for 30d; store negative results (empty string) for 7d so we
    # don't keep retrying broken matches but eventually re-check.
    await redis_cache.set(cache_key, result or "", ttl=2_592_000 if result else 604_800)
    return result
