"""Admin-gated diagnostic endpoints.

Born out of the int32-overflow incident, where the actual bug
(`asyncpg.DataError: value out of int32 range` raised inside
`save_kworb_streams`) was invisible until we added branch-level counters
to the persistence step. The /debug/* endpoints used during that
investigation are productionized here behind admin auth.

Endpoints:
  GET  /admin/version       process identity + startup state + sweeper task
  GET  /admin/stats         every counter registered via services.instrumentation
  POST /admin/sweep         run one enrichment sweep cycle synchronously

All three require an admin user (User.is_admin = True). Non-admin users
get 403. No-auth users get 401 via require_user_id.
"""
from __future__ import annotations

import os
import time
import traceback
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import TrackCache, User
from routers.auth import require_user_id
from services import enrichment_sweeper, instrumentation, spotify

router = APIRouter(prefix="/admin", tags=["admin"])


async def _require_admin(db: AsyncSession, user_id: str) -> User:
    """Mirror of routers.moderation._require_admin. Kept local rather
    than imported to avoid coupling two admin areas through one helper."""
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user or not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Process identity / startup state ──────────────────────────────────────────


@router.get("/version")
async def admin_version(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Identifying info about the running container — git SHA, deployment
    ID, uptime, startup-stage beacons, sweeper task liveness. Use to verify
    "is the new deploy actually serving traffic?" without log access."""
    await _require_admin(db, user_id)

    # Pull the startup-state markers + sweeper-task handle from main.
    # Local import sidesteps a circular import at module load: main
    # already imports this router.
    from main import _STARTUP_STATE, _sweeper_task

    sweeper_state = "not-scheduled"
    sweeper_exception: Optional[str] = None
    if _sweeper_task is not None:
        if _sweeper_task.cancelled():
            sweeper_state = "cancelled"
        elif _sweeper_task.done():
            sweeper_state = "done"  # for an infinite loop this means crashed/GC'd
            try:
                exc = _sweeper_task.exception()
                if exc is not None:
                    sweeper_exception = f"{type(exc).__name__}: {exc}"
            except Exception:
                pass
        else:
            sweeper_state = "running"

    now = time.time()
    return {
        "git_sha": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "unknown"),
        "git_branch": os.environ.get("RAILWAY_GIT_BRANCH", "unknown"),
        "deployment_id": os.environ.get("RAILWAY_DEPLOYMENT_ID", "unknown"),
        "module_import_utc": _STARTUP_STATE["import_time_utc"],
        "uptime_seconds": int(now - _STARTUP_STATE["import_time_utc"]),
        "startup_stage": _STARTUP_STATE["stage"],
        "startup_complete": _STARTUP_STATE["complete"],
        "startup_complete_at_utc": _STARTUP_STATE["complete_at_utc"],
        "sweeper_scheduled": _STARTUP_STATE["sweeper_scheduled"],
        "sweeper_state": sweeper_state,
        "sweeper_exception": sweeper_exception,
        "now_utc": now,
    }


# ── Outcome counters ──────────────────────────────────────────────────────────


@router.get("/stats")
async def admin_stats(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Every counter registered via services.instrumentation.

    Keys are the counter names used at registration site — e.g.
    "album_cache.save_kworb_streams", "spotify._persist_album_to_db".
    Each value is a dict with at minimum:
      called_total       int   — how many times this site was hit
      last_at_utc        str?  — ISO timestamp of the most recent call
      last_outcome       str?  — short summary ("committed", "row_missing",
                                 "errored: <ExceptionType>", etc.)
      last_subject       str?  — entity ID being operated on
    Plus site-specific buckets (committed_total, errored_total, ...).
    """
    await _require_admin(db, user_id)
    return {"counters": instrumentation.snapshot()}


# ── On-demand enrichment sweep ────────────────────────────────────────────────


@router.post("/sweep")
async def admin_sweep(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Run one enrichment sweep cycle synchronously. Decouples
    "does sweep_once() work?" from "is the background task firing?".
    Returns {ok, processed, elapsed_seconds} on success, or {ok: False,
    error_type, error_message, traceback} if the cycle raised."""
    await _require_admin(db, user_id)

    start = time.time()
    try:
        processed = await enrichment_sweeper.sweep_once()
        return {
            "ok": True,
            "processed": processed,
            "elapsed_seconds": round(time.time() - start, 2),
        }
    except Exception as exc:
        return {
            "ok": False,
            "error_type": type(exc).__name__,
            "error_message": str(exc),
            "traceback": traceback.format_exc(),
            "elapsed_seconds": round(time.time() - start, 2),
        }


@router.post("/backfill-track-popularity")
async def backfill_track_popularity(
    max_tracks: int = 200,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """
    Backfill `popularity` on TrackCache rows where it's currently NULL.

    Includes an inline raw-HTTP diagnostic probe in the response so the
    caller can see *exactly* what Spotify's /v1/tracks endpoint returns
    for our app's credentials — status code, response body preview, and
    the popularity field for the first 5 IDs. If the bulk path returns
    fetched=0, the probe tells us why immediately rather than requiring
    a log dive.

    Body params:
      max_tracks: cap on how many rows to scan + backfill in one call.
                  At 50 IDs per Spotify call, max=200 is 4 API calls.

    Returns: {ok, scanned, fetched, updated, elapsed_seconds, sample,
              probe: {status_code, ids_requested, response_preview,
                      raw_popularity_values}}.
    """
    await _require_admin(db, user_id)

    start = time.time()
    rows = (await db.execute(
        select(TrackCache.spotify_id)
        .where(TrackCache.popularity.is_(None))
        .limit(max_tracks)
    )).scalars().all()
    ids = list(rows)
    if not ids:
        return {
            "ok": True,
            "scanned": 0,
            "fetched": 0,
            "updated": 0,
            "elapsed_seconds": round(time.time() - start, 2),
            "note": "no tracks with NULL popularity — backfill is up to date",
        }

    # ── Inline diagnostic probe ──────────────────────────────────────────────
    # Hit /v1/tracks directly with the first 5 IDs and capture every signal
    # we can: status code, response body preview, exception class if it
    # blows up. Without this, get_tracks_batch's per-chunk try/except hides
    # whatever is actually going wrong.
    import httpx as _httpx
    probe: dict = {"ids_requested": ids[:5]}
    try:
        async with _httpx.AsyncClient(timeout=10.0) as client:
            token = await spotify._get_token(client)
            resp = await client.get(
                "https://api.spotify.com/v1/tracks",
                headers={"Authorization": f"Bearer {token}"},
                params={"ids": ",".join(ids[:5]), "market": "US"},
            )
            probe["status_code"] = resp.status_code
            probe["response_preview"] = resp.text[:600]
            if resp.status_code == 200:
                body = resp.json()
                returned = body.get("tracks") or []
                probe["tracks_in_response"] = len(returned)
                probe["raw_popularity_values"] = [
                    {
                        "id": (t or {}).get("id"),
                        "name": (t or {}).get("name"),
                        "popularity": (t or {}).get("popularity"),
                        "popularity_type": type((t or {}).get("popularity")).__name__,
                    }
                    for t in returned
                ]
    except Exception as exc:
        probe["error_type"] = type(exc).__name__
        probe["error_message"] = str(exc)

    # ── Bulk backfill via get_tracks_batch ───────────────────────────────────
    try:
        fetched = await spotify.get_tracks_batch(ids)
    except Exception as exc:
        return {
            "ok": False,
            "scanned": len(ids),
            "error_type": type(exc).__name__,
            "error_message": str(exc),
            "elapsed_seconds": round(time.time() - start, 2),
            "probe": probe,
        }

    # get_tracks_batch fire-and-forgets persistence; settle here so the
    # caller sees an honest "updated" count rather than racing.
    import asyncio as _asyncio
    await _asyncio.sleep(0.5)

    confirmed = (await db.execute(
        select(TrackCache.spotify_id, TrackCache.popularity)
        .where(TrackCache.spotify_id.in_(ids))
    )).all()
    updated = sum(1 for _, p in confirmed if p is not None)

    sample = [
        {"id": t.get("id"), "name": t.get("name"), "popularity": t.get("popularity")}
        for t in fetched[:5]
    ]

    return {
        "ok": True,
        "scanned": len(ids),
        "fetched": len(fetched),
        "updated": updated,
        "elapsed_seconds": round(time.time() - start, 2),
        "sample": sample,
        "probe": probe,
    }
