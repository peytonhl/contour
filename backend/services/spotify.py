"""Spotify Web API client — album search and metadata."""

from __future__ import annotations

import asyncio
import base64
import logging
import math
import random
import time
from pathlib import Path
from typing import Optional

import httpx

_log = logging.getLogger(__name__)
from pydantic_settings import BaseSettings, SettingsConfigDict

from services import redis_cache


# If Retry-After exceeds this, don't bother waiting — just bail and let the
# caller fall back to DB/cache.  Waiting 49 minutes in a request handler is
# pointless; we'd rather return DB results immediately.
_MAX_RETRY_WAIT = 15  # seconds

# ── Cache TTLs ────────────────────────────────────────────────────────────────
# Track/album metadata is immutable post-release; bump TTLs aggressively so we
# rarely re-fetch. Anything that legitimately changes (charts, new releases)
# keeps a shorter window.
_TTL_30D = 2_592_000   # immutable metadata (tracks, albums, album tracklists, previews)
_TTL_7D  =   604_800   # slow-changing (artists, search results, top tracks, genre searches)
_TTL_24H =    86_400   # daily-ish (global top charts)
_TTL_1H  =     3_600   # fast-changing (new releases)

# Circuit breaker: when Spotify hands us a long Retry-After (credential-wide
# rate-limit block, sometimes hours), stop hitting the API entirely until
# the block expires. Otherwise every new request resets the timer and keeps
# us locked out indefinitely. The breaker stores a UNIX-epoch deadline; any
# call before that deadline short-circuits with a synthetic 429 response so
# callers fall back to their DB cache without ever touching the network.
_circuit_open_until: float = 0.0
# Trip the breaker on any Retry-After this long or longer. Tighter than
# the default httpx exponential because Spotify's "you exceeded the rate
# limit" responses tend to compound: 30s blocks become 5min blocks become
# hours if we keep hammering. Failing fast is the cheaper trade.
_CIRCUIT_BREAKER_THRESHOLD = 10  # seconds
# Hard upper bound on self-imposed lockout duration. Spotify occasionally
# returns Retry-After values measured in HOURS (the legendary 11-hour
# credential-wide block from May 2026 was the canonical case). Respecting
# those verbatim locks us out for the whole window, even if the actual
# rate limit recovers in minutes. Instead, cap our self-imposed lockout
# at 30 min and let the next call probe Spotify naturally — if they're
# still mad, we'll re-trip briefly; if they recovered, we resume early.
_MAX_CIRCUIT_OPEN_SECONDS = 1800  # 30 minutes

# Concurrency cap on outbound Spotify HTTP. Spotify rate-limits per rolling
# window AND per-app burst behavior. A small concurrency cap prevents
# cold-cache traffic spikes (many users loading the site at once, RYM CSV
# imports, etc.) from firing dozens of parallel requests and tripping a
# credential-wide block. Sustained throughput is still ~5 / per-call-latency
# req/s, which is plenty under normal traffic.
_SPOTIFY_CONCURRENCY = 5
_spotify_semaphore: Optional[asyncio.Semaphore] = None


def _get_semaphore() -> asyncio.Semaphore:
    """Lazy-init so the semaphore binds to the active event loop, not import-time."""
    global _spotify_semaphore
    if _spotify_semaphore is None:
        _spotify_semaphore = asyncio.Semaphore(_SPOTIFY_CONCURRENCY)
    return _spotify_semaphore


# ── DB write-through ──────────────────────────────────────────────────────────
# Track / album metadata is immutable post-release, so any time we successfully
# pay for a Spotify fetch we persist the result to the DB caches as well as
# Redis. After that, the entity is essentially free forever — survives Redis
# flushes, deploys, and the Redis TTL. Callers don't need to opt in or
# remember to upsert themselves.
#
# Imports are inline + lazy so this module doesn't introduce a hard dependency
# on the DB / models from a pure-API-client perspective. Failures here are
# logged and swallowed — the Spotify call already returned, the user has
# their data, persistence is best-effort. The outcome-counter pattern below
# means any silent failure shows up on /admin/stats with its exception type
# so we don't repeat the int32-overflow debugging fiasco.

from services.instrumentation import counter as _make_counter, record as _record

_TRACK_PERSIST = _make_counter(
    "spotify._persist_track_to_db",
    inserted_total=0, updated_total=0, errored_total=0, skipped_no_id_total=0,
)
_ALBUM_PERSIST = _make_counter(
    "spotify._persist_album_to_db",
    inserted_total=0, updated_total=0, errored_total=0, skipped_no_id_total=0,
)


async def _persist_track_to_db(meta: dict) -> None:
    """Write-through a fetched track to TrackCache. Idempotent upsert."""
    if not meta.get("id"):
        _record(_TRACK_PERSIST, outcome="skipped_no_id", skipped_no_id_total=1)
        return
    try:
        import json
        from sqlalchemy import select
        from database import AsyncSessionLocal
        from models import TrackCache

        async with AsyncSessionLocal() as session:
            existing = (await session.execute(
                select(TrackCache).where(TrackCache.spotify_id == meta["id"])
            )).scalar_one_or_none()
            artist_ids_json = json.dumps(meta.get("artist_ids", []))
            artist_str = ", ".join(meta.get("artists", []))
            if existing:
                existing.name = meta.get("name") or existing.name
                existing.artist = artist_str or existing.artist
                existing.album_name = meta.get("album_name") or existing.album_name
                existing.album_id = meta.get("album_id") or existing.album_id
                existing.release_date = meta.get("release_date") or existing.release_date
                existing.duration_ms = meta.get("duration_ms") or existing.duration_ms
                existing.explicit = meta.get("explicit", existing.explicit)
                # Don't nuke a previously-set popularity if the new meta has
                # None — that happens when a track was originally enriched
                # via /v1/tracks (full popularity) and is now being re-
                # persisted from a /v1/search response (popularity stripped
                # for non-Extended-Access apps post late-2024). Keep the
                # known value rather than regressing it to null.
                new_pop = meta.get("popularity")
                if new_pop is not None:
                    existing.popularity = new_pop
                existing.image_url = meta.get("image_url") or existing.image_url
                existing.external_url = meta.get("external_url") or existing.external_url
                existing.artist_ids_json = artist_ids_json
                outcome = "updated"
                delta = {"updated_total": 1}
            else:
                session.add(TrackCache(
                    spotify_id=meta["id"],
                    name=meta.get("name") or "",
                    artist=artist_str,
                    album_name=meta.get("album_name"),
                    album_id=meta.get("album_id"),
                    release_date=meta.get("release_date"),
                    duration_ms=meta.get("duration_ms"),
                    explicit=meta.get("explicit", False),
                    popularity=meta.get("popularity"),
                    image_url=meta.get("image_url"),
                    external_url=meta.get("external_url"),
                    artist_ids_json=artist_ids_json,
                ))
                outcome = "inserted"
                delta = {"inserted_total": 1}
            await session.commit()
        _record(_TRACK_PERSIST, outcome=outcome, subject=meta["id"], **delta)
    except Exception as exc:
        _record(_TRACK_PERSIST,
                outcome=f"errored: {type(exc).__name__}: {exc}",
                subject=meta.get("id"), errored_total=1)
        _log.warning("[spotify] persist track %s failed: %s", meta.get("id"), exc)


