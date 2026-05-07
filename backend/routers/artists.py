"""Artist search, metadata, and discography endpoints."""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import delete, select
from database import get_db
from models import ArtistFavorite
from services import spotify
from services import album_cache as cache
from routers.albums import _enrich_album
from routers.auth import optional_user_id
from services.normalization import parse_release_date
from data.spotify_mau import get_mau_for_date

router = APIRouter(prefix="/artists", tags=["artists"])


class ArtistResult(BaseModel):
    id: str
    name: str
    genres: List[str]
    followers: Optional[int]
    popularity: Optional[int]
    image_url: Optional[str]
    external_url: Optional[str]


class ArtistAlbum(BaseModel):
    id: str
    name: str
    release_date: str
    total_tracks: Optional[int]
    image_url: Optional[str]
    popularity: Optional[int]
    streams: Optional[int]
    era_adjusted_streams: Optional[int] = None
    multiplier: Optional[float] = None
    enrichment_status: str


@router.get("/search", response_model=List[ArtistResult])
async def search_artists(q: str = Query(..., min_length=1)):
    results = await spotify.search_artists(q)
    return results or []


@router.get("/{artist_id}", response_model=ArtistResult)
async def get_artist(artist_id: str):
    try:
        return await spotify.get_artist(artist_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{artist_id}/top-tracks")
async def get_artist_top_tracks(artist_id: str):
    """Return the artist's top 10 tracks from Spotify."""
    try:
        return await spotify.get_artist_top_tracks(artist_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/{artist_id}/albums", response_model=List[ArtistAlbum])
async def get_artist_albums(
    artist_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Return full discography with cached stream counts.
    Triggers background Kworb enrichment for any un-cached albums.
    """
    try:
        albums = await spotify.get_artist_albums(artist_id)
    except Exception as e:
        print(f"[artists] Spotify failed for {artist_id}: {e} — falling back to DB cache", flush=True)
        # Fall back to whatever we have cached in AlbumCache rather than crashing the page
        from sqlalchemy import select as sa_select
        from models import AlbumCache as AlbumCacheModel
        db_rows = (await db.execute(
            sa_select(AlbumCacheModel)
            .where(AlbumCacheModel.artist.ilike(f"%{artist_id}%"))
            .limit(50)
        )).scalars().all()
        if not db_rows:
            # Nothing cached — return empty list, don't crash
            return []
        albums = [
            {"id": r.spotify_id, "name": r.name, "artists": [r.artist], "artist_ids": [],
             "release_date": r.release_date or "", "release_date_precision": r.release_date_precision or "year",
             "image_url": r.image_url, "popularity": r.popularity, "total_tracks": None}
            for r in db_rows
        ]

    current_mau = get_mau_for_date(date.today())

    results = []
    for album in albums:
        row = await cache.upsert_album(db, album)
        if cache.needs_enrichment(row):
            background_tasks.add_task(_enrich_album, album["id"], album, db)

        streams = cache.streams_for_album(row)
        era_adjusted = None
        multiplier = None
        if streams:
            rd = album.get("release_date", "")
            rdp = album.get("release_date_precision", "year")
            release = parse_release_date(rd, rdp)
            if release:
                release_mau = get_mau_for_date(release)
                if release_mau > 0:
                    multiplier = round(current_mau / release_mau, 1)
                    era_adjusted = int(streams * multiplier)

        results.append(ArtistAlbum(
            id=album["id"],
            name=album["name"],
            release_date=album.get("release_date", ""),
            total_tracks=album.get("total_tracks"),
            image_url=album.get("image_url"),
            popularity=album.get("popularity"),
            streams=streams,
            era_adjusted_streams=era_adjusted,
            multiplier=multiplier,
            enrichment_status=row.enrichment_status,
        ))

    # Sort by release date descending (newest first)
    results.sort(key=lambda a: a.release_date, reverse=True)
    return results


@router.get("/{artist_id}/favorite")
async def get_favorite(
    artist_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        return {"favorited": False}
    result = await db.execute(
        select(ArtistFavorite).where(
            ArtistFavorite.user_id == user_id,
            ArtistFavorite.artist_id == artist_id,
        )
    )
    return {"favorited": result.scalar_one_or_none() is not None}


@router.post("/{artist_id}/favorite")
async def toggle_favorite(
    artist_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Sign in to favorite artists")

    result = await db.execute(
        select(ArtistFavorite).where(
            ArtistFavorite.user_id == user_id,
            ArtistFavorite.artist_id == artist_id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        await db.execute(
            delete(ArtistFavorite).where(
                ArtistFavorite.user_id == user_id,
                ArtistFavorite.artist_id == artist_id,
            )
        )
        favorited = False
    else:
        db.add(ArtistFavorite(user_id=user_id, artist_id=artist_id))
        favorited = True

    await db.commit()
    return {"favorited": favorited}
