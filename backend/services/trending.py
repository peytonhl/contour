"""Trending computation — most-rated albums, top reviews, most-backlogged,
and most-searched in a rolling window.

The window auto-expands if a window yields fewer than MIN_ITEMS results so
sparse-data days still surface *something* on the trending hub. The actual
window used is returned so the UI can label honestly ("Trending recently"
vs. "Trending this week").

All endpoints in routers/trending.py go through `compute()` here and the
results are wrapped in a 1-hour Redis cache by the router layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    AlbumCache,
    BacklogItem,
    Rating,
    Review,
    ReviewVote,
    SearchEvent,
    TrackCache,
    User,
)

# Minimum results before we expand the window.
MIN_ITEMS = 5

WINDOWS: dict[str, Optional[timedelta]] = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "all": None,
}

# Cascade of fallbacks if the requested window is too sparse.
_FALLBACK_ORDER = ["24h", "7d", "30d", "all"]


def _since(window: str) -> Optional[datetime]:
    delta = WINDOWS.get(window)
    if delta is None:
        return None
    return datetime.utcnow() - delta


def _windows_to_try(requested: str) -> list[str]:
    """Return the list of windows to try, in order, starting from `requested`."""
    if requested not in _FALLBACK_ORDER:
        requested = "7d"
    idx = _FALLBACK_ORDER.index(requested)
    return _FALLBACK_ORDER[idx:]


# Public label shown to the UI for each fallback bucket.
_LABEL = {
    "24h": "Trending today",
    "7d": "Trending this week",
    "30d": "Trending recently",
    "all": "Popular on Contour",
}


def label_for(window: str) -> str:
    return _LABEL.get(window, "Popular on Contour")


@dataclass
class TrendingResult:
    items: list[dict]
    actual_window_used: str
    label: str


async def _album_meta_map(db: AsyncSession, album_ids: list[str]) -> dict[str, AlbumCache]:
    if not album_ids:
        return {}
    rows = (await db.execute(
        select(AlbumCache).where(AlbumCache.spotify_id.in_(album_ids))
    )).scalars().all()
    return {r.spotify_id: r for r in rows}


def _album_to_dict(row: Optional[AlbumCache], album_id: str) -> dict:
    if row is None:
        return {"id": album_id, "name": None, "artist": None, "image_url": None}
    return {
        "id": row.spotify_id,
        "name": row.name,
        "artist": row.artist,
        "image_url": row.image_url,
        "release_date": row.release_date,
    }


# Track-meta companion to _album_meta_map / _album_to_dict. Added so the
# trending_reviews path can resolve track entities — previously track
# reviews fell through with entity_meta=None and the frontend rendered
# the raw Spotify ID (22-char string) as the entity name. Now track
# reviews surface their actual track name + cover, mirroring how album
# reviews already worked.
async def _track_meta_map(db: AsyncSession, track_ids: list[str]) -> dict[str, TrackCache]:
    if not track_ids:
        return {}
    rows = (await db.execute(
        select(TrackCache).where(TrackCache.spotify_id.in_(track_ids))
    )).scalars().all()
    return {r.spotify_id: r for r in rows}


def _track_to_dict(row: Optional[TrackCache], track_id: str) -> dict:
    if row is None:
        return {"id": track_id, "name": None, "artist": None, "image_url": None}
    return {
        "id": row.spotify_id,
        "name": row.name,
        "artist": row.artist,
        "image_url": row.image_url,
        "release_date": row.release_date,
    }


async def trending_albums(db: AsyncSession, window: str, limit: int) -> TrendingResult:
    """Albums ranked by # of new ratings within the window."""
    for w in _windows_to_try(window):
        since = _since(w)
        stmt = (
            select(Rating.entity_id, func.count(Rating.id).label("cnt"))
            .where(Rating.entity_type == "album")
            .group_by(Rating.entity_id)
            .order_by(func.count(Rating.id).desc())
            .limit(limit)
        )
        if since is not None:
            stmt = stmt.where(Rating.created_at >= since)
        rows = (await db.execute(stmt)).all()
        if len(rows) >= MIN_ITEMS or w == "all":
            album_ids = [r.entity_id for r in rows]
            meta_map = await _album_meta_map(db, album_ids)
            items = [
                {**_album_to_dict(meta_map.get(r.entity_id), r.entity_id), "rating_count": int(r.cnt)}
                for r in rows
            ]
            return TrendingResult(items=items, actual_window_used=w, label=label_for(w))
    return TrendingResult(items=[], actual_window_used="all", label=label_for("all"))