async def _persist_album_to_db(meta: dict) -> None:
    """Write-through a fetched album to AlbumCache. Idempotent upsert.

    Leaves enrichment_status alone on existing rows — the Kworb streams
    enrichment pipeline owns that field's lifecycle.
    """
    if not meta.get("id"):
        _record(_ALBUM_PERSIST, outcome="skipped_no_id", skipped_no_id_total=1)
        return
    try:
        from sqlalchemy import select
        from database import AsyncSessionLocal
        from models import AlbumCache

        async with AsyncSessionLocal() as session:
            existing = (await session.execute(
                select(AlbumCache).where(AlbumCache.spotify_id == meta["id"])
            )).scalar_one_or_none()
            artist_str = ", ".join(meta.get("artists", []))
            if existing:
                existing.name = meta.get("name") or existing.name
                existing.artist = artist_str or existing.artist
                existing.release_date = meta.get("release_date") or existing.release_date
                existing.release_date_precision = (
                    meta.get("release_date_precision") or existing.release_date_precision
                )
                existing.label = meta.get("label") or existing.label
                existing.popularity = meta.get("popularity") or existing.popularity
                existing.image_url = meta.get("image_url") or existing.image_url
                outcome = "updated"
                delta = {"updated_total": 1}
            else:
                session.add(AlbumCache(
                    spotify_id=meta["id"],
                    name=meta.get("name") or "",
                    artist=artist_str,
                    release_date=meta.get("release_date"),
                    release_date_precision=meta.get("release_date_precision"),
                    label=meta.get("label"),
                    popularity=meta.get("popularity"),
                    image_url=meta.get("image_url"),
                    enrichment_status="pending",
                ))
                outcome = "inserted"
                delta = {"inserted_total": 1}
            await session.commit()
        _record(_ALBUM_PERSIST, outcome=outcome, subject=meta["id"], **delta)
    except Exception as exc:
        _record(_ALBUM_PERSIST,
                outcome=f"errored: {type(exc).__name__}: {exc}",
                subject=meta.get("id"), errored_total=1)
        _log.warning("[spotify] persist album %s failed: %s", meta.get("id"), exc)


def _circuit_remaining() -> float:
    """Seconds until the circuit breaker re-closes. 0 when not tripped."""
    if _circuit_open_until == 0.0:
        return 0.0
    remaining = _circuit_open_until - time.time()
    return max(0.0, remaining)


def _trip_circuit(retry_after_seconds: int) -> None:
    """Open the circuit for the supplied duration, capped at
    _MAX_CIRCUIT_OPEN_SECONDS. No-op if the circuit is already open longer.
    """
    global _circuit_open_until
    capped = min(retry_after_seconds, _MAX_CIRCUIT_OPEN_SECONDS)
    new_deadline = time.time() + capped
    if new_deadline > _circuit_open_until:
        _circuit_open_until = new_deadline
        if capped < retry_after_seconds:
            _log.warning(
                "[spotify] CIRCUIT OPEN for %ds — CAPPED from Spotify's request of %ds "
                "(until %s). Will probe Spotify on next call past the cap regardless of "
                "their requested duration.",
                capped, retry_after_seconds,
                time.strftime("%H:%M:%S", time.localtime(_circuit_open_until)),
            )
        else:
            _log.warning(
                "[spotify] CIRCUIT OPEN for %ds (until %s). All Spotify calls will short-circuit.",
                capped, time.strftime("%H:%M:%S", time.localtime(_circuit_open_until)),
            )


def reset_circuit() -> None:
    """Force-close the circuit. Intended for one-off recovery after a known
    incident resolves (e.g. via an admin endpoint or a Railway redeploy
    hook). Safe to call when the circuit isn't open."""
    global _circuit_open_until
    if _circuit_open_until > time.time():
        _log.info(
            "[spotify] circuit manually reset (was open for %.0fs more)",
            _circuit_open_until - time.time(),
        )
    _circuit_open_until = 0.0


def _make_synthetic_429(url: str) -> httpx.Response:
    """Build a fake 429 response so circuit-tripped calls look like real ones."""
    return httpx.Response(
        429,
        headers={"Retry-After": str(int(_circuit_remaining()) or 1)},
        request=httpx.Request("GET", url),
    )


async def _spotify_get(client: httpx.AsyncClient, url: str, token: str, params: dict | None = None) -> httpx.Response:
    """GET wrapper with one automatic retry on 429 — only if the wait is short.

    If Retry-After > _MAX_RETRY_WAIT, returns the 429 response immediately so
    callers can fall back to DB/Redis without making the user wait.

    Also honors a process-level circuit breaker (skips the network when
    Spotify recently asked for a long backoff) and a concurrency semaphore
    (caps in-flight outbound calls so a traffic spike can't fire hundreds
    of parallel requests at once).
    """
    if _circuit_remaining() > 0:
        _log.debug("[spotify] circuit open (%ds left), short-circuiting %s", int(_circuit_remaining()), url)
        return _make_synthetic_429(url)

    headers = {"Authorization": f"Bearer {token}"}
    async with _get_semaphore():
        resp = await client.get(url, headers=headers, params=params)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", 8))
            # Long retry-after = credential-wide block. Open the circuit so the
            # next 100 callers don't each pay the round trip and keep extending it.
            if retry_after >= _CIRCUIT_BREAKER_THRESHOLD:
                _trip_circuit(retry_after)
            if retry_after > _MAX_RETRY_WAIT:
                _log.warning("[spotify] 429 on %s — Retry-After=%ds (>%ds threshold), bailing immediately", url, retry_after, _MAX_RETRY_WAIT)
                return resp  # caller will treat non-200 as failure and use DB
            _log.warning("[spotify] 429 on %s — Retry-After=%ds, waiting then retrying", url, retry_after)
            await asyncio.sleep(retry_after)
            resp = await client.get(url, headers=headers, params=params)
    return resp

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
    """Search Spotify for artists matching the query string. Results cached 7 days in Redis; also persisted permanently to DB by the search router."""
    cache_key = f"spotify:artist_search:{query.lower().strip()}:{limit}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        return cached

    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await _spotify_get(
            client, "https://api.spotify.com/v1/search", token,
            params={"q": query, "type": "artist", "limit": limit},
        )
        _log.debug("[spotify.search_artists] HTTP %d for q=%r", resp.status_code, query)
        resp.raise_for_status()
        items = resp.json()["artists"]["items"]

    result = [_parse_artist(a) for a in items]
    if result:
        await redis_cache.set(cache_key, result, ttl=604800)  # 7 days
    return result


