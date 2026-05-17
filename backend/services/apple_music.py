"""
Apple Music catalog matching — Spotify → Apple Music ID resolution.

Catalog-only: this module never touches user data. No MusicKit user sign-in,
no playlists, no library access. All we want is the Apple Music canonical ID
for an album or track so the frontend can open a deep link
(music.apple.com/{storefront}/album/{id}).

Match strategy (best to worst):
  1. ISRC — Spotify exposes the ISRC of a track. Apple's
     /v1/catalog/{storefront}/songs?filter[isrc]={isrc} returns the matching
     song, whose relationships.albums points at the album. This is the gold
     standard match.
  2. Text — artist + name search via /v1/catalog/{storefront}/search.
     Less reliable but usually correct for big releases.
  3. None — cache a negative result so we don't retry on every page load.

Apple Music API auth: a developer JWT signed with ES256 using a private key
from the Apple Developer portal. Env vars required to activate:
  - APPLE_MUSIC_TEAM_ID
  - APPLE_MUSIC_KEY_ID
  - APPLE_MUSIC_PRIVATE_KEY  (the PEM contents of the .p8 file)

When any of those is unset, `is_configured()` returns False and the routers
skip matching, returning 404 to the frontend so the button stays hidden.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

import httpx
import jwt

logger = logging.getLogger(__name__)


APPLE_MUSIC_API_BASE = "https://api.music.apple.com/v1"
DEFAULT_STOREFRONT = "us"

# Dev token's max lifetime per Apple is 6 months; refresh well before that.
_DEV_TOKEN_TTL_SECONDS = 6 * 30 * 24 * 60 * 60
_DEV_TOKEN_REFRESH_MARGIN_SECONDS = 24 * 60 * 60

_dev_token_cache: dict = {"token": None, "expires_at": 0}


def is_configured() -> bool:
    return all(
        os.environ.get(k)
        for k in ("APPLE_MUSIC_TEAM_ID", "APPLE_MUSIC_KEY_ID", "APPLE_MUSIC_PRIVATE_KEY")
    )


def _get_dev_token() -> str:
    """Mint or return a cached developer token signed with ES256."""
    now = time.time()
    cached = _dev_token_cache.get("token")
    if cached and _dev_token_cache["expires_at"] - _DEV_TOKEN_REFRESH_MARGIN_SECONDS > now:
        return cached

    team_id = os.environ["APPLE_MUSIC_TEAM_ID"]
    key_id = os.environ["APPLE_MUSIC_KEY_ID"]
    private_key = os.environ["APPLE_MUSIC_PRIVATE_KEY"].replace("\\n", "\n")

    expires_at = int(now) + _DEV_TOKEN_TTL_SECONDS
    token = jwt.encode(
        {"iss": team_id, "iat": int(now), "exp": expires_at},
        private_key,
        algorithm="ES256",
        headers={"kid": key_id, "alg": "ES256"},
    )
    _dev_token_cache["token"] = token
    _dev_token_cache["expires_at"] = expires_at
    return token


async def _apple_get(client: httpx.AsyncClient, path: str, **params) -> Optional[dict]:
    """GET helper that returns the JSON body or None on any non-200."""
    try:
        resp = await client.get(
            f"{APPLE_MUSIC_API_BASE}{path}",
            headers={"Authorization": f"Bearer {_get_dev_token()}"},
            params={k: v for k, v in params.items() if v is not None},
            timeout=10.0,
        )
    except httpx.HTTPError as e:
        logger.warning("apple_music GET %s failed: %s", path, e)
        return None
    if resp.status_code != 200:
        logger.info("apple_music GET %s → %d", path, resp.status_code)
        return None
    return resp.json()


# Apple Music's CDN serves templated URLs of the form
# https://is1-ssl.mzstatic.com/.../{w}x{h}bb.jpg — we substitute a fixed
# render size. 1200×1200 comfortably covers the largest mobile usage
# (~3x DPR at a ~400 CSS-px hero) without bloating the payload. Apple's
# upper bound is typically 3000 if a source is needed for desktop later.
_ARTWORK_RENDER_SIZE = 1200


def _extract_artwork_url(item: dict, size: int = _ARTWORK_RENDER_SIZE) -> Optional[str]:
    """Pull a sized Apple Music artwork URL from an item's attributes.artwork.

    The CDN treats `{w}` / `{h}` as substitution tokens; replacing both with
    `size` returns a JPEG at that resolution. Returns None when no artwork
    is present (rare — usually only on unreleased / region-locked items).
    """
    artwork = (item.get("attributes") or {}).get("artwork") or {}
    template = artwork.get("url")
    if not template:
        return None
    return template.replace("{w}", str(size)).replace("{h}", str(size))


def _extract_release_date(item: dict) -> Optional[str]:
    """Apple Music's attributes.releaseDate, generally the original release
    year for vintage catalog (Apple curates this more carefully than Spotify,
    which uses the upload date). Format is "YYYY-MM-DD" or "YYYY-MM" or
    "YYYY" depending on what Apple has. The discover decade ranker only
    parses the leading year so all three forms work."""
    if not item:
        return None
    attrs = item.get("attributes") or {}
    rd = attrs.get("releaseDate")
    if isinstance(rd, str) and rd.strip():
        return rd.strip()
    return None


async def match_track_by_isrc(isrc: str, storefront: str = DEFAULT_STOREFRONT) -> Optional[dict]:
    """Resolve a Spotify track to an Apple Music song by ISRC.

    Returns {track_id, album_id, artwork_url, release_date} — artwork_url is
    the album cover (Apple songs use the album image), sized to
    _ARTWORK_RENDER_SIZE. release_date is Apple's date for the song; for
    vintage catalog this is generally the original release year rather than
    a remaster/reissue date.
    """
    if not isrc:
        return None
    async with httpx.AsyncClient() as client:
        body = await _apple_get(
            client,
            f"/catalog/{storefront}/songs",
            **{"filter[isrc]": isrc, "include": "albums"},
        )
    if not body:
        return None
    data = body.get("data") or []
    if not data:
        return None
    song = data[0]
    album_id = None
    rels = (song.get("relationships") or {}).get("albums", {}).get("data") or []
    if rels:
        album_id = rels[0].get("id")
    return {
        "track_id": song["id"],
        "album_id": album_id,
        "artwork_url": _extract_artwork_url(song),
        "release_date": _extract_release_date(song),
    }


async def search_by_text(
    name: str,
    artist: str,
    entity_type: str,
    storefront: str = DEFAULT_STOREFRONT,
) -> Optional[dict]:
    """Text fallback. Returns {id, artwork_url} for the first match, or None."""
    if not name:
        return None
    types = "albums" if entity_type == "album" else "songs"
    term = f"{artist} {name}".strip() if artist else name
    async with httpx.AsyncClient() as client:
        body = await _apple_get(
            client,
            f"/catalog/{storefront}/search",
            term=term,
            types=types,
            limit=1,
        )
    if not body:
        return None
    results = (body.get("results") or {}).get(types) or {}
    items = results.get("data") or []
    if not items:
        return None
    item = items[0]
    if not item.get("id"):
        return None
    return {
        "id": item.get("id"),
        "artwork_url": _extract_artwork_url(item),
        "release_date": _extract_release_date(item),
    }


async def fetch_artwork_for_id(
    apple_music_id: str,
    entity_type: str,
    storefront: str = DEFAULT_STOREFRONT,
) -> Optional[str]:
    """Look up artwork URL by Apple Music ID. Used to backfill existing
    cache rows that predate the artwork_url column on AppleMusicLink.

    One Apple API call per backfilled entity. Cheap and one-shot — once
    the row gets its URL, future hits return from the cache."""
    if not apple_music_id:
        return None
    resource = "albums" if entity_type == "album" else "songs"
    async with httpx.AsyncClient() as client:
        body = await _apple_get(client, f"/catalog/{storefront}/{resource}/{apple_music_id}")
    if not body:
        return None
    data = body.get("data") or []
    if not data:
        return None
    return _extract_artwork_url(data[0])


def deep_link(entity_type: str, apple_music_id: str, storefront: str = DEFAULT_STOREFRONT) -> str:
    """Build the music.apple.com deep link for a given Apple Music ID."""
    path = "album" if entity_type == "album" else "song"
    return f"https://music.apple.com/{storefront}/{path}/{apple_music_id}"
