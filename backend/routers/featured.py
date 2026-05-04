"""Featured content — new releases and global top tracks."""

from fastapi import APIRouter
from services import spotify

router = APIRouter(prefix="/featured", tags=["featured"])


@router.get("")
async def get_featured():
    """Return new releases and global top tracks for the homepage."""
    new_releases, top_tracks = await __import__("asyncio").gather(
        spotify.get_new_releases(limit=8),
        spotify.get_global_top_tracks(limit=8),
    )
    return {
        "new_releases": new_releases,
        "top_tracks": top_tracks,
    }