async def get_artist(artist_id: str) -> dict:
    """Fetch artist metadata by Spotify artist ID. Cached 30d in Redis —
    artist genres are essentially frozen post-launch and the rest of the
    fields drift slowly enough that a month is a reasonable refresh window."""
    cache_key = f"spotify:artist:{artist_id}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        return cached
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await _spotify_get(client, f"https://api.spotify.com/v1/artists/{artist_id}", token)
        resp.raise_for_status()
        result = _parse_artist(resp.json())
    await redis_cache.set(cache_key, result, ttl=_TTL_30D)
    return result


async def get_album_tracks(album_id: str) -> list[dict]:
    """Fetch the tracklist for an album. Cached 30d — tracklists never change
    after release, and this is called every album page view."""
    cache_key = f"spotify:album_tracks:{album_id}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        return cached

    results = []
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        url = f"https://api.spotify.com/v1/albums/{album_id}/tracks"
        params = {"limit": 50}
        while url:
            resp = await _spotify_get(client, url, token, params=params)
            resp.raise_for_status()
            data = resp.json()
            results.extend(data.get("items", []))
            url = data.get("next")
            params = {}
    parsed = [
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
    if parsed:
        await redis_cache.set(cache_key, parsed, ttl=_TTL_30D)
    return parsed


async def search_tracks(query: str, limit: int = 10) -> list[dict]:
    """Search Spotify for tracks matching the query string. Results cached 7 days in Redis; also persisted permanently to DB by the search router."""
    cache_key = f"spotify:track_search:{query.lower().strip()}:{limit}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        return cached

    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await _spotify_get(
            client, "https://api.spotify.com/v1/search", token,
            params={"q": query, "type": "track", "limit": limit, "market": "US"},
        )
        _log.debug("[spotify.search_tracks] HTTP %d for q=%r", resp.status_code, query)
        resp.raise_for_status()
        items = resp.json().get("tracks", {}).get("items", [])

    result = [_parse_track(t) for t in items if t and t.get("id")]
    if result:
        await redis_cache.set(cache_key, result, ttl=604800)  # 7 days
    return result


async def get_track(track_id: str) -> dict:
    """Fetch full track metadata by Spotify track ID. Cached 30d in Redis;
    also persisted to TrackCache (DB) so every successful fetch survives
    Redis flushes and is essentially free forever afterward."""
    cache_key = f"spotify:track:{track_id}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        return cached
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        # market="US" — same reason as get_album. Without it, /v1/tracks/{id}
        # can 404 for region-restricted catalogs.
        resp = await _spotify_get(
            client,
            f"https://api.spotify.com/v1/tracks/{track_id}",
            token,
            params={"market": "US"},
        )
        resp.raise_for_status()
        result = _parse_track(resp.json())
    await redis_cache.set(cache_key, result, ttl=_TTL_30D)
    # Fire-and-forget DB write-through — caller doesn't wait, persistence
    # is best-effort and idempotent.
    asyncio.create_task(_persist_track_to_db(result))
    return result


async def get_tracks_batch(track_ids: list[str]) -> list[dict]:
    """
    Batch-fetch full track metadata for up to 50 track IDs in a single call.

    Uses /v1/tracks?ids=<comma-list> which returns FULL TrackObjects including
    `popularity` — unlike /v1/search?type=track, which Spotify's late-2024
    Web API changes appear to have stripped `popularity` from for non-Extended-
    Access apps. We use this endpoint for catalog popularity backfill: scan
    TrackCache for rows with popularity=NULL, send them through here, and
    upsert with the popularity value. 50 IDs per call is the documented max;
    callers needing more should chunk.

    Each successful result is also write-through persisted to TrackCache via
    the same idempotent path as get_track. Null entries in the response (for
    IDs Spotify doesn't recognize or that are region-restricted) are skipped.

    Returns the parsed tracks in the same order as the input IDs, filtering
    out any nulls. Errors are non-fatal — partial response is fine.
    """
    if not track_ids:
        return []
    # Spotify caps at 50; chunk if larger.
    chunks = [track_ids[i:i + 50] for i in range(0, len(track_ids), 50)]
    all_tracks: list[dict] = []
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        for chunk in chunks:
            try:
                resp = await _spotify_get(
                    client,
                    "https://api.spotify.com/v1/tracks",
                    token,
                    params={"ids": ",".join(chunk), "market": "US"},
                )
                resp.raise_for_status()
                tracks = resp.json().get("tracks", []) or []
                for t in tracks:
                    if t and t.get("id"):
                        parsed = _parse_track(t)
                        all_tracks.append(parsed)
                        # Fire-and-forget persist — same pattern as get_track.
                        asyncio.create_task(_persist_track_to_db(parsed))
            except Exception as exc:
                _log.warning("[spotify.get_tracks_batch] chunk failed: %s", exc)
                continue
    return all_tracks


async def search_albums(query: str, limit: int = 10) -> list[dict]:
    """Search Spotify for albums matching the query string. Cached 7d in Redis."""
    cache_key = f"spotify:album_search:{query.lower().strip()}:{limit}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        return cached

    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await _spotify_get(
            client, "https://api.spotify.com/v1/search", token,
            params={"q": query, "type": "album", "limit": limit, "market": "US"},
        )
        _log.debug("[spotify.search_albums] HTTP %d for q=%r", resp.status_code, query)
        if resp.status_code != 200:
            _log.warning("[spotify.search_albums] non-200 body: %s", resp.text[:500])
        resp.raise_for_status()
        items = resp.json().get("albums", {}).get("items", [])
        _log.debug("[spotify.search_albums] %d raw items for q=%r", len(items), query)

    result = [_parse_album(a) for a in items if a and a.get("id")]
    if result:
        await redis_cache.set(cache_key, result, ttl=_TTL_7D)
    return result


async def get_artist_albums_limited(artist_id: str, limit: int = 20) -> list[dict]:
    """Fetch up to `limit` albums for an artist by Spotify artist ID.
    Uses /artists/{id}/albums which works without Extended Access — unlike /search.
    Results cached 1 hour since album lists rarely change."""
    cache_key = f"spotify:artist_albums:{artist_id}:{limit}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        _log.debug("[spotify.get_artist_albums] cache hit for artist_id=%s", artist_id)
        return cached

    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await _spotify_get(
            client, f"https://api.spotify.com/v1/artists/{artist_id}/albums", token,
            params={"limit": limit},
        )
        _log.debug("[spotify.get_artist_albums] HTTP %d for artist_id=%s", resp.status_code, artist_id)
        if resp.status_code != 200:
            _log.warning("[spotify.get_artist_albums] error body: %s", resp.text[:300])
        resp.raise_for_status()
        items = resp.json().get("items", [])

    result = [_parse_album(a) for a in items if a and a.get("id")]
    if result:
        await redis_cache.set(cache_key, result, ttl=604800)  # 7 days
    return result


async def get_album(album_id: str) -> dict:
    """Fetch full album metadata by Spotify album ID. Cached 30d in Redis;
    also persisted to AlbumCache (DB) so every successful fetch survives
    Redis flushes.

    market="US" is required: Spotify's /v1/albums/{id} returns 404 without
    a market parameter for many albums (region-restricted catalogs, recent
    releases). Confirmed in production: folklore, UTOPIA, and similar
    high-profile albums 404'd via this endpoint until market was added.
    All other endpoints in this file already pass market — this one was
    the gap.
    """
    cache_key = f"spotify:album:{album_id}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        return cached
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await _spotify_get(
            client,
            f"https://api.spotify.com/v1/albums/{album_id}",
            token,
            params={"market": "US"},
        )
        resp.raise_for_status()
        result = _parse_album(resp.json())
    await redis_cache.set(cache_key, result, ttl=_TTL_30D)
    asyncio.create_task(_persist_album_to_db(result))
    return result


async def get_playlist_tracks(playlist_id: str, limit: int = 20) -> list[dict]:
    """
    Fetch tracks from any public Spotify playlist by ID.
    Use this instead of the deprecated /browse/new-releases endpoint.
    """
    cache_key = f"spotify:playlist:{playlist_id}:{limit}"
    cached = await redis_cache.get(cache_key)
    if cached:
        return cached

    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await _spotify_get(
            client, f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks", token,
            params={"limit": limit, "market": "US"},
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])

    tracks = []
    for item in items:
        t = item.get("track")
        if t and t.get("id"):
            tracks.append(_parse_track(t))

    if tracks:
        # New Music Friday is updated weekly — 1h TTL gives near-real-time
        # surfacing of new releases while still cutting load by ~600x.
        # Other playlists piggyback on this TTL; they're updated even less often.
        await redis_cache.set(cache_key, tracks, ttl=_TTL_1H)
    return tracks


