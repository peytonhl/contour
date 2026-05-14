"""Spotify Web API client — album search and metadata."""

from __future__ import annotations

import asyncio
import base64
import logging
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
                existing.popularity = meta.get("popularity")
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


async def search_tracks_by_genre(genre: str, limit: int = 20) -> list[dict]:
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
         tracks from the pool without replacement, weighted by
             w(t) = (popularity + 10) ** 0.7
         The exponent < 1 flattens the curve so the tail has real
         probability. Numerical feel:
             popularity 85 → weight ≈ 23
             popularity 50 → weight ≈ 17
             popularity 15 → weight ≈ 9
             popularity  5 → weight ≈ 6
         So a chart track is ~3-4x more likely than a popularity-5
         deep cut to land in a given slot — not 17x as linear weighting
         would give, not 1x as uniform would give. Niche users keep
         seeing popular-of-the-niche AND obscure-of-the-niche in every
         batch, and the long tail is in genuine rotation rather than
         being a 1/3 lottery for the whole call.

      Sampling uses Efraimidis-Spirakis: key = U ** (1/w), sort
      descending, take top N. Standard weighted-reservoir-without-
      replacement; equivalent to drawing N times from the discrete
      distribution and removing the picked item each time, but in a
      single sort pass.

      Pool fetch is cached because it's the expensive part (3 Spotify
      calls). Sampling is per-call so every batch sees a different
      cross-section of the same pool.

      Earlier versions: `{genre} hits` (forced popularity skew + the
      word "hits" prepended into the query — niche users saw chart-of-
      niche every batch); then a per-call random.choice between three
      queries (better but still 1/3 chance of an all-mainstream batch
      for the whole genre tier).
    """
    cache_key = f"spotify:genre_pool_v2:{genre}"
    pool = await redis_cache.get(cache_key)

    if not pool:
        queries = (
            genre,
            f"{genre} tag:hipster",
            f"{genre} year:2023-2026",
        )
        async with httpx.AsyncClient() as client:
            token = await _get_token(client)
            responses = await asyncio.gather(*[
                _spotify_get(
                    client, "https://api.spotify.com/v1/search", token,
                    params={"q": q, "type": "track", "limit": 30, "market": "US"},
                )
                for q in queries
            ], return_exceptions=True)

        seen: set[str] = set()
        pool = []
        for resp in responses:
            if isinstance(resp, Exception):
                continue
            try:
                items = resp.json().get("tracks", {}).get("items", [])
            except Exception:
                continue
            for t in items:
                if t and t.get("id") and t["id"] not in seen:
                    seen.add(t["id"])
                    pool.append(_parse_track(t))

        if pool:  # don't cache an empty pool — let next call retry
            await redis_cache.set(cache_key, pool, ttl=_TTL_7D)

    if not pool:
        return []

    def _weight(t: dict) -> float:
        # popularity can be None for very obscure tracks; treat as mid-low
        # so they're in play but not over-weighted.
        p = t.get("popularity")
        if p is None:
            p = 30
        return (p + 10) ** 0.7

    # random.random() returns [0.0, 1.0). 0.0 ** anything = 0 which sorts
    # to the bottom — fine, just means that track loses this round.
    keyed = [(random.random() ** (1.0 / _weight(t)), t) for t in pool]
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
