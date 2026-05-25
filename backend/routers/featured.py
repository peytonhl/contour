"""Featured content — new releases and global top tracks."""

import asyncio
import logging

from fastapi import APIRouter
from services import apple_music, spotify

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/featured", tags=["featured"])


# Cap concurrent Spotify resolutions when warming the cache. search_albums
# is Redis-cached 7d per query so steady-state is free, but on a cold
# build we'd fire one per Apple chart item. Three at a time keeps the
# circuit-breaker safe while still finishing in <1s.
_RESOLVE_SEM = asyncio.Semaphore(3)


async def _resolve_apple_item_to_spotify(item: dict) -> dict | None:
    """Take an Apple Music chart stub and try to find the matching
    Spotify album ID by name+artist text search. Returns a
    frontend-shaped stub ({id, name, image_url}) on success, None
    on no match.

    Routing rationale: the SearchPage FeaturedCard navigates to
    `/album/{id}`, which expects a Spotify album ID. The Apple chart
    gives us Apple IDs that 404 against that route. Search-by-text
    is the simplest bridge — Spotify's relevance ranking is good
    enough for chart-popular albums that the first result is almost
    always correct. Wrong matches are visible (cover swaps to a
    different album); not silent corruption.

    Uses spotify.search_albums which is Redis-cached 7d per query.
    So even a 50-album warm-up only fires ~50 Spotify searches once
    per week.
    """
    term = f'{item["artist"]} {item["name"]}'.strip()
    if not term:
        return None
    async with _RESOLVE_SEM:
        try:
            results = await spotify.search_albums(term, limit=3)
        except Exception as exc:
            logger.debug("[featured] search_albums(%r) threw: %s", term, exc)
            return None
    if not results:
        return None
    # Take the first result. Could be smarter (match on artist name
    # equality, prefer release_date within N days of Apple's), but
    # the chart's popularity bias makes the first hit reliable in
    # practice. Future tuning point if we see wrong-album matches.
    match = results[0]
    return {
        "id": match["id"],
        "name": match.get("name") or item["name"],
        # Prefer Apple's artwork (1200×1200, sharper on high-DPR
        # mobile) over Spotify's 640 ceiling when both are present.
        "image_url": item.get("image_url") or match.get("image_url"),
    }


async def _get_apple_resolved_new_releases(limit: int) -> list[dict]:
    """Apple Music chart → Spotify-resolved stub list. Empty list on
    any failure so /featured stays renderable."""
    if not apple_music.is_configured():
        return []
    # Over-fetch by 2× so we have headroom to drop unresolvable items
    # while still hitting the requested `limit`.
    apple_items = await apple_music.get_new_releases(limit=limit * 2)
    if not apple_items:
        return []
    resolved = await asyncio.gather(
        *[_resolve_apple_item_to_spotify(it) for it in apple_items],
        return_exceptions=False,  # _resolve already catches; gather
                                   # would just propagate None
    )
    return [r for r in resolved if r][:limit]


@router.get("")
async def get_featured():
    """Return new releases and global top tracks for the homepage.

    new_releases is sourced from Apple Music's albums chart now —
    Spotify's editorial playlist endpoint was gated behind Extended
    Access in late 2024 and our previous source (New Music Friday)
    started returning 403 silently. Apple Music's chart endpoint is
    open at the developer-token tier we already have configured for
    cover-art matching.

    Apple stubs are resolved to Spotify album IDs via
    spotify.search_albums (cached 7d) so the frontend's existing
    /album/{id} routing works unchanged — no UI plumbing for two
    different ID namespaces.

    Both sources fire in parallel and degrade independently via
    return_exceptions=True. Empty new_releases doesn't take out
    top_tracks; empty top_tracks doesn't take out new_releases.
    The endpoint always returns 200 with whatever data was
    available.
    """
    results = await asyncio.gather(
        _get_apple_resolved_new_releases(limit=8),
        spotify.get_global_top_tracks(limit=8),
        return_exceptions=True,
    )
    new_releases, top_tracks = results

    if isinstance(new_releases, Exception):
        logger.warning("[featured] new_releases pipeline failed: %s", new_releases)
        new_releases = []
    if isinstance(top_tracks, Exception):
        logger.warning("[featured] get_global_top_tracks failed: %s", top_tracks)
        top_tracks = []

    return {
        "new_releases": new_releases,
        "top_tracks": top_tracks,
    }
