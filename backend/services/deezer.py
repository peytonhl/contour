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
import re
import time

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

# Deezer preview URLs are Akamai-signed and short-lived: the URL carries
# an `hdnea=exp=<unix_ts>` parameter and the CDN returns HTTP 403 +
# text/html once that timestamp has passed. Browsers surface the 403
# as MEDIA_ERR_SRC_NOT_SUPPORTED ("media resource not suitable").
#
# We must therefore cap any Redis TTL at the signed-URL lifetime. A 60s
# safety margin keeps us from handing out a URL that expires mid-flight
# while the browser is still buffering.
_SIGNED_URL_TTL_SAFETY_MARGIN = 60
# Fallback TTL when a preview URL has no parseable `exp=` — short enough
# that a misparse doesn't reintroduce the 30-day-stale-URL bug.
_UNSIGNED_URL_FALLBACK_TTL = 600  # 10 min
_HDNEA_EXP_RE = re.compile(r"hdnea=[^&]*?exp=(\d+)")


def _signed_url_ttl(url: str | None) -> int:
    """
    Return how long a Deezer preview URL is safe to cache, in seconds.

    Parses the `hdnea=exp=<unix_ts>` Akamai signature parameter and
    returns `exp - now - safety_margin`, floored at 60s. URLs without a
    parseable expiry fall back to a short default.
    """
    if not url:
        return _UNSIGNED_URL_FALLBACK_TTL
    m = _HDNEA_EXP_RE.search(url)
    if not m:
        return _UNSIGNED_URL_FALLBACK_TTL
    try:
        remaining = int(m.group(1)) - int(time.time()) - _SIGNED_URL_TTL_SAFETY_MARGIN
    except ValueError:
        return _UNSIGNED_URL_FALLBACK_TTL
    return max(60, remaining)

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
            # Cap the TTL at the shortest signed-URL lifetime across the
            # batch. Caching longer than that would resurrect the bug
            # where the browser receives an expired URL and rejects the
            # response as "media resource not suitable".
            ttl = min(_signed_url_ttl(t["preview_url"]) for t in result)
            await redis_cache.set(cache_key, result, ttl=ttl)
        return result
    except Exception:
        return []


