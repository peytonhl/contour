"""Trending hub endpoints — albums, reviews, backlogged, searched.

Heavy lifting lives in services/trending.py; this router only handles I/O,
caching, and request validation.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from routers.auth import optional_user_id
from services import redis_cache, trending
from services.limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/trending", tags=["trending"])

WINDOWS = {"24h", "7d", "30d", "all"}

# 1-hour TTL. The data underlying these endpoints (ratings, reviews, etc.)
# changes constantly but trending charts feel stale at sub-minute granularity
# anyway, and they're hit on every Search/ForYou page load.
TTL = 3600


def _cache_key(name: str, window: str, limit: int) -> str:
    return f"trending:{name}:{window}:{limit}"


async def _cached(name: str, window: str, limit: int, compute):
    key = _cache_key(name, window, limit)
    cached = await redis_cache.get(key)
    if cached is not None:
        return cached
    result = await compute()
    await redis_cache.set(key, result, ttl=TTL)
    return result


def _normalize_window(window: str) -> str:
    return window if window in WINDOWS else "7d"


@router.get("/albums")
@limiter.limit("30/minute")
async def trending_albums_endpoint(
    request: Request,
    window: str = Query("7d"),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    window = _normalize_window(window)

    async def compute():
        result = await trending.trending_albums(db, window, limit)
        return {
            "items": result.items,
            "actual_window_used": result.actual_window_used,
            "label": result.label,
        }

    return await _cached("albums", window, limit, compute)


@router.get("/reviews")
@limiter.limit("30/minute")
async def trending_reviews_endpoint(
    request: Request,
    window: str = Query("7d"),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    window = _normalize_window(window)

    async def compute():
        result = await trending.trending_reviews(db, window, limit)
        return {
            "items": result.items,
            "actual_window_used": result.actual_window_used,
            "label": result.label,
        }

    return await _cached("reviews", window, limit, compute)


@router.get("/backlogged")
@limiter.limit("30/minute")
async def trending_backlogged_endpoint(
    request: Request,
    window: str = Query("7d"),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    window = _normalize_window(window)

    async def compute():
        result = await trending.trending_backlogged(db, window, limit)
        return {
            "items": result.items,
            "actual_window_used": result.actual_window_used,
            "label": result.label,
        }

    return await _cached("backlogged", window, limit, compute)


@router.get("/searched")
@limiter.limit("30/minute")
async def trending_searched_endpoint(
    request: Request,
    window: str = Query("7d"),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    window = _normalize_window(window)

    async def compute():
        result = await trending.trending_searched(db, window, limit)
        return {
            "items": result.items,
            "actual_window_used": result.actual_window_used,
            "label": result.label,
        }

    return await _cached("searched", window, limit, compute)


@router.get("/backlog-suggestions")
@limiter.limit("30/minute")
async def backlog_suggestions(
    request: Request,
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """Most-backlogged albums that the current user has NOT added to theirs.

    Returns an empty list for logged-out users (the suggestion is personalized
    to "things you haven't already saved").
    """
    if not user_id:
        return {"items": []}
    # Per-user, so not cached — and small (limit ≤ 20).
    items = await trending.popular_in_backlogs_excluding(db, user_id, limit)
    return {"items": items}
