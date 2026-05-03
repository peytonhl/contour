"""
Kworb.net scraper — total Spotify stream counts by album.

Kworb uses Spotify artist IDs in their URLs:
  https://kworb.net/spotify/artist/{SPOTIFY_ARTIST_ID}_albums.html

We pass the artist's Spotify ID directly instead of constructing a name slug,
which was the previous (broken) approach.
"""

from __future__ import annotations

import re
from typing import Optional

import httpx
from bs4 import BeautifulSoup

KWORB_BASE = "https://kworb.net/spotify/artist"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Contour/0.1)"}


async def get_artist_albums_by_id(spotify_artist_id: str) -> Optional[list[dict]]:
    """
    Fetch all albums + stream counts for an artist using their Spotify artist ID.
    Returns a list of {"name": str, "streams": int} or None on failure.
    """
    url = f"{KWORB_BASE}/{spotify_artist_id}_albums.html"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url, headers=HEADERS)
            if resp.status_code != 200:
                return None
            return _parse_album_page(resp.text)
    except Exception:
        return None


async def get_album_streams(artist_spotify_id: str, album_name: str) -> Optional[int]:
    """
    Return the total stream count for a specific album.
    artist_spotify_id: Spotify artist ID (e.g. "6U3ybJ9UHNKEdsH7ktGBZ7")
    album_name: album title as it appears on Spotify
    """
    albums = await get_artist_albums_by_id(artist_spotify_id)
    if not albums:
        return None

    target = _normalize(album_name)

    # Collect all entries whose normalized name matches the target.
    # Because _normalize strips edition suffixes, "God Does Like Ugly (Preluxe)"
    # and "God Does Like Ugly" normalize identically — so we pick the one
    # whose RAW name is shortest (i.e. the base/standard edition).
    exact = [a for a in albums if _normalize(a["name"]) == target]
    if exact:
        return min(exact, key=lambda a: len(a["name"]))["streams"]

    # Partial match fallback — target is contained in or contains the entry name
    partial = [a for a in albums if target in _normalize(a["name"]) or _normalize(a["name"]) in target]
    if partial:
        return min(partial, key=lambda a: len(a["name"]))["streams"]

    return None


async def get_artist_tracks_by_id(spotify_artist_id: str) -> Optional[list[dict]]:
    """
    Fetch all tracks + stream counts for an artist using their Spotify artist ID.
    Kworb's artist track page: kworb.net/spotify/artist/{ID}.html
    Returns a list of {"name": str, "streams": int} or None on failure.
    """
    url = f"{KWORB_BASE}/{spotify_artist_id}.html"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url, headers=HEADERS)
            if resp.status_code != 200:
                return None
            return _parse_album_page(resp.text)
    except Exception:
        return None


async def get_track_streams(artist_spotify_id: str, track_name: str) -> Optional[int]:
    """Return the total stream count for a specific track."""
    tracks = await get_artist_tracks_by_id(artist_spotify_id)
    if not tracks:
        return None

    target = _normalize(track_name)

    exact = [t for t in tracks if _normalize(t["name"]) == target]
    if exact:
        return max(exact, key=lambda t: t["streams"])["streams"]

    partial = [t for t in tracks if target in _normalize(t["name"]) or _normalize(t["name"]) in target]
    if partial:
        return max(partial, key=lambda t: t["streams"])["streams"]

    return None


async def get_multiple_edition_streams(
    artist_spotify_id: str, album_name: str
) -> list[dict]:
    """
    Return all editions of an album (standard, deluxe, alternate, etc.)
    as a list of {"name": str, "streams": int}.
    """
    albums = await get_artist_albums_by_id(artist_spotify_id)
    if not albums:
        return []

    base = _normalize(album_name)
    return [a for a in albums if base in _normalize(a["name"])]


def _parse_album_page(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    results = []

    table = soup.find("table")
    if not table:
        return results

    for row in table.find_all("tr")[1:]:
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        name = cells[0].get_text(strip=True)
        # Stream count is typically the second column; strip commas
        streams_text = cells[1].get_text(strip=True).replace(",", "")
        try:
            streams = int(streams_text)
        except ValueError:
            continue
        if name:
            results.append({"name": name, "streams": streams})

    return results


def _normalize(s: str) -> str:
    """Lowercase, strip punctuation and common edition suffixes for matching."""
    s = s.lower()
    s = re.sub(r"[\(\[].*?[\)\]]", "", s)
    s = re.sub(r"[^a-z0-9\s]", "", s)
    return s.strip()
