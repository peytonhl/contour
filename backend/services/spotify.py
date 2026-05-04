"""Spotify Web API client — album search and metadata."""

from __future__ import annotations

import base64
import time
from pathlib import Path
from typing import Optional

import httpx
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).parent.parent / ".env"


class SpotifySettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    spotify_client_id: str
    spotify_client_secret: str


_settings: Optional[SpotifySettings] = None
_token: Optional[str] = None
_token_expiry: float = 0.0


def _get_settings() -> SpotifySettings:
    global _settings
    if _settings is None:
        _settings = SpotifySettings()
    return _settings


async def _get_token(client: httpx.AsyncClient) -> str:
    global _token, _token_expiry
    if _token and time.time() < _token_expiry - 60:
        return _token

    s = _get_settings()
    creds = base64.b64encode(
        f"{s.spotify_client_id}:{s.spotify_client_secret}".encode()
    ).decode()

    resp = await client.post(
        "https://accounts.spotify.com/api/token",
        headers={"Authorization": f"Basic {creds}"},
        data={"grant_type": "client_credentials"},
    )
    resp.raise_for_status()
    data = resp.json()
    _token = data["access_token"]
    _token_expiry = time.time() + data["expires_in"]
    return _token


async def search_artists(query: str, limit: int = 10) -> list[dict]:
    """Search Spotify for artists matching the query string."""
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await client.get(
            "https://api.spotify.com/v1/search",
            headers={"Authorization": f"Bearer {token}"},
            params={"q": query, "type": "artist", "limit": limit},
        )
        resp.raise_for_status()
        items = resp.json()["artists"]["items"]
    return [_parse_artist(a) for a in items]


async def get_artist(artist_id: str) -> dict:
    """Fetch artist metadata by Spotify artist ID."""
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await client.get(
            f"https://api.spotify.com/v1/artists/{artist_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return _parse_artist(resp.json())


async def get_album_tracks(album_id: str) -> list[dict]:
    """Fetch the tracklist for an album."""
    results = []
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        url = f"https://api.spotify.com/v1/albums/{album_id}/tracks"
        params = {"limit": 50}
        while url:
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"}, params=params)
            resp.raise_for_status()
            data = resp.json()
            results.extend(data.get("items", []))
            url = data.get("next")
            params = {}
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "track_number": t["track_number"],
            "duration_ms": t["duration_ms"],
            "explicit": t.get("explicit", False),
            "artists": [a["name"] for a in t.get("artists", [])],
            "artist_ids": [a["id"] for a in t.get("artists", []) if a.get("id")],
            "preview_url": t.get("preview_url"),
        }
        for t in results
    ]


async def search_tracks(query: str, limit: int = 10) -> list[dict]:
    """Search Spotify for tracks matching the query string."""
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await client.get(
            "https://api.spotify.com/v1/search",
            headers={"Authorization": f"Bearer {token}"},
            params={"q": query, "type": "track", "limit": limit},
        )
        resp.raise_for_status()
        items = resp.json()["tracks"]["items"]
    return [_parse_track(t) for t in items]


