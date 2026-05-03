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
from models import SavedComparison
from routers.auth import optional_user_id

router = APIRouter(prefix="/comparisons", tags=["comparisons"])


class SaveRequest(BaseModel):
    result: dict
    name_a: str
    name_b: str


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
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "name_a": row.name_a,
        "name_b": row.name_b,
        "result": json.loads(row.result_json),
    }
