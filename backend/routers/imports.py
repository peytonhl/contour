"""CSV import endpoints — currently RYM only.

Multipart upload, parsed and matched on Spotify, ratings written through to the
same `Rating` table the rest of the app uses. Returns counts + an array of
unmatched rows so the client can show "We couldn't match these" honestly.
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import ImportLog, Rating, Review
from routers.auth import require_user_id
from services import album_cache as cache, rym_import
from services.limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/imports", tags=["imports"])

# Backed by slowapi's IP-bucket. Per-user enforcement would require a custom
# key_func — IP is good enough for v1 since imports are rare per-user anyway.
RYM_RATE = "5/hour"

# 5 MB hard cap. RYM exports for power users are ~500 KB.
MAX_BYTES = 5 * 1024 * 1024


@router.post("/rym")
@limiter.limit(RYM_RATE)
async def import_rym(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 5 MB)")
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        parsed = rym_import.parse_rym_csv(raw)
    except Exception as exc:
        logger.warning("RYM import: parse failed for user=%s — %s", user_id, exc)
        raise HTTPException(status_code=400, detail="Could not parse CSV")

    if not parsed:
        raise HTTPException(
            status_code=400,
            detail="No rated rows found. RYM exports include unrated entries — make sure ratings are set.",
        )

    matched: list[dict] = []
    unmatched: list[dict] = []

    for row in parsed:
        candidate = await rym_import.match_album(row)
        if candidate is None:
            unmatched.append({"title": row["title"], "artist": row["artist"]})
            continue

        # Persist album metadata so the user's profile renders the cover/title.
        try:
            await cache.upsert_album(db, candidate)
        except Exception as exc:
            logger.warning("RYM import: upsert_album failed for %s — %s", candidate.get("id"), exc)

        album_id = candidate["id"]

        # Upsert the rating (same pattern as POST /ratings/{type}/{id}/rate).
        existing = (await db.execute(
            select(Rating).where(
                Rating.user_id == user_id,
                Rating.entity_type == "album",
                Rating.entity_id == album_id,
            )
        )).scalar_one_or_none()
        if existing:
            existing.value = row["rating"]
        else:
            db.add(Rating(
                user_id=user_id,
                entity_type="album",
                entity_id=album_id,
                value=row["rating"],
            ))

        # Optional review body — only upserted when present and non-trivial.
        review_body = row.get("review")
        if review_body and len(review_body.strip()) >= 2:
            existing_review = (await db.execute(
                select(Review).where(
                    Review.user_id == user_id,
                    Review.entity_type == "album",
                    Review.entity_id == album_id,
                )
            )).scalar_one_or_none()
            trimmed = review_body.strip()[:5000]
            if existing_review is None:
                db.add(Review(
                    user_id=user_id,
                    entity_type="album",
                    entity_id=album_id,
                    body=trimmed,
                ))
            # Don't overwrite a review the user has already written on Contour.

        matched.append({
            "title": row["title"],
            "artist": row["artist"],
            "album_id": album_id,
            "rating": row["rating"],
        })

        # Be polite to Spotify between matches. ~5 rows/sec keeps us well below
        # the rate-limit threshold while still finishing a 200-row import in ~40s.
        await asyncio.sleep(0.2)

    db.add(ImportLog(
        user_id=user_id,
        source="rym",
        file_name=file.filename[:256] if file.filename else None,
        matched_count=len(matched),
        unmatched_count=len(unmatched),
    ))
    await db.commit()

    return {
        "matched_count": len(matched),
        "unmatched_count": len(unmatched),
        "matched": matched,
        "unmatched": unmatched,
    }
