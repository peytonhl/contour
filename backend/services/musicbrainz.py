"""MusicBrainz API client — release date and structured metadata."""

from __future__ import annotations

import httpx

MB_API = "https://musicbrainz.org/ws/2"
HEADERS = {
    "User-Agent": "Contour/0.1 (peyton2117@gmail.com)",
    "Accept": "application/json",
}


async def search_release(artist: str, album: str) -> list[dict]:
    """Search MusicBrainz for releases matching artist + album."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{MB_API}/release",
            headers=HEADERS,
            params={
                "query": f'release:"{album}" AND artist:"{artist}"',
                "fmt": "json",
                "limit": 10,
            },
        )
        resp.raise_for_status()
        releases = resp.json().get("releases", [])

    return [_parse_release(r) for r in releases]


async def get_release(mbid: str) -> dict | None:
    """Fetch a specific release by MusicBrainz ID."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{MB_API}/release/{mbid}",
            headers=HEADERS,
            params={"fmt": "json", "inc": "artist-credits labels"},
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return _parse_release(resp.json())


def _parse_release(r: dict) -> dict:
    artist_credits = r.get("artist-credit", [])
    artists = [
        ac["artist"]["name"]
        for ac in artist_credits
        if isinstance(ac, dict) and "artist" in ac
    ]
    label_info = r.get("label-info", [])
    labels = [
        li["label"]["name"]
        for li in label_info
        if li.get("label")
    ]

    return {
        "mbid": r.get("id"),
        "title": r.get("title"),
        "artists": artists,
        "date": r.get("date"),  # may be YYYY, YYYY-MM, or YYYY-MM-DD
        "country": r.get("country"),
        "status": r.get("status"),
        "labels": labels,
        "barcode": r.get("barcode"),
    }