async def get_chart_tracks(limit: int = 50) -> list[dict]:
    """
    Return Deezer's global chart tracks (real chart data, not a text search).
    Avoids the "Top Hits band" problem caused by searching the string "top hits".

    TTL is capped at the shortest signed-URL expiry across the batch
    (typically ~15 min) rather than a fixed 24h. We _could_ cache the chart
    rows longer since chart positions don't shift hour-to-hour, but the
    Akamai-signed preview URLs embedded in each row expire fast, so the
    whole payload has to roll over together to avoid serving an expired
    preview. See `_signed_url_ttl()` for the math.
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
            # Same constraint as search_tracks — chart data changes
            # slowly but the embedded preview URLs expire fast.
            ttl = min(_signed_url_ttl(t["preview_url"]) for t in result)
            await redis_cache.set(cache_key, result, ttl=ttl)
        return result
    except Exception:
        return []


def _normalize_for_match(s: str) -> str:
    """Lowercase + strip punctuation + collapse whitespace.

    Used to compare a Deezer search result's title/artist against what we
    asked for, to catch cross-track contamination where Deezer's relevance
    ranks an unrelated more-popular track above the actual match.

    Aggressive but safe:
      - lowercase
      - strip "(feat. ...)", "(ft. ...)", "(with ...)" parentheticals
        (Spotify and Deezer disagree wildly on these)
      - drop everything except alphanumerics + spaces
      - collapse whitespace runs to a single space
    """
    s = s.lower()
    s = re.sub(r"\((?:feat|ft|with)\.?\s[^)]*\)", " ", s)
    s = re.sub(r"\[(?:feat|ft|with)\.?\s[^\]]*\]", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _is_match(asked_track: str, asked_artist: str, got_track: str, got_artist: str) -> bool:
    """True if the Deezer search result is a plausible match for what we
    asked for.

    Title: normalized-equal OR one contains the other (handles version
    suffixes like "Honey Bun (Remastered)" vs "Honey Bun"). NOT a generic
    substring — that'd let "Honey" match "Honeysuckle Rose".

    Artist: normalized-equal OR substring (handles "Kodak Black, Drake"
    on one side vs "Kodak Black" on the other, common for features).
    """
    a_track = _normalize_for_match(asked_track)
    a_artist = _normalize_for_match(asked_artist)
    g_track = _normalize_for_match(got_track)
    g_artist = _normalize_for_match(got_artist)
    if not a_track or not g_track:
        return False
    title_ok = (
        a_track == g_track
        or g_track.startswith(a_track + " ")
        or a_track.startswith(g_track + " ")
    )
    artist_ok = (
        not a_artist
        or a_artist == g_artist
        or a_artist in g_artist
        or g_artist in a_artist
    )
    return title_ok and artist_ok


async def get_preview(track_name: str, artist_name: str) -> str | None:
    """
    Search Deezer for a matching track and return its 30-second preview URL.
    Returns None if no match is found or the request fails.

    Cached at the Akamai-signed URL expiry (~15-30 min) for hits, 7d for
    misses. Called as a fallback for Spotify tracks missing preview_url
    after their late-2023 API change, so every For You card potentially
    fires one of these on first show.

    **Important match-quality detail.** Earlier versions of this function
    sent a free-text query (`{artist} {track}`) with `limit=1` and used
    whatever came back. Deezer's relevance ranker would sometimes float
    an unrelated more-popular track above the actual match — e.g.
    searching `Kodak Black Honey Bun` returned "ZEZE" because ZEZE has
    higher popularity. We then cached ZEZE's preview URL under
    `deezer:preview:kodak black:honey bun` and served it on every
    Honey Bun card view. (Reported 2026-05-27.)
    """
    cache_key = f"deezer:preview:{artist_name.lower().strip()}:{track_name.lower().strip()}"
    cached = await redis_cache.get(cache_key)
    if cached is not None:
        # Cache hit (could be a real URL or an explicit empty-string sentinel
        # marking a previous miss — both are valid "we already tried this" signals)
        return cached or None

    # Use Deezer's strict-field syntax to anchor matching at the API
    # level: `artist:"X" track:"Y"`. Falls back to free-text on no hit
    # (a few rare tracks are findable only by free-text — most aren't,
    # but the fallback costs little). Either way the response is
    # validated against the asked-for (track, artist) below before
    # we accept the preview URL.
    strict_query = f'artist:"{artist_name}" track:"{track_name}"'
    result: str | None = None
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            # First pass: strict
            resp = await client.get(_BASE, params={"q": strict_query, "limit": 3})
            resp.raise_for_status()
            items = resp.json().get("data", [])
            # Fallback: free-text + accept only if title/artist match
            if not items:
                resp = await client.get(
                    _BASE,
                    params={"q": f"{artist_name} {track_name}", "limit": 5},
                )
                resp.raise_for_status()
                items = resp.json().get("data", [])

            for item in items:
                got_title = item.get("title") or ""
                got_artist = (item.get("artist") or {}).get("name") or ""
                preview = item.get("preview")
                if preview and _is_match(track_name, artist_name, got_title, got_artist):
                    result = preview
                    break
    except Exception:
        pass

    # Hits are capped at the signed-URL expiry (Deezer issues Akamai-signed
    # URLs valid for ~15-30 min — caching longer would hand the browser an
    # expired URL that returns 403 + text/html, surfacing as
    # MEDIA_ERR_SRC_NOT_SUPPORTED). Negative results stay cached 7d so we
    # don't keep retrying broken matches but eventually re-check.
    ttl = _signed_url_ttl(result) if result else 604_800
    await redis_cache.set(cache_key, result or "", ttl=ttl)
    return result