async def get_new_releases(limit: int = 10) -> list[dict]:
    """
    Fetch newly released albums.
    NOTE: Spotify deprecated /browse/new-releases in March 2025.
    Falls back to the "New Music Friday" editorial playlist.
    """
    # New Music Friday US playlist — reliable editorial, updated weekly
    NEW_MUSIC_FRIDAY = "37i9dQZF1DX4JAvHpjipBk"
    tracks = await get_playlist_tracks(NEW_MUSIC_FRIDAY, limit=limit * 2)
    # Return unique album stubs so callers can do album_tracks lookups
    seen_albums: set[str] = set()
    albums = []
    for t in tracks:
        if t.get("album_id") and t["album_id"] not in seen_albums:
            seen_albums.add(t["album_id"])
            albums.append({"id": t["album_id"], "name": t.get("album_name", ""), "image_url": t.get("image_url")})
    return albums[:limit]


# Genre-slug → list of lowercase substrings that count as "artist tagged with
# this genre" when scanning Spotify's artist `genres` field. Used by
# _filter_pool_by_artist_genre to reject tracks whose primary artist isn't
# tagged with anything resembling the requested genre family.
#
# Spotify's artist genres are extremely fine-grained ("atlanta hip hop",
# "neo soul", "alternative r&b", "modern rock") — exact slug-equality misses
# most matches. The map maps each picker slug to the broader family of
# substrings that should count as on-genre.
#
# Defaults (when a slug isn't in the map): {slug, slug.replace("-"," ")}.
# That covers the simple cases ("pop"→"pop", "jazz"→"jazz") without needing
# an entry per slug. Add an entry only when the default would miss real
# matches — e.g. "hip-hop" needs to also catch "rap"/"trap"/"drill", which
# Spotify tags use without the words "hip hop".
_GENRE_MATCH_ALIASES: dict[str, list[str]] = {
    "hip-hop":      ["hip hop", "rap", "trap", "drill", "grime", "boom bap"],
    "r-n-b":        ["r&b", "rnb", "neo soul", "soul", "rhythm and blues"],
    "alternative":  ["alternative", "alt-", "alt rock", "alt pop", "alt metal"],
    "indie":        ["indie", "lo-fi", "bedroom pop"],
    "k-pop":        ["k-pop", "kpop", "korean"],
    "j-pop":        ["j-pop", "jpop", "japanese", "anime"],
    "country":      ["country", "americana", "bluegrass", "honky"],
    "folk":         ["folk", "singer-songwriter", "americana"],
    "electronic":   ["electronic", "edm", "house", "techno", "trance", "dubstep", "drum and bass", "dnb"],
    "house":        ["house", "deep house", "tech house"],
    "techno":       ["techno", "industrial"],
    "drum-and-bass":["drum and bass", "dnb", "jungle"],
    "dubstep":      ["dubstep", "brostep"],
    "trap":         ["trap"],
    "drill":        ["drill"],
    "lo-fi":        ["lo-fi", "lofi", "chillhop"],
    "shoegaze":     ["shoegaze", "dream pop"],
    "dream-pop":    ["dream pop", "shoegaze"],
    "post-punk":    ["post-punk", "post punk"],
    "punk":         ["punk", "hardcore"],
    "hardcore":     ["hardcore"],
    "emo":          ["emo", "screamo"],
    "prog-rock":    ["prog", "progressive rock"],
    "classical":    ["classical", "orchestral", "chamber", "opera", "baroque", "romantic era", "symphony"],
    "jazz":         ["jazz", "bebop", "swing", "bossa nova", "fusion"],
    "jazz-fusion":  ["fusion", "jazz fusion"],
    "soul":         ["soul", "neo soul", "motown"],
    "funk":         ["funk", "p funk"],
    "disco":        ["disco"],
    "new-wave":     ["new wave", "synthpop"],
    "synthpop":     ["synthpop", "synth-pop", "new wave"],
    "metal":        ["metal", "doom", "death metal", "black metal"],
    "blues":        ["blues"],
    "bluegrass":    ["bluegrass"],
    "gospel":       ["gospel", "worship", "christian"],
    "reggae":       ["reggae", "dancehall", "ska"],
    "dancehall":    ["dancehall"],
    "latin":        ["latin", "reggaeton", "salsa", "bachata", "cumbia", "merengue", "latino"],
    "reggaeton":    ["reggaeton", "latin urban"],
    "salsa":        ["salsa"],
    "bossa-nova":   ["bossa nova", "mpb", "brazilian"],
    "afrobeat":     ["afrobeat", "afropop", "afro"],
    "ambient":      ["ambient", "drone", "new age"],
    "experimental": ["experimental", "noise", "avant-garde"],
    "world":        ["world", "global"],
    "indie-rock":   ["indie rock", "indie"],
    "indie-pop":    ["indie pop", "indie"],
    "indie-folk":   ["indie folk", "indie"],
    "soundtrack":   ["soundtrack", "score", "film"],
}


def _genre_match_terms(slug: str) -> list[str]:
    """Lowercase substrings that count as "on-genre" when scanned against an
    artist's Spotify genres list. Looked up from _GENRE_MATCH_ALIASES; falls
    back to {slug, slug-as-spaces} for simple slugs not in the map."""
    s = slug.lower().strip()
    if s in _GENRE_MATCH_ALIASES:
        return _GENRE_MATCH_ALIASES[s]
    return [s, s.replace("-", " ")]


