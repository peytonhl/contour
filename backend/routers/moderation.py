"""User-generated content moderation: reporting + blocking + admin review.

Required for App Store Guideline 1.2 and Play Store user-generated-content
policies. Two distinct flows:

  • Any signed-in user can REPORT a review or reply they find objectionable
    and can BLOCK another user (hides that user's content from them).
  • An admin user (User.is_admin = True) can list open reports, mark them
    resolved or dismissed, and hard-delete the underlying review/reply.

The block filter is applied transparently in the review-listing / reply /
feed endpoints via the helpers in this module — see `blocked_user_ids()`.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import (
    AlbumCache,
    ContentReport,
    Rating,
    Review,
    ReviewLike,
    ReviewReply,
    ReviewVote,
    TrackCache,
    User,
    UserBlock,
)
from routers.auth import require_user_id
from services import spotify

import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/moderation", tags=["moderation"])


VALID_REASONS = {"spam", "harassment", "hate_speech", "explicit_content", "misinformation", "other"}
VALID_TARGET_TYPES = {"review", "reply"}


# ── Helpers shared with other routers ─────────────────────────────────────────


async def blocked_user_ids(db: AsyncSession, viewer_user_id: Optional[str]) -> set[str]:
    """Return the set of user IDs that `viewer_user_id` has blocked.
    Returns an empty set for anonymous viewers — anon users see everything."""
    if not viewer_user_id:
        return set()
    rows = (
        await db.execute(
            select(UserBlock.blocked_user_id).where(
                UserBlock.blocker_user_id == viewer_user_id
            )
        )
    ).scalars().all()
    return set(rows)


async def _require_admin(db: AsyncSession, user_id: str) -> User:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Blocks ────────────────────────────────────────────────────────────────────


@router.post("/block/{target_user_id}")
async def block_user(
    target_user_id: str,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    if target_user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot block yourself")

    target = (await db.execute(select(User).where(User.id == target_user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    existing = (
        await db.execute(
            select(UserBlock).where(
                UserBlock.blocker_user_id == user_id,
                UserBlock.blocked_user_id == target_user_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return {"blocked": True, "already": True}

    db.add(UserBlock(blocker_user_id=user_id, blocked_user_id=target_user_id))
    await db.commit()
    return {"blocked": True, "already": False}


@router.delete("/block/{target_user_id}")
async def unblock_user(
    target_user_id: str,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        delete(UserBlock).where(
            UserBlock.blocker_user_id == user_id,
            UserBlock.blocked_user_id == target_user_id,
        )
    )
    await db.commit()
    return {"blocked": False}


@router.get("/blocks")
async def list_my_blocks(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    blocks = (
        await db.execute(
            select(UserBlock).where(UserBlock.blocker_user_id == user_id)
            .order_by(UserBlock.created_at.desc())
        )
    ).scalars().all()
    if not blocks:
        return []
    target_ids = [b.blocked_user_id for b in blocks]
    users = (
        await db.execute(select(User).where(User.id.in_(target_ids)))
    ).scalars().all()
    by_id = {u.id: u for u in users}
    return [
        {
            "user_id": b.blocked_user_id,
            "display_name": by_id.get(b.blocked_user_id).display_name if by_id.get(b.blocked_user_id) else None,
            "image_url": by_id.get(b.blocked_user_id).image_url if by_id.get(b.blocked_user_id) else None,
            "blocked_at": b.created_at.isoformat() + "Z",
        }
        for b in blocks
    ]


# ── Reports ───────────────────────────────────────────────────────────────────


class ReportSubmission(BaseModel):
    target_type: str
    target_id: int
    reason: str
    notes: Optional[str] = Field(default=None, max_length=500)


@router.post("/reports")
async def submit_report(
    body: ReportSubmission,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    if body.target_type not in VALID_TARGET_TYPES:
        raise HTTPException(status_code=400, detail=f"target_type must be one of: {sorted(VALID_TARGET_TYPES)}")
    if body.reason not in VALID_REASONS:
        raise HTTPException(status_code=400, detail=f"reason must be one of: {sorted(VALID_REASONS)}")

    # Validate the target exists.
    if body.target_type == "review":
        target = (await db.execute(select(Review).where(Review.id == body.target_id))).scalar_one_or_none()
    else:
        target = (await db.execute(select(ReviewReply).where(ReviewReply.id == body.target_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail=f"{body.target_type} not found")

    # Cap multiple reports of the same target from the same user — silently
    # accept (returns existing) so the UX is idempotent.
    existing = (
        await db.execute(
            select(ContentReport).where(
                ContentReport.reporter_user_id == user_id,
                ContentReport.target_type == body.target_type,
                ContentReport.target_id == body.target_id,
                ContentReport.status == "open",
            )
        )
    ).scalar_one_or_none()
    if existing:
        return {"ok": True, "duplicate": True, "report_id": existing.id}

    report = ContentReport(
        reporter_user_id=user_id,
        target_type=body.target_type,
        target_id=body.target_id,
        reason=body.reason,
        notes=(body.notes or "").strip()[:500] or None,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return {"ok": True, "duplicate": False, "report_id": report.id}


# ── Admin endpoints ───────────────────────────────────────────────────────────


@router.get("/reports")
async def list_reports(
    status: str = "open",
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Admin-only list of reports. status=open|resolved|dismissed|all."""
    await _require_admin(db, user_id)

    stmt = select(ContentReport).order_by(ContentReport.created_at.desc())
    if status != "all":
        stmt = stmt.where(ContentReport.status == status)
    reports = (await db.execute(stmt)).scalars().all()

    # Enrich each row with the target body + author info for one-screen triage.
    out = []
    for r in reports:
        if r.target_type == "review":
            t = (await db.execute(select(Review).where(Review.id == r.target_id))).scalar_one_or_none()
        else:
            t = (await db.execute(select(ReviewReply).where(ReviewReply.id == r.target_id))).scalar_one_or_none()
        target_body = t.body if t else None
        author_id = t.user_id if t else None
        author = None
        if author_id:
            au = (await db.execute(select(User).where(User.id == author_id))).scalar_one_or_none()
            if au:
                author = {"id": au.id, "display_name": au.display_name}
        reporter = (await db.execute(select(User).where(User.id == r.reporter_user_id))).scalar_one_or_none()
        out.append({
            "id": r.id,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "target_body": target_body,
            "target_exists": t is not None,
            "target_author": author,
            "reporter": {"id": reporter.id, "display_name": reporter.display_name} if reporter else None,
            "reason": r.reason,
            "notes": r.notes,
            "status": r.status,
            "created_at": r.created_at.isoformat() + "Z",
            "resolved_at": r.resolved_at.isoformat() + "Z" if r.resolved_at else None,
        })
    return out


