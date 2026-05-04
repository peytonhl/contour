"""
Kworb.net scraper — total Spotify stream counts by album/track.

Two types of Kworb pages:
  Artist pages:  kworb.net/spotify/artist/{ID}.html        (all tracks + totals)
                 kworb.net/spotify/artist/{ID}_albums.html (all albums + totals)
  Entity pages:  kworb.net/spotify/track/{ID}.html         (daily chart data)
                 kworb.net/spotify/album/{ID}.html          (daily chart data)

We pass Spotify IDs directly — no name-slug guessing.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup

KWORB_BASE = "https://kworb.net/spotify/artist"
KWORB_ENTITY = "https://kworb.net/spotify"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Contour/0.1; +https://contour-rosy.vercel.app)"}


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


async def get_entity_daily_data(
    spotify_id: str,
    entity_type: str,  # "track" or "album"
) -> list[dict]:
    """
    Fetch the individual Kworb entity page (track or album) and return
    all charting days as [{date: str, streams_cumulative: int, source: "kworb_daily"}].

    Kworb entity pages have a table with columns: Date | Streams (daily) | Total
    The "Total" column is the running cumulative — that's what we want.

    Returns [] if the page doesn't exist or the track has never charted.
    """
    url = f"{KWORB_ENTITY}/{entity_type}/{spotify_id}.html"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url, headers=HEADERS)
            if resp.status_code != 200:
                return []
            return _parse_entity_page(resp.text)
    except Exception:
        return []


def _parse_entity_page(html: str) -> list[dict]:
    """
    Parse a Kworb track or album entity page.
    Returns [{date: "YYYY-MM-DD", streams_cumulative: int, source: "kworb_daily"}]
    sorted by date ascending.
    """
    soup = BeautifulSoup(html, "html.parser")
    results = []

    table = soup.find("table")
    if not table:
        return results

    rows = table.find_all("tr")
    if not rows:
        return results

    # Detect column indices from header row
    headers = [th.get_text(strip=True).lower() for th in rows[0].find_all(["th", "td"])]
    date_col = _find_col(headers, ["date"])
    total_col = _find_col(headers, ["total", "cumulative", "streams total"])

    # If no header clue, assume: col 0 = date, last col = total
    if date_col is None:
        date_col = 0
    if total_col is None:
        total_col = -1  # last column

    for row in rows[1:]:
        cells = row.find_all("td")
        if not cells:
            continue
        try:
            date_str = cells[date_col].get_text(strip=True)
            total_str = cells[total_col].get_text(strip=True).replace(",", "")
            parsed_date = _parse_date(date_str)
            streams = int(total_str)
            if parsed_date and streams > 0:
                results.append({
                    "date": parsed_date,
                    "streams_cumulative": streams,
                    "source": "kworb_daily",
                })
        except (ValueError, IndexError):
            continue

    results.sort(key=lambda x: x["date"])
    return results


def _find_col(headers: list[str], keywords: list[str]) -> Optional[int]:
    for i, h in enumerate(headers):
        for kw in keywords:
            if kw in h:
                return i
    return None


def _parse_date(s: str) -> Optional[str]:
    """Try common date formats Kworb uses and return ISO string or None."""
    for fmt in ("%Y-%m-%d", "%d %b %Y", "%b %d, %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _normalize(s: str) -> str:
    """Lowercase, strip punctuation and common edition suffixes for matching."""
    s = s.lower()
    s = re.sub(r"[\(\[].*?[\)\]]", "", s)
    s = re.sub(r"[^a-z0-9\s]", "", s)
    return s.strip()
