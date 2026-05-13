"""
Audio preview proxy.

Some external preview CDNs (Deezer's `dzcdn.net`, Spotify's `scdn.co`)
have started restricting direct cross-origin playback from browsers.
Symptoms include:

  Uncaught (in promise) DOMException: The media resource indicated by
  the src attribute or assigned media provider object was not suitable.

Browsers refuse the resource when the response isn't recognizable as
audio (wrong Content-Type), or when cross-origin checks fail. This
endpoint sidesteps both by fetching the preview through our backend
and streaming it back with a clean `audio/mpeg` Content-Type and a
permissive CORS header — to the browser the audio appears to come
from our own origin.

Usage from the frontend:
    /audio-proxy?url=<URL-encoded preview URL>

Hosts are whitelisted to prevent abuse — only Deezer + Spotify preview
CDNs are allowed.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["audio"])

# Only proxy preview URLs from known music-platform CDNs. Anything else gets
# a 403 — prevents this endpoint from being abused as an open relay.
_ALLOWED_HOST_SUFFIXES = (
    "dzcdn.net",   # Deezer preview CDNs (cdns-preview-X.dzcdn.net etc.)
    "scdn.co",     # Spotify preview CDNs (p.scdn.co/mp3-preview/...)
)


@router.get("/audio-proxy")
async def audio_proxy(url: str = Query(..., description="URL to the preview MP3")):
    """Stream a preview MP3 from an allowed CDN through this endpoint."""
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http(s) URLs allowed")

    host = parsed.netloc.lower()
    if not any(host.endswith(suffix) for suffix in _ALLOWED_HOST_SUFFIXES):
        logger.warning("audio_proxy: rejected host %s for url %s", host, url[:100])
        raise HTTPException(status_code=403, detail="URL host not on allowlist")

    async def stream_audio():
        # Per-stream client so we can hold the connection open for the
        # full duration of the 30s preview without blocking other requests.
        # connect=5s, read=15s — generous for cold-cache Deezer responses
        # but bounded so a hung upstream doesn't hold the worker forever.
        timeout = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            try:
                async with client.stream("GET", url) as resp:
                    if resp.status_code != 200:
                        logger.warning(
                            "audio_proxy: upstream %s returned %d for %s",
                            host, resp.status_code, url[:100],
                        )
                        return
                    async for chunk in resp.aiter_bytes(chunk_size=16_384):
                        yield chunk
            except httpx.HTTPError as exc:
                logger.warning(
                    "audio_proxy: stream failure for %s — %s",
                    url[:100], exc,
                )
                return

    # Always serve as audio/mpeg — the upstream CDN sometimes returns
    # text/html on errors which the browser then can't decode. Locking
    # the Content-Type means at worst the browser tries to decode an
    # error page as audio (and fails cleanly) instead of refusing to
    # play because of a wrong type.
    return StreamingResponse(
        stream_audio(),
        media_type="audio/mpeg",
        headers={
            # Tell browsers + intermediaries this can be cached for a day.
            # Preview MP3s are immutable — same URL → same bytes forever.
            "Cache-Control": "public, max-age=86400",
            # Permissive CORS so the audio element doesn't trip over
            # Origin headers in any Capacitor / WebView combination.
            "Access-Control-Allow-Origin": "*",
        },
    )