async def _fetch_and_persist_artist_genres(artist_ids: list[str]) -> dict[str, list[str]]:
    """Batched /v1/artists?ids=... — returns {artist_id: [lowercase genres]}.

    Used by search_tracks_by_genre to verify each candidate track's primary
    artist is tagged with the requested genre family. Spotify caps at 50 IDs
    per call; chunk if larger. Authoritative — Spotify's artist `genres` field
    is the source of truth for genre tagging.

    Side effect: write-through to ArtistCache so the catalog grows organically
    from every cold genre search. Subsequent searches against the same artist
    skip the network entirely (ArtistCache is treated as effectively permanent
    per artist_cache.META_TTL = 365d).

    Persistence: BULK upsert in one transaction per chunk (was previously
    fire-and-forget per artist via asyncio.create_task — that pattern lost
    ~92% of the writes to Python's GC of orphaned tasks, leaving ArtistCache
    with only 30 entries despite hundreds of artists fetched. The bulk
    upsert blocks until commit so the next caller can reliably read what
    the previous caller wrote.

    Returns {} on failure — callers treat that as "no data, don't filter."
    """
    if not artist_ids:
        return {}
    out: dict[str, list[str]] = {}
    chunks = [artist_ids[i:i + 50] for i in range(0, len(artist_ids), 50)]
    try:
        async with httpx.AsyncClient() as client:
            token = await _get_token(client)
            for chunk in chunks:
                try:
                    resp = await _spotify_get(
                        client, "https://api.spotify.com/v1/artists", token,
                        params={"ids": ",".join(chunk)},
                    )
                    resp.raise_for_status()
                    chunk_records: list[dict] = []
                    for a in (resp.json().get("artists") or []):
                        if a and a.get("id"):
                            genres = [
                                g.lower() for g in (a.get("genres") or [])
                                if isinstance(g, str)
                            ]
                            out[a["id"]] = genres
                            chunk_records.append({
                                "artist_id": a["id"],
                                "name": a.get("name") or a["id"],
                                "genres": genres,
                                "image_url": (a.get("images") or [{}])[0].get("url"),
                                "popularity": a.get("popularity"),
                            })
                    # Bulk upsert for this chunk — one transaction, all
                    # artists committed atomically before we move to the
                    # next Spotify call.
                    if chunk_records:
                        await _bulk_upsert_artists_to_cache(chunk_records)
                except Exception as exc:
                    _log.warning(
                        "[spotify._fetch_and_persist_artist_genres] chunk failed: %s", exc,
                    )
                    continue
    except Exception as exc:
        _log.warning("[spotify._fetch_and_persist_artist_genres] %s", exc)
    return out


async def _bulk_upsert_artists_to_cache(records: list[dict]) -> None:
    """Bulk upsert multiple artists to ArtistCache in one transaction.

    Replaces the fire-and-forget per-artist pattern that was losing writes
    to asyncio task GC. `records` is a list of dicts with keys
    {artist_id, name, genres, image_url, popularity}.

    Logic: SELECT all existing rows for these IDs in one query, build a
    diff (insert vs update), apply both, commit once. Idempotent — safe
    to call repeatedly with the same data.
    """
    if not records:
        return
    try:
        import json as _json
        from datetime import datetime
        from sqlalchemy import select
        from database import AsyncSessionLocal
        from models import ArtistCache

        ids = [r["artist_id"] for r in records]
        records_by_id = {r["artist_id"]: r for r in records}
        now = datetime.utcnow()

        async with AsyncSessionLocal() as session:
            existing = (await session.execute(
                select(ArtistCache).where(ArtistCache.spotify_id.in_(ids))
            )).scalars().all()
            existing_ids = {row.spotify_id for row in existing}

            # Update existing
            for row in existing:
                r = records_by_id[row.spotify_id]
                row.name = r["name"] or row.name
                row.genres = _json.dumps(r["genres"])
                if r.get("image_url"):
                    row.image_url = r["image_url"]
                if r.get("popularity") is not None:
                    row.popularity = r["popularity"]
                row.meta_fetched_at = now

            # Insert new
            for aid in ids:
                if aid in existing_ids:
                    continue
                r = records_by_id[aid]
                session.add(ArtistCache(
                    spotify_id=aid,
                    name=r["name"],
                    genres=_json.dumps(r["genres"]),
                    image_url=r.get("image_url"),
                    popularity=r.get("popularity"),
                    meta_fetched_at=now,
                ))

            await session.commit()
            _log.info(
                "[spotify._bulk_upsert_artists_to_cache] committed %d artists (%d new, %d updated)",
                len(records), len(records) - len(existing_ids), len(existing_ids),
            )
    except Exception as exc:
        _log.warning("[spotify._bulk_upsert_artists_to_cache] failed: %s", exc)


async def _persist_artist_to_cache(
    artist_id: str, name: str, genres: list[str],
    image_url: Optional[str], popularity: Optional[int],
) -> None:
    """Idempotent upsert of artist metadata to ArtistCache. Fire-and-forget
    from _fetch_and_persist_artist_genres so the catalog grows from genre
    searches. Mirrors the pattern in services/artist_cache.py but inlined
    here to avoid a circular import (artist_cache imports spotify)."""
    try:
        import json as _json
        from datetime import datetime
        from sqlalchemy import select
        from database import AsyncSessionLocal
        from models import ArtistCache

        async with AsyncSessionLocal() as session:
            row = (await session.execute(
                select(ArtistCache).where(ArtistCache.spotify_id == artist_id)
            )).scalar_one_or_none()
            now = datetime.utcnow()
            genres_json = _json.dumps(genres)
            if row:
                row.name = name or row.name
                row.genres = genres_json
                if image_url:
                    row.image_url = image_url
                if popularity is not None:
                    row.popularity = popularity
                row.meta_fetched_at = now
            else:
                session.add(ArtistCache(
                    spotify_id=artist_id,
                    name=name or artist_id,
                    genres=genres_json,
                    image_url=image_url,
                    popularity=popularity,
                    meta_fetched_at=now,
                ))
            await session.commit()
    except Exception as exc:
        _log.debug("[spotify._persist_artist_to_cache] %s failed: %s", artist_id, exc)


