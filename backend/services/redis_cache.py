"""
Redis response cache — optional, 24-hour TTL by default.

If REDIS_URL is not set (local dev, or Railway without a Redis plugin)
every operation silently no-ops: cache misses fall through to live
Spotify API calls exactly as before.

Add a Redis plugin in Railway > New > Database > Redis and the
REDIS_URL environment variable is set automatically.
"""

import json
import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

_redis = None
_disabled = False

TTL_24H = 86_400  # seconds


async def _client():
    global _redis, _disabled
    if _disabled:
        return None
    if _redis is not None:
        return _redis

    url = os.environ.get("REDIS_URL")
    if not url:
        _disabled = True
        return None

    try:
        import redis.asyncio as aioredis  # type: ignore
        _redis = aioredis.from_url(url, encoding="utf-8", decode_responses=True)
        await _redis.ping()
        logger.info("Redis cache connected.")
        return _redis
    except Exception as exc:
        logger.warning("Redis unavailable — caching disabled: %s", exc)
        _disabled = True
        return None


async def get(key: str) -> Optional[Any]:
    """Return cached value or None on miss / error."""
    try:
        r = await _client()
        if r is None:
            return None
        raw = await r.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def set(key: str, value: Any, ttl: int = TTL_24H) -> None:
    """Store value under key with TTL in seconds (default 24 h)."""
    try:
        r = await _client()
        if r is None:
            return
        await r.setex(key, ttl, json.dumps(value, default=str))
    except Exception:
        pass


async def delete(key: str) -> None:
    """Drop a cached entry. Used by mutation handlers that need to
    invalidate state before its TTL expires (rating create/delete,
    taste-profile updates). Silent on failure or when Redis is
    disabled — the cache will just serve stale data for up to its
    remaining TTL, which is acceptable degradation."""
    try:
        r = await _client()
        if r is None:
            return
        await r.delete(key)
    except Exception:
        pass