async def trending_reviews(db: AsyncSession, window: str, limit: int) -> TrendingResult:
    """Reviews with the highest (upvotes - downvotes) in the window."""
    for w in _windows_to_try(window):
        since = _since(w)
        stmt = select(Review).order_by(Review.created_at.desc()).limit(200)
        if since is not None:
            stmt = stmt.where(Review.created_at >= since)
        reviews = (await db.execute(stmt)).scalars().all()
        if not reviews and w != "all":
            continue
        if not reviews:
            return TrendingResult(items=[], actual_window_used=w, label=label_for(w))

        review_ids = [r.id for r in reviews]
        vote_rows = (await db.execute(
            select(ReviewVote.review_id, ReviewVote.value)
            .where(ReviewVote.review_id.in_(review_ids))
        )).all()
        score_map: dict[int, int] = {}
        for rv in vote_rows:
            score_map[rv.review_id] = score_map.get(rv.review_id, 0) + (1 if rv.value == 1 else -1)

        user_ids = list({r.user_id for r in reviews})
        users = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        user_map = {u.id: u for u in users}

        # Resolve entity metadata for BOTH track and album reviews.
        # Previously this only batched album lookups; track reviews fell
        # through with entity_meta=None and the frontend rendered the
        # raw 22-char Spotify ID as the entity name (reported case:
        # "Top reviews" section showed "393OFJFZKIIv66JmJcNm9D" etc.
        # for 6 of 7 rows — all the track reviews).
        album_ids = [r.entity_id for r in reviews if r.entity_type == "album"]
        track_ids = [r.entity_id for r in reviews if r.entity_type == "track"]
        album_meta_map = await _album_meta_map(db, album_ids)
        track_meta_map = await _track_meta_map(db, track_ids)

        def _entity_meta_for(r: Review) -> Optional[dict]:
            if r.entity_type == "album":
                return _album_to_dict(album_meta_map.get(r.entity_id), r.entity_id)
            if r.entity_type == "track":
                return _track_to_dict(track_meta_map.get(r.entity_id), r.entity_id)
            return None

        scored = [
            {
                "id": r.id,
                "body": r.body,
                "created_at": r.created_at.isoformat() + "Z",
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "entity_meta": _entity_meta_for(r),
                "score": score_map.get(r.id, 0),
                "user": {
                    "id": r.user_id,
                    "display_name": user_map[r.user_id].display_name if r.user_id in user_map else "Unknown",
                    "image_url": user_map[r.user_id].image_url if r.user_id in user_map else None,
                },
            }
            for r in reviews
        ]
        scored.sort(key=lambda x: (x["score"], x["created_at"]), reverse=True)
        items = scored[:limit]
        if len(items) >= MIN_ITEMS or w == "all":
            return TrendingResult(items=items, actual_window_used=w, label=label_for(w))
    return TrendingResult(items=[], actual_window_used="all", label=label_for("all"))


async def trending_backlogged(db: AsyncSession, window: str, limit: int) -> TrendingResult:
    """Albums most-added to backlogs within the window.

    Album-only by design: ranking individual tracks by "wants to listen"
    activity isn't a meaningful surface (people backlog albums, mostly), and
    mixing the two would produce a noisy hub. Track backlog entries still show
    on individual profiles — they're just not aggregated here.
    """
    for w in _windows_to_try(window):
        since = _since(w)
        stmt = (
            select(BacklogItem.entity_id, func.count(BacklogItem.id).label("cnt"))
            .where(BacklogItem.entity_type == "album")
            .group_by(BacklogItem.entity_id)
            .order_by(func.count(BacklogItem.id).desc())
            .limit(limit)
        )
        if since is not None:
            stmt = stmt.where(BacklogItem.added_at >= since)
        rows = (await db.execute(stmt)).all()
        if len(rows) >= MIN_ITEMS or w == "all":
            album_ids = [r.entity_id for r in rows]
            meta_map = await _album_meta_map(db, album_ids)
            items = [
                {**_album_to_dict(meta_map.get(r.entity_id), r.entity_id), "backlog_count": int(r.cnt)}
                for r in rows
            ]
            return TrendingResult(items=items, actual_window_used=w, label=label_for(w))
    return TrendingResult(items=[], actual_window_used="all", label=label_for("all"))


async def trending_searched(db: AsyncSession, window: str, limit: int) -> TrendingResult:
    """Search queries appearing most often within the window."""
    for w in _windows_to_try(window):
        since = _since(w)
        stmt = (
            select(SearchEvent.query, func.count(SearchEvent.id).label("cnt"))
            .group_by(SearchEvent.query)
            .order_by(func.count(SearchEvent.id).desc())
            .limit(limit)
        )
        if since is not None:
            stmt = stmt.where(SearchEvent.created_at >= since)
        rows = (await db.execute(stmt)).all()
        if len(rows) >= MIN_ITEMS or w == "all":
            items = [{"query": r.query, "count": int(r.cnt)} for r in rows]
            return TrendingResult(items=items, actual_window_used=w, label=label_for(w))
    return TrendingResult(items=[], actual_window_used="all", label=label_for("all"))


async def popular_in_backlogs_excluding(
    db: AsyncSession, exclude_user_id: str, limit: int,
) -> list[dict]:
    """Top backlogged albums NOT currently in `exclude_user_id`'s backlog.

    Powers the "Popular in backlogs" section at the bottom of a user's Backlog
    tab — discovery via what others are saving. Auto-expands to all-time because
    this is a recommendation surface, not a trend.
    """
    # Album-only — see note on trending_backlogged.
    own_ids = set((await db.execute(
        select(BacklogItem.entity_id).where(
            BacklogItem.user_id == exclude_user_id,
            BacklogItem.entity_type == "album",
        )
    )).scalars().all())

    rows = (await db.execute(
        select(BacklogItem.entity_id, func.count(BacklogItem.id).label("cnt"))
        .where(BacklogItem.entity_type == "album")
        .group_by(BacklogItem.entity_id)
        .order_by(func.count(BacklogItem.id).desc())
        .limit(limit * 3)  # fetch extra so filter doesn't starve us
    )).all()

    filtered = [r for r in rows if r.entity_id not in own_ids][:limit]
    album_ids = [r.entity_id for r in filtered]
    meta_map = await _album_meta_map(db, album_ids)
    return [
        {**_album_to_dict(meta_map.get(r.entity_id), r.entity_id), "backlog_count": int(r.cnt)}
        for r in filtered
    ]
