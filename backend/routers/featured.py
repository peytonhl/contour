"""Featured content — new releases and global top tracks."""

import asyncio
import logging

from fastapi import APIRouter
from services import spotify

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/featured", tags=["featured"])


@router.get("")
async def get_featured():
    """Return new releases and global top tracks for the homepage.

    Both sources are independent; treat each one's failure as
    "no data" rather than letting an exception bubble up into a
    500. Spotify gates editorial-playlist endpoints behind Extended
    Access (which we don't have), so get_new_releases periodically
    returns nothing — the page should still render with at least
    the global top tracks. Pre-2026-05-25 this endpoint was a 500
    whenever get_new_releases threw; callers (Search/Trending
    featured carousels) saw a generic homepage error instead of
    degraded content. return_exceptions=True is the fix.
    """
    results = await asyncio.gather(
        spotify.get_new_releases(limit=8),
        spotify.get_global_top_tracks(limit=8),
        return_exceptions=True,
    )
    new_releases, top_tracks = results

    if isinstance(new_releases, Exception):
        logger.warning("[featured] get_new_releases failed: %s", new_releases)
        new_releases = []
    if isinstance(top_tracks, Exception):
        logger.warning("[featured] get_global_top_tracks failed: %s", top_tracks)
        top_tracks = []

    return {
        "new_releases": new_releases,
        "top_tracks": top_tracks,
    }