async def _filter_pool_by_artist_genre(
    pool: list[dict], requested_genre: str,
) -> list[dict]:
    """Drop tracks whose primary artist isn't tagged with the requested genre
    family. The biggest single source of "this isn't what I wanted" in the
    For You feed: Spotify's `/v1/search?type=track` ranks title-keyword and
    relevance matches above genre-tag relevance, so a "hip-hop" search pulls
    in cinematic-instrumental tracks named "Hip Hop" and rock tracks with
    rap-influenced production but no rap artist credit. This filter pins
    candidates to the requested genre by verifying each track's primary
    artist's Spotify `genres` tags.

    Tracks from unknown artists (not in ArtistCache, and not in the batched
    /v1/artists fetch's response) pass through — better than penalizing the
    cold-cache case and shrinking the pool prematurely.

    Safety floor: if filtering would leave fewer than 3 tracks, keep the
    original pool. A thin-but-genre-relevant pool is preferred over a
    full-but-misleading one, but reducing to 0–2 tracks per pool would
    starve downstream sampling.
    """
    if not pool:
        return pool

    # Collect primary artist IDs from the pool
    artist_ids: list[str] = []
    seen_ids: set[str] = set()
    for t in pool:
        aid = (t.get("artist_ids") or [None])[0]
        if aid and aid not in seen_ids:
            seen_ids.add(aid)
            artist_ids.append(aid)
    if not artist_ids:
        return pool

    # First check ArtistCache (DB) — covers artists the catalog has touched
    # before. Free; no Spotify call.
    artist_genres: dict[str, list[str]] = {}
    try:
        import json as _json
        from sqlalchemy import select
        from database import AsyncSessionLocal
        from models import ArtistCache

        async with AsyncSessionLocal() as session:
            rows = (await session.execute(
                select(ArtistCache.spotify_id, ArtistCache.genres)
                .where(ArtistCache.spotify_id.in_(artist_ids))
            )).all()
            for sid, genres_json in rows:
                if genres_json:
                    try:
                        artist_genres[sid] = [
                            g.lower() for g in _json.loads(genres_json)
                            if isinstance(g, str)
                        ]
                    except Exception:
                        continue
    except Exception as exc:
        _log.debug("[spotify._filter_pool_by_artist_genre] ArtistCache read failed: %s", exc)

    # Anything still unknown? Batched Spotify fetch. One call covers up to 50
    # artists. Cheap relative to the 3 search calls we already spent building
    # the pool, and the results persist to ArtistCache so we never spend it
    # again for these artists.
    missing = [a for a in artist_ids if a not in artist_genres]
    if missing:
        fetched = await _fetch_and_persist_artist_genres(missing)
        artist_genres.update(fetched)

    if not artist_genres:
        # No genre data anywhere — don't filter, the pool is what it is.
        return pool

    targets = _genre_match_terms(requested_genre)

    def _ok(t: dict) -> bool:
        aid = (t.get("artist_ids") or [None])[0]
        if not aid or aid not in artist_genres:
            return True  # unknown artist — don't penalize cold cache
        genres = artist_genres[aid]
        if not genres:
            # Artist exists in our cache but has zero genre tags. Common
            # for very small artists Spotify hasn't tagged yet. Keep them —
            # we'd rather under-filter than blackhole legit niche artists.
            return True
        return any(any(term in g for term in targets) for g in genres)

    filtered = [t for t in pool if _ok(t)]
    if len(filtered) >= 3:
        return filtered
    return pool