async def get_track(track_id: str) -> dict:
    """Fetch full track metadata by Spotify track ID."""
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await client.get(
            f"https://api.spotify.com/v1/tracks/{track_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return _parse_track(resp.json())


async def search_albums(query: str, limit: int = 10) -> list[dict]:
    """Search Spotify for albums matching the query string."""
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await client.get(
            "https://api.spotify.com/v1/search",
            headers={"Authorization": f"Bearer {token}"},
            params={"q": query, "type": "album", "limit": limit},
        )
        resp.raise_for_status()
        items = resp.json()["albums"]["items"]

    return [_parse_album(a) for a in items]


async def get_album(album_id: str) -> dict:
    """Fetch full album metadata by Spotify album ID."""
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await client.get(
            f"https://api.spotify.com/v1/albums/{album_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return _parse_album(resp.json())


async def get_new_releases(limit: int = 10) -> list[dict]:
    """Fetch newly released albums from Spotify."""
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await client.get(
            "https://api.spotify.com/v1/browse/new-releases",
            headers={"Authorization": f"Bearer {token}"},
            params={"limit": limit, "country": "US"},
        )
        resp.raise_for_status()
        items = resp.json()["albums"]["items"]
    return [_parse_album(a) for a in items]


async def search_tracks_by_genre(genre: str, limit: int = 20) -> list[dict]:
    """Search for tracks by genre tag using Spotify's genre filter."""
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await client.get(
            "https://api.spotify.com/v1/search",
            headers={"Authorization": f"Bearer {token}"},
            params={"q": f"genre:{genre}", "type": "track", "limit": limit, "market": "US"},
        )
        resp.raise_for_status()
        items = resp.json().get("tracks", {}).get("items", [])
    return [_parse_track(t) for t in items if t.get("id")]


async def get_global_top_tracks(limit: int = 10) -> list[dict]:
    """Fetch top tracks from Spotify's Global Top 50 playlist."""
    GLOBAL_TOP_50 = "37i9dQZEVXbMDoHDwVN2tF"
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await client.get(
            f"https://api.spotify.com/v1/playlists/{GLOBAL_TOP_50}/tracks",
            headers={"Authorization": f"Bearer {token}"},
            params={"limit": limit},
        )
        resp.raise_for_status()
        items = resp.json()["items"]
    tracks = []
    for item in items:
        t = item.get("track")
        if t and t.get("id"):
            tracks.append(_parse_track(t))
    return tracks


async def get_artist_top_tracks(artist_id: str, market: str = "US") -> list[dict]:
    """Fetch an artist's top 10 tracks from Spotify."""
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await client.get(
            f"https://api.spotify.com/v1/artists/{artist_id}/top-tracks",
            headers={"Authorization": f"Bearer {token}"},
            params={"market": market},
        )
        resp.raise_for_status()
        tracks = resp.json().get("tracks", [])
    return [_parse_track(t) for t in tracks[:10]]


async def get_artist_albums(artist_id: str) -> list[dict]:
    """
    Fetch all albums for an artist by their Spotify artist ID.
    Returns all album types (album, single, compilation).
    """
    results = []
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        url = f"https://api.spotify.com/v1/artists/{artist_id}/albums"
        params = {"include_groups": "album,compilation", "limit": 50, "market": "US"}
        while url:
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"}, params=params)
            resp.raise_for_status()
            data = resp.json()
            results.extend(data.get("items", []))
            url = data.get("next")
            params = {}  # next URL already includes params
    return [_parse_album(a) for a in results]


async def find_editions(album_id: str) -> list[dict]:
    """
    Given an album ID, find all editions of that album by the same artist
    using the artist's full discography. Matches on normalized base title.
    """
    album = await get_album(album_id)
    if not album["artists"]:
        return [album]

    # Get the primary artist's Spotify ID
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        # Re-fetch raw to get artist IDs
        resp = await client.get(
            f"https://api.spotify.com/v1/albums/{album_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        raw = resp.json()

    artist_id = raw["artists"][0]["id"] if raw.get("artists") else None
    if not artist_id:
        return [album]

    all_albums = await get_artist_albums(artist_id)
    base = _normalize_title(album["name"])
    editions = [a for a in all_albums if _normalize_title(a["name"]).startswith(base)]

    # Always include the original if not already in results
    ids = {a["id"] for a in editions}
    if album["id"] not in ids:
        editions.insert(0, album)

    return editions


def _normalize_title(title: str) -> str:
    """Strip edition suffixes to get a base album title for matching."""
    import re
    t = title.lower().strip()
    t = re.sub(r"\s*[\(\[].*?[\)\]]", "", t)  # remove (Deluxe), [Explicit], etc.
    t = re.sub(r"\s+(deluxe|explicit|expanded|remastered|anniversary|edition|version|reissue).*$", "", t)
    return t.strip()


def _parse_artist(a: dict) -> dict:
    images = a.get("images", [])
    image_url = images[0]["url"] if images else None
    return {
        "id": a["id"],
        "name": a["name"],
        "genres": a.get("genres", []),
        "followers": a.get("followers", {}).get("total"),
        "popularity": a.get("popularity"),
        "image_url": image_url,
        "external_url": a.get("external_urls", {}).get("spotify"),
    }


def _parse_track(t: dict) -> dict:
    album = t.get("album", {})
    images = album.get("images", [])
    image_url = images[0]["url"] if images else None
    raw_artists = t.get("artists", [])
    artists = [a["name"] for a in raw_artists]
    artist_ids = [a["id"] for a in raw_artists if a.get("id")]

    return {
        "id": t["id"],
        "name": t["name"],
        "artists": artists,
        "artist_ids": artist_ids,
        "album_id": album.get("id"),
        "album_name": album.get("name", ""),
        "release_date": album.get("release_date", ""),
        "release_date_precision": album.get("release_date_precision", "day"),
        "duration_ms": t.get("duration_ms"),
        "popularity": t.get("popularity"),
        "explicit": t.get("explicit", False),
        "track_number": t.get("track_number"),
        "image_url": image_url,
        "preview_url": t.get("preview_url"),
        "external_url": t.get("external_urls", {}).get("spotify"),
        # Fields needed by album cache upsert
        "label": None,
        "total_tracks": None,
    }


def _parse_album(a: dict) -> dict:
    images = a.get("images", [])
    image_url = images[0]["url"] if images else None
    raw_artists = a.get("artists", [])
    artists = [ar["name"] for ar in raw_artists]
    artist_ids = [ar["id"] for ar in raw_artists if ar.get("id")]
    release_date = a.get("release_date", "")
    release_date_precision = a.get("release_date_precision", "day")

    return {
        "id": a["id"],
        "name": a["name"],
        "artists": artists,
        "artist_ids": artist_ids,
        "release_date": release_date,
        "release_date_precision": release_date_precision,
        "total_tracks": a.get("total_tracks"),
        "label": a.get("label"),
        "popularity": a.get("popularity"),
        "image_url": image_url,
        "external_url": a.get("external_urls", {}).get("spotify"),
        "upc": a.get("external_ids", {}).get("upc"),
    }