class ReportResolution(BaseModel):
    status: str  # "resolved" | "dismissed"
    # When True, the underlying review/reply is hard-deleted as part of resolution.
    delete_content: bool = False


@router.patch("/reports/{report_id}")
async def resolve_report(
    report_id: int,
    body: ReportResolution,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Admin marks a report resolved/dismissed and optionally deletes the
    underlying content. Idempotent — same status returns ok without changes."""
    await _require_admin(db, user_id)

    if body.status not in {"resolved", "dismissed"}:
        raise HTTPException(status_code=400, detail="status must be 'resolved' or 'dismissed'")

    report = (await db.execute(select(ContentReport).where(ContentReport.id == report_id))).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    report.status = body.status
    report.resolved_at = datetime.utcnow()
    report.resolved_by_user_id = user_id

    if body.delete_content:
        if report.target_type == "review":
            await db.execute(delete(Review).where(Review.id == report.target_id))
        else:
            await db.execute(delete(ReviewReply).where(ReviewReply.id == report.target_id))
        # Auto-resolve all other open reports against the same target — same
        # content, same outcome. Saves admin clicks.
        await db.execute(
            select(ContentReport).where(
                ContentReport.target_type == report.target_type,
                ContentReport.target_id == report.target_id,
                ContentReport.status == "open",
                ContentReport.id != report.id,
            )
        )
        rows = (await db.execute(
            select(ContentReport).where(
                ContentReport.target_type == report.target_type,
                ContentReport.target_id == report.target_id,
                ContentReport.status == "open",
                ContentReport.id != report.id,
            )
        )).scalars().all()
        for other in rows:
            other.status = "resolved"
            other.resolved_at = datetime.utcnow()
            other.resolved_by_user_id = user_id

    await db.commit()
    return {"ok": True, "status": report.status, "content_deleted": body.delete_content}


# ── Entity-cache backfill / orphan cleanup ────────────────────────────────────


class BackfillIn(BaseModel):
    """Body for POST /moderation/backfill-entity-cache."""
    execute: bool = False           # When False, the call is a dry run
    limit: int = Field(100, ge=1, le=500)
    # Restrict to one entity type per call so the user can iterate
    # (e.g. tracks first, then albums). "all" processes both.
    entity_type: str = "track"      # "track" | "album" | "all"


async def _try_fetch_spotify(entity_type: str, entity_id: str) -> tuple[Optional[dict], str]:
    """
    Fetch entity meta from Spotify with 404 distinguished from other errors.
    Returns (data, status) where status is "ok" | "orphan" | "error".
    """
    try:
        if entity_type == "track":
            data = await spotify.get_track(entity_id)
        else:
            data = await spotify.get_album(entity_id)
        return data, "ok"
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return None, "orphan"
        logger.warning("[backfill] %s/%s HTTP %d", entity_type, entity_id, exc.response.status_code)
        return None, "error"
    except Exception as exc:
        logger.warning("[backfill] %s/%s failed: %s", entity_type, entity_id, exc)
        return None, "error"


async def _delete_orphan_references(db: AsyncSession, entity_type: str, entity_id: str) -> dict:
    """
    Delete Review + Rating rows pointing at an orphaned entity, plus cascade
    cleanup of votes / likes / replies / content reports tied to those
    reviews. Returns a count of what was removed.
    """
    review_ids = (await db.execute(
        select(Review.id).where(
            Review.entity_type == entity_type,
            Review.entity_id == entity_id,
        )
    )).scalars().all()

    removed = {"reviews": 0, "ratings": 0, "votes": 0, "likes": 0, "replies": 0, "reports": 0}

    if review_ids:
        # Cascades — no FK constraints in this app, so do it explicitly.
        removed["votes"] = (await db.execute(
            delete(ReviewVote).where(ReviewVote.review_id.in_(review_ids))
        )).rowcount or 0
        removed["likes"] = (await db.execute(
            delete(ReviewLike).where(ReviewLike.review_id.in_(review_ids))
        )).rowcount or 0
        removed["replies"] = (await db.execute(
            delete(ReviewReply).where(ReviewReply.review_id.in_(review_ids))
        )).rowcount or 0
        removed["reports"] = (await db.execute(
            delete(ContentReport).where(
                ContentReport.target_type == "review",
                ContentReport.target_id.in_(review_ids),
            )
        )).rowcount or 0
        removed["reviews"] = (await db.execute(
            delete(Review).where(Review.id.in_(review_ids))
        )).rowcount or 0

    removed["ratings"] = (await db.execute(
        delete(Rating).where(
            Rating.entity_type == entity_type,
            Rating.entity_id == entity_id,
        )
    )).rowcount or 0

    return removed


@router.post("/backfill-entity-cache")
async def backfill_entity_cache(
    body: BackfillIn,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """
    Admin-only. Walks Review + Rating rows for entity_ids that aren't in
    TrackCache / AlbumCache, calls Spotify for each, and either:
      • caches the result if Spotify returns it, or
      • deletes the Review + Rating rows (with cascades) when Spotify
        returns 404 — those entities are gone, the reviews are orphaned.

    Defaults to dry-run so the caller can preview the orphan list before
    approving deletion. Set execute=true to actually delete.

    Iterate by calling repeatedly until "remaining" returns 0.
    """
    await _require_admin(db, user_id)

    if body.entity_type not in ("track", "album", "all"):
        raise HTTPException(status_code=400, detail="entity_type must be 'track', 'album', or 'all'")

    entity_types = ["track", "album"] if body.entity_type == "all" else [body.entity_type]

    summary = {
        "dry_run": not body.execute,
        "checked": 0,
        "cached": 0,
        "orphaned": 0,
        "errors": 0,
        "deleted": {"reviews": 0, "ratings": 0, "votes": 0, "likes": 0, "replies": 0, "reports": 0},
        "samples": {"cached": [], "orphaned": [], "errors": []},
        "remaining": 0,
    }

    for et in entity_types:
        Cache = TrackCache if et == "track" else AlbumCache

        # Collect unique entity_ids referenced by reviews + ratings of this type
        review_ids = (await db.execute(
            select(Review.entity_id).where(Review.entity_type == et).distinct()
        )).scalars().all()
        rating_ids = (await db.execute(
            select(Rating.entity_id).where(Rating.entity_type == et).distinct()
        )).scalars().all()
        referenced = set(review_ids) | set(rating_ids)

        # Filter to those not already in cache
        cached_ids = set((await db.execute(
            select(Cache.spotify_id).where(Cache.spotify_id.in_(referenced))
        )).scalars().all()) if referenced else set()
        missing = sorted(referenced - cached_ids)

        # Per-type batch cap so the caller can iterate
        to_process = missing[: body.limit - summary["checked"]]
        summary["remaining"] += max(0, len(missing) - len(to_process))

        for entity_id in to_process:
            summary["checked"] += 1
            data, status = await _try_fetch_spotify(et, entity_id)

            if status == "ok" and data:
                # Write through to cache. Re-check existence in case a
                # concurrent request beat us to it.
                exists = (await db.execute(
                    select(Cache).where(Cache.spotify_id == entity_id)
                )).scalar_one_or_none()
                if not exists:
                    if et == "track":
                        db.add(TrackCache(
                            spotify_id=entity_id,
                            name=data.get("name") or "",
                            artist=(data.get("artists") or [""])[0],
                            album_name=data.get("album_name"),
                            album_id=data.get("album_id"),
                            release_date=data.get("release_date"),
                            duration_ms=data.get("duration_ms"),
                            explicit=data.get("explicit", False),
                            popularity=data.get("popularity"),
                            image_url=data.get("image_url"),
                            external_url=data.get("external_url"),
                        ))
                    else:
                        db.add(AlbumCache(
                            spotify_id=entity_id,
                            name=data.get("name") or "",
                            artist=(data.get("artists") or [""])[0],
                            release_date=data.get("release_date"),
                            image_url=data.get("image_url"),
                            enrichment_status="pending",
                        ))
                summary["cached"] += 1
                if len(summary["samples"]["cached"]) < 5:
                    summary["samples"]["cached"].append({
                        "id": entity_id,
                        "type": et,
                        "name": data.get("name"),
                        "artists": data.get("artists", []),
                    })

            elif status == "orphan":
                summary["orphaned"] += 1
                if len(summary["samples"]["orphaned"]) < 10:
                    summary["samples"]["orphaned"].append({"id": entity_id, "type": et})
                if body.execute:
                    removed = await _delete_orphan_references(db, et, entity_id)
                    for k, v in removed.items():
                        summary["deleted"][k] += v

            else:  # "error" — leave it alone, retry next call
                summary["errors"] += 1
                if len(summary["samples"]["errors"]) < 5:
                    summary["samples"]["errors"].append({"id": entity_id, "type": et})

            # Be polite to Spotify — small delay between calls
            await asyncio.sleep(0.05)

        if summary["checked"] >= body.limit:
            break

    await db.commit()
    return summary