async def search_tracks_by_genre(
    genre: str,
    limit: int = 20,
    target_popularity: float | None = None,
    market: str = "US",
    year_range: str | None = None,
) -> list[dict]:
    """
    Genre-based track search with popularity-weighted sampling.

    Two-stage so niche-taste users actually get niche music while popular
    tracks still dominate (the user wants discovery, not random noise):

      1. CANDIDATE POOL (cached 7d per genre). Fetched in parallel from
         three queries that stratify across the popularity / recency
         space, then deduped by track ID:
           a. `{genre}`                 — default ranking, popular bias
           b. `{genre} tag:hipster`     — Spotify's documented low-pop
                                          filter; returns actual deep cuts
           c. `{genre} year:2023-2026`  — recent regardless of popularity
         Result: ~50-60 candidates covering the full popularity range,
         from chart-toppers down to tracks with popularity scores in the
         single digits.

      2. WEIGHTED SAMPLE (per call, fresh randomness). Sample `limit`
         tracks from the pool without replacement, weighted by a Laplace
         curve centered on the caller's preferred popularity:
             w(t) = exp(-|popularity(t) - target| / spread)
         with spread = 50 (gentle decay).

         `target_popularity` is the user's avg popularity-score across
         their 4–5★ rated tracks (computed in discover.py from the
         Rating join over TrackCache). Defaults to 70 when None — a
         mild mainstream lean appropriate for cold-start users with no
         signal yet. As the user rates, the curve adapts: a user whose
         avg liked-track popularity is 25 (consistent niche taste) sees
         pop-25 tracks ~38% of batches and chart-100 tracks only ~10%
         — pop dominance reversed without becoming uniform random.

         Numerical feel at target=70, spread=50:
             popularity 100 → weight 0.55
             popularity  70 → weight 1.00 (peak)
             popularity  30 → weight 0.45
             popularity   0 → weight 0.25
         And at target=25, spread=50:
             popularity 100 → weight 0.22
             popularity  25 → weight 1.00 (peak)
             popularity   0 → weight 0.61

      Sampling uses Efraimidis-Spirakis: key = U ** (1/w), sort
      descending, take top N. Standard weighted-reservoir-without-
      replacement; equivalent to drawing N times from the discrete
      distribution and removing the picked item each time, but in a
      single sort pass.

      Pool fetch is cached because it's the expensive part (3 Spotify
      calls). Sampling is per-call so every batch sees a different
      cross-section of the same pool — AND the curve is per-user so
      two users with the same seed genre but different rating histories
      see different cross-sections.

      Earlier versions: `{genre} hits` (forced popularity skew + the
      word "hits" prepended into the query); per-call random.choice
      between three query variants (1/3-chance batches were all-one-
      kind); then a fixed `w(p) = (p+10)**0.7` curve (popular favored
      but uniform across users, no adaptation to taste).
    """
    # Synthetic popularity: Spotify gated real `popularity` behind Extended
    # Access in late-2024. Without it the Laplace curve becomes uniform
    # sampling (every track gets the same weight) — algorithm degrades to
    # random pick. To preserve the popularity gradient we synthesize a
    # popularity value from which query variant returned the track AND
    # its rank within that variant's results. Spotify search returns
    # tracks ordered by their internal popularity-weighted relevance, so
    # rank is a usable proxy.
    #
    #   `{genre}` default ranking:
    #     rank 0 → synth 90 (top hit in genre)
    #     rank 29 → synth 30 (still relevant but less popular)
    #   `{genre} tag:hipster` (low-popularity filter):
    #     rank 0 → synth 5  (deepest cut)
    #     rank 29 → synth 40 (edge of mainstream)
    #   `{genre} year:2023-2026` (recent):
    #     rank 0 → synth 70 (popular recent)
    #     rank 29 → synth 40 (less popular recent)
    #
    # If Spotify ever returns real popularity again (Extended Access
    # approval, policy change), the real value is preserved — synth only
    # fills the None case.
    # v5: cache key now varies by market so English (US) and Spanish (ES)
    # pools cache independently. Without this the first user to scroll
    # would lock the cache to their market for 7d, and subsequent users
    # on different language settings would get the wrong region's
    # popular tracks. Bumped from v4 since the cache-key shape changed.
    # year_range pins all variant queries to a year-of-release range — e.g.
    # "1980-1989" for a user with a concentrated 80s decade preference. When
    # set, the cache key forks so a hipster sample from one decade doesn't
    # bleed into another decade's pool. The "recent (year:2023-2026)"
    # variant is dropped in year-locked mode because it'd contradict the
    # user's explicit decade pick.
    # v7: pool depth expanded from ~30 → ~50 candidates per genre. The
    # previous version fired 3 (or 2 vintage) Spotify search variants each
    # at offset=0, which capped the pool at 30 candidates. For active
    # raters whose exclude_ids covered the top 20-30 hip-hop tracks, that
    # left ~0 fresh tracks → tier 1 yielded empty → eventually nuclear
    # fallback served country chart hits ("Warming up the feed" / "all
    # mainstream pop" complaints, 2026-05-18).
    # v7 uses offset-based variants to slide deeper into Spotify's ranking:
    # the same {genre} query at offsets 0, 10, 20 gives ranks 1-30 from
    # the same relevance ordering, all in one cache entry. Cache invalidates
    # v6 to force a rebuild with the new depth.
    if year_range:
        cache_key = f"spotify:genre_pool_v7:{genre}:{market}:y{year_range}"
    else:
        cache_key = f"spotify:genre_pool_v7:{genre}:{market}"
    pool = await redis_cache.get(cache_key)

    if not pool:
        # Each variant: (query_string, synth_pop_at_rank_0, synth_pop_at_last_rank, offset)
        # The synth_pop values cover the popularity gradient we'd EXPECT from
        # each query type: a default `{genre}` query at offset=0 returns the
        # most-popular tracks (synth=90), and at offset=20 returns ranks
        # 21-30 which are still relevant but less popular (synth=50→20).
        # The tag:hipster variant explicitly biases toward low-popularity
        # tracks (synth=5→40). The year:2023-2026 variant biases toward
        # recent popular (synth=70→40).
        if year_range:
            variants = [
                (f"{genre} year:{year_range}", 90, 30, 0),
                (f"{genre} year:{year_range}", 60, 20, 10),
                (f"{genre} year:{year_range}", 30, 10, 20),
                (f"{genre} tag:hipster year:{year_range}", 5, 40, 0),
                (f"{genre} tag:hipster year:{year_range}", 5, 35, 10),
            ]
        else:
            variants = [
                (genre, 90, 30, 0),
                (genre, 60, 20, 10),
                (genre, 30, 10, 20),
                (f"{genre} tag:hipster", 5, 40, 0),
                (f"{genre} year:2023-2026", 70, 40, 0),
            ]
        async with httpx.AsyncClient() as client:
            token = await _get_token(client)
            responses = await asyncio.gather(*[
                _spotify_get(
                    client, "https://api.spotify.com/v1/search", token,
                    # limit=10 is the cap for our app tier (see CLAUDE.md
                    # + memory note). market param defaults to "US" but is
                    # configurable so Spanish-mode requests pass "ES" and
                    # get Spanish-region-popular tracks at the top of
                    # Spotify's ranking instead of US-region tracks.
                    # offset slides the window deeper into Spotify's
                    # relevance ranking — offset=10 returns ranks 11-20
                    # of the SAME query, offset=20 returns 21-30. This
                    # is how we get pool depth without changing the
                    # query string (which would shift relevance).
                    params={"q": q, "type": "track", "limit": 10, "market": market, "offset": off},
                )
                for q, _, _, off in variants
            ], return_exceptions=True)

        seen: set[str] = set()
        pool = []
        for (q, pop_start, pop_end, _), resp in zip(variants, responses):
            if isinstance(resp, Exception):
                continue
            try:
                items = resp.json().get("tracks", {}).get("items", [])
            except Exception:
                continue
            n = max(len(items) - 1, 1)
            for rank, t in enumerate(items):
                if t and t.get("id") and t["id"] not in seen:
                    seen.add(t["id"])
                    parsed = _parse_track(t)
                    # Synthesize popularity if Spotify didn't include it
                    # (the common case post late-2024 for non-Extended-
                    # Access apps). Linear interpolation across the variant's
                    # rank range.
                    if parsed.get("popularity") is None:
                        ratio = rank / n
                        synth = pop_start + (pop_end - pop_start) * ratio
                        parsed["popularity"] = max(0, min(100, int(round(synth))))
                    pool.append(parsed)

        # Filter out tracks where the genre keyword appears in track name,
        # artist name, OR album name. Spotify's text search rewards literal
        # matches on any of those fields, which fills the pool with tracks
        # NAMED after the genre rather than tracks IN the genre. Without
        # this filter:
        #   - "hip-hop" query returned: "Hip Hop" by Trinix, "Hip-Hop" by
        #     Lil Wayne, "Hip-hop/Jwk" by Ntitled
        #   - "classical" query returned: "Classical Gas" by Mason Williams,
        #     "Classical" by Vampire Weekend
        # Worse: a user who picks BOTH hip-hop AND classical was seeing rap
        # tracks with the word "classical" in their title surfaced under the
        # classical search because Spotify ranks title-keyword matches above
        # genre-tag relevance. The filter scope is now ALL three text fields
        # (track / artist / album) so a rap song called "Classical Flow"
        # gets dropped from the classical pool regardless of which field
        # carries the keyword.
        #
        # Safety threshold dropped from 8 → 3: for niche genres like
        # "classical" or "shoegaze" the entire raw pool can be keyword-
        # stuffed, and the old threshold kept the stuffed tracks rather
        # than serve a thin pool. A thin-but-genre-relevant pool beats a
        # full-but-misleading pool — the sampling step draws 15 per call
        # and we have downstream tiers (Deezer chart) to fill any
        # shortfall.
        if pool:
            genre_keyword = genre.lower().strip()
            keyword_variants = {
                genre_keyword,
                genre_keyword.replace("-", " "),
                genre_keyword.replace("-", ""),
                genre_keyword.replace(" ", "-"),
            }

            def _has_genre_keyword(t):
                # Track name + artist name only. Album name is intentionally
                # excluded — diagnostic showed it has a high false-positive
                # rate on compilation albums: Beethoven's Für Elise from
                # "Classical Best Of", Bach's Orchestral Suite from
                # "Classical Music in Bloom", Gymnopédie from "Classical
                # Baby : Classical Lullabies" — all legit classical tracks
                # we'd be dropping because someone's compilation namesake
                # uses the genre word. The keyword-stuffing problem we
                # actually want to catch is in track titles ("Classical
                # Dragon" by a metal band) and artist names ("Hip-hop/Jwk")
                # — those stay filtered.
                fields = [
                    (t.get("name") or "").lower(),
                    " ".join(t.get("artists") or []).lower(),
                ]
                return any(
                    kw and any(kw in f for f in fields)
                    for kw in keyword_variants
                )

            filtered = [t for t in pool if not _has_genre_keyword(t)]
            if len(filtered) >= 3:
                pool = filtered

        # Artist-genre verification — drop tracks whose primary artist's
        # Spotify-tagged genres don't overlap with the requested genre
        # family. Catches the cases keyword-stuffing detection misses:
        # a rock track that shows up on a "hip-hop" search because the
        # producer used hip-hop drums and Spotify's relevance ranker
        # surfaced it; or a movie-score cue named after a genre by an
        # artist with no rap discography. Filter scope is the primary
        # artist only (track["artist_ids"][0]) — features can mix
        # genres legitimately and we don't want to drop a "hip-hop"
        # track because a guest is tagged "pop".
        pool = await _filter_pool_by_artist_genre(pool, genre)

        if pool:  # don't cache an empty pool — let next call retry
            await redis_cache.set(cache_key, pool, ttl=_TTL_7D)
            # Write-through to TrackCache so the catalog grows organically
            # from every fresh genre search. Fire-and-forget per track so the
            # response isn't blocked on DB writes. _persist_track_to_db is an
            # idempotent upsert that preserves existing popularity if the new
            # meta has None — important because /v1/search appears to strip
            # popularity for non-Extended-Access apps post late-2024.
            for t in pool:
                asyncio.create_task(_persist_track_to_db(t))
            # Popularity enrichment: fire one batched /v1/tracks call for the
            # full pool. That endpoint returns the FULL TrackObject including
            # popularity, which /v1/search no longer does for our app tier.
            # Without this every new catalog entry lands with null popularity
            # and is useless to the Laplace popularity-weighted sampling that
            # ranks the candidate pool. get_tracks_batch fire-and-forgets its
            # own _persist_track_to_db calls, so the popularity column gets
            # filled in within a second or two of the search response.
            pool_ids = [t["id"] for t in pool if t.get("id")]
            if pool_ids:
                asyncio.create_task(get_tracks_batch(pool_ids))

    if not pool:
        return []

    # Clamp target to the actual popularity range so a stray value
    # doesn't put the Laplace peak off the curve entirely.
    target = 70.0 if target_popularity is None else float(target_popularity)
    target = max(0.0, min(100.0, target))
    spread = 50.0

    def _weight(t: dict) -> float:
        # popularity can be None for very obscure tracks; treat as 30 so
        # they're in play but not over-weighted toward the niche side.
        p = t.get("popularity")
        if p is None:
            p = 30
        return math.exp(-abs(p - target) / spread)

    # random.random() returns [0.0, 1.0). 0.0 ** anything = 0 which sorts
    # to the bottom — fine, just means that track loses this round. The
    # max(weight, 1e-6) guard prevents 1.0/weight from blowing up if the
    # curve ever produces a vanishingly small number (shouldn't happen at
    # spread=50, but cheap insurance).
    keyed = [
        (random.random() ** (1.0 / max(_weight(t), 1e-6)), t)
        for t in pool
    ]
    keyed.sort(key=lambda x: x[0], reverse=True)
    return [t for _, t in keyed[:limit]]


