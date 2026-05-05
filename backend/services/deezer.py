"""
Deezer public API — 30-second preview fallback.

Spotify deprecated preview_url for most tracks in late 2023.
Deezer's public search API still returns 30s preview MP3 URLs for the
vast majority of tracks and requires no API key.

Used by the discover feed to enrich tracks that Spotify no longer
provides a preview clip for.
"""

import httpx

_BASE = "https://api.deezer.com/search"
_TIMEOUT = 4.0  # seconds — short so a slow Deezer response doesn't stall the feed


async def get_preview(track_name: str, artist_name: str) -> str | None:
    """
    Search Deezer for a matching track and return its 30-second preview URL.
    Returns None if no match is found or the request fails.
    """
    query = f"{artist_name} {track_name}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_BASE, params={"q": query, "limit": 1})
            resp.raise_for_status()
            items = resp.json().get("data", [])
            if items and items[0].get("preview"):
                return items[0]["preview"]
    except Exception:
        pass
    return None
