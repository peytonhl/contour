"""Save and retrieve comparison permalinks."""

import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AppleMusicLink, SavedComparison
from routers.auth import optional_user_id
from services.normalization import era_context, parse_release_date

router = APIRouter(prefix="/comparisons", tags=["comparisons"])


class SaveRequest(BaseModel):
    result: dict
    name_a: str
    name_b: str
    name_c: Optional[str] = None


@router.post("/")
async def save_comparison(
    body: SaveRequest,
    user_id: Optional[str] = Depends(optional_user_id),
    db: AsyncSession = Depends(get_db),
):
    short_id = str(uuid.uuid4())[:8]
    row = SavedComparison(
        id=short_id,
        created_at=datetime.utcnow(),
        user_id=user_id,
        result_json=json.dumps(body.result),
        name_a=body.name_a,
        name_b=body.name_b,
        name_c=body.name_c,
    )
    db.add(row)
    await db.commit()
    return {"id": short_id}


@router.get("/{comparison_id}")
async def get_comparison(comparison_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SavedComparison).where(SavedComparison.id == comparison_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Comparison not found")

    return {
        "id": row.id,
        "created_at": row.created_at.isoformat() + "Z" if row.created_at else None,
        "name_a": row.name_a,
        "name_b": row.name_b,
        "name_c": row.name_c,
        "result": json.loads(row.result_json),
    }


async def _best_cover(db: AsyncSession, entity_type: str, entity_id: str, fallback: Optional[str]) -> Optional[str]:
    """Apple Music artwork when cached, else the original Spotify image."""
    if entity_type not in ("album", "track"):
        return fallback
    apple_link = (await db.execute(
        select(AppleMusicLink).where(
            AppleMusicLink.spotify_id == entity_id,
            AppleMusicLink.entity_type == entity_type,
            AppleMusicLink.storefront == "us",
        )
    )).scalar_one_or_none()
    if apple_link and apple_link.artwork_url:
        return apple_link.artwork_url
    return fallback


def _format_streams(n: Optional[int]) -> Optional[str]:
    if n is None:
        return None
    if n >= 1_000_000_000:
        return f"{n / 1_000_000_000:.2f}B"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    return f"{n:,}"


def _side(payload: dict) -> Optional[dict]:
    """Flatten one slot of the saved-comparison result into renderer-friendly fields."""
    if not payload:
        return None
    release_date_str = payload.get("release_date")
    precision = payload.get("release_date_precision") or "day"
    release_year = None
    era = None
    try:
        rd = parse_release_date(release_date_str, precision)
        if rd is not None:
            release_year = rd.year
            total = payload.get("total_streams")
            if total:
                era = era_context(rd, total)
    except Exception:
        pass
    return {
        "id": payload.get("id"),
        "entity_type": payload.get("entity_type") or "album",
        "name": payload.get("name"),
        "artist": (payload.get("artists") or [None])[0],
        "image_url": payload.get("image_url"),  # Spotify fallback
        "release_year": release_year,
        "total_streams": payload.get("total_streams"),
        "total_streams_display": _format_streams(payload.get("total_streams")),
        "era_adjusted_streams": era["era_adjusted_streams"] if era else None,
        "era_adjusted_display": _format_streams(era["era_adjusted_streams"]) if era else None,
        "era_multiplier": era["multiplier"] if era else None,
    }


@router.get("/{comparison_id}/card-data")
async def get_comparison_card_data(comparison_id: str, db: AsyncSession = Depends(get_db)):
    """
    One-shot payload for the Vercel-OG comparison-card renderer.

    Pulls the saved A/B (and optional C) entries from result_json, computes
    era_context for each (era_adjusted_streams + multiplier), upgrades each
    cover URL to Apple Music's 1200×1200 art when a cached match exists,
    and identifies a verdict (whichever side has the highest era-adjusted
    streams). The renderer needs zero per-field knowledge of normalization
    or the Apple-Music match flow — just lays out what's in the response.

    No auth required: saved comparisons are public artifacts (the URL is
    unguessable but stable).
    """
    row = (await db.execute(
        select(SavedComparison).where(SavedComparison.id == comparison_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Comparison not found")

    result = json.loads(row.result_json)
    a = _side(result.get("album_a"))
    b = _side(result.get("album_b"))
    c = _side(result.get("album_c")) if result.get("album_c") else None
    if not a or not b:
        raise HTTPException(status_code=422, detail="Saved comparison is missing one or both sides")

    # Apple-Music cover preference — same pattern as the review card. Skip
    # the upgrade for unknown entity types or missing IDs.
    for side in (a, b, c):
        if not side or not side.get("id"):
            continue
        side["cover_url"] = await _best_cover(db, side["entity_type"], side["id"], side["image_url"])
        side["cover_source"] = "apple" if side["cover_url"] and side["cover_url"] != side["image_url"] else "spotify"

    # Verdict: pick the winner by era-adjusted streams. Skipped silently
    # when streams aren't computed (enrichment_pending) — the renderer
    # just omits the verdict line in that case.
    sides_for_verdict = [s for s in (a, b, c) if s and s.get("era_adjusted_streams")]
    verdict = None
    if len(sides_for_verdict) >= 2:
        winner = max(sides_for_verdict, key=lambda s: s["era_adjusted_streams"])
        verdict = {
            "winner_id": winner["id"],
            "winner_name": winner["name"],
        }

    return {
        "id": row.id,
        "a": a,
        "b": b,
        "c": c,
        "verdict": verdict,
    }