async def get_global_top_tracks(limit: int = 10) -> list[dict]:
    """
    Fetch popular tracks via search.

    The editorial playlist approach (/v1/playlists/{id}/tracks) returns 403
    for Spotify apps that haven't been through Extended Access review.
    The search endpoint works reliably with client credentials.
    """
    cache_key = f"spotify:popular_search:{limit}"
    cached = await redis_cache.get(cache_key)
    if cached:
        return cached

    # Rotate queries so the feed has variety across cache TTL windows
    queries = ["top hits", "global chart hits", "viral songs", "popular music 2024 2025"]
    all_tracks: list[dict] = []
    seen_ids: set[str] = set()

    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        for q in queries:
            if len(all_tracks) >= limit * 3:
                break
            resp = await _spotify_get(
                client, "https://api.spotify.com/v1/search", token,
                params={"q": q, "type": "track", "limit": 20, "market": "US"},
            )
            if resp.status_code != 200:
                continue
            items = resp.json().get("tracks", {}).get("items", [])
            for t in items:
                if t and t.get("id") and t["id"] not in seen_ids:
                    seen_ids.add(t["id"])
                    all_tracks.append(_parse_track(t))

    if all_tracks:
        await redis_cache.set(cache_key, all_tracks, ttl=_TTL_24H)
    return all_tracks[:limit]


async def get_artist_top_tracks(artist_id: str, market: str = "US") -> list[dict]:
    """Fetch an artist's top 10 tracks from Spotify. Cached 7d — top tracks
    shift weekly at most."""
    cache_key = f"spotify:artist_top:{artist_id}:{market}"
    cached = await redis_cache.get(cache_key)
    if cached:  # guard: don't use an empty cached result
        return cached

    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await _spotify_get(
            client, f"https://api.spotify.com/v1/artists/{artist_id}/top-tracks", token,
            params={"market": market},
        )
        resp.raise_for_status()
        tracks = resp.json().get("tracks", [])
    result = [_parse_track(t) for t in tracks[:10]]
    if result:  # only cache non-empty results
        await redis_cache.set(cache_key, result, ttl=_TTL_7D)
    return result


async def get_related_artists(artist_id: str) -> list[str]:
    """
    Return up to 10 artist IDs related to the given artist.

    Spotify deprecated /artists/{id}/related-artists for new client-credentials
    apps in late 2024 — it now returns 404 for most callers. We catch that
    explicitly so the discover feed can fall back to genre-based seeding
    instead of silently producing zero candidates.
    """
    cache_key = f"spotify:related:{artist_id}"
    cached = await redis_cache.get(cache_key)
    if cached:  # guard: don't use an empty cached result
        return cached

    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        resp = await _spotify_get(
            client, f"https://api.spotify.com/v1/artists/{artist_id}/related-artists", token,
        )
        if resp.status_code in (403, 404):
            _log.warning(
                "[spotify] /related-artists returned %d for %s — endpoint is "
                "deprecated for non-Extended-Access apps; tier 1 will use "
                "genre fallback",
                resp.status_code, artist_id,
            )
            return []
        resp.raise_for_status()
        artists = resp.json().get("artists", [])
    result = [a["id"] for a in artists[:10]]
    if result:  # only cache non-empty results
        await redis_cache.set(cache_key, result)
    return result


async def get_artist_albums(artist_id: str) -> list[dict]:
    """
    Fetch all albums for an artist by their Spotify artist ID.
    Paginates through results using limit=20 per page.
    Uses _spotify_get for 429 handling; raises on persistent failure.
    """
    cache_key = f"spotify:artist_albums_full:{artist_id}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        return cached

    results = []
    async with httpx.AsyncClient() as client:
        token = await _get_token(client)
        url = f"https://api.spotify.com/v1/artists/{artist_id}/albums"
        params: dict = {"limit": 20}
        while url:
            resp = await _spotify_get(client, url, token, params=params)
            if resp.status_code != 200:
                _log.warning("[spotify.get_artist_albums] HTTP %d: %s", resp.status_code, resp.text[:200])
            resp.raise_for_status()
            data = resp.json()
            results.extend(data.get("items", []))
            url = data.get("next")
            params = {}  # next URL already includes pagination params

    parsed = [_parse_album(a) for a in results]
    if parsed:
        await redis_cache.set(cache_key, parsed, ttl=604800)  # 7 days
    return parsed


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
        resp = await _spotify_get(
            client, f"https://api.spotify.com/v1/albums/{album_id}", token,
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
        # ISRC is the canonical international identifier for a recording —
        # used to match Spotify tracks to Apple Music songs reliably.
        "isrc": t.get("external_ids", {}).get("isrc"),
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
