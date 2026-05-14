"""Lightweight counter registry for instrumenting silent-failure paths.

The int32-overflow bug that broke stream enrichment for an entire session
went undetected because `save_kworb_streams` swallowed asyncpg's
DataError inside the `_enrich_album` outer try/except — no log line, no
status change, no signal at all. The fix was to count branch outcomes
at the persistence step and surface them. This module makes that pattern
one-line-cheap for any write-back path.

Usage:

    # At module top (writers register once at import):
    from services.instrumentation import counter, record

    _SAVE = counter(
        "album_cache.save_kworb_streams",
        row_found_total=0,
        row_missing_total=0,
        committed_total=0,
        commit_failed_total=0,
    )

    # At the call site:
    try:
        await db.commit()
        record(_SAVE, outcome="committed", subject=spotify_id, committed_total=1, row_found_total=1)
    except Exception as exc:
        record(_SAVE, outcome=f"commit_failed: {type(exc).__name__}", subject=spotify_id,
               commit_failed_total=1, row_found_total=1)
        raise

The /admin/stats endpoint returns `snapshot()` — every registered
counter, in one JSON blob. Future debugging starts with that endpoint
instead of guessing at logs.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

# Module-level registry. One process = one set of counters. Reset on
# container restart, which matches the deploy lifecycle — counters
# report activity in the current container, not historical.
_REGISTRY: dict[str, dict] = {}


def counter(name: str, **initial_fields: int) -> dict:
    """Register (or fetch) a named counter block.

    `initial_fields` lets each counter declare its own outcome buckets
    (e.g. row_found_total, committed_total) on top of the standard
    called_total / last_* fields. Idempotent — calling twice with the
    same name returns the existing block, so module re-imports don't
    reset counts.
    """
    if name in _REGISTRY:
        return _REGISTRY[name]
    block: dict = {
        "called_total": 0,
        "last_at_utc": None,
        "last_outcome": None,
        "last_subject": None,
    }
    block.update(initial_fields)
    _REGISTRY[name] = block
    return block


def record(
    block: dict,
    *,
    outcome: str,
    subject: Optional[str] = None,
    **deltas: int,
) -> None:
    """Update a counter block. `outcome` is a short human-readable
    summary of what happened (`committed`, `row_missing`,
    `commit_failed: DataError`, etc.). `subject` is the entity ID or
    key being operated on. `deltas` are bucket counters to increment."""
    block["called_total"] += 1
    block["last_at_utc"] = datetime.utcnow().isoformat() + "Z"
    block["last_outcome"] = outcome
    block["last_subject"] = subject
    for field, value in deltas.items():
        block[field] = block.get(field, 0) + value


def snapshot() -> dict[str, dict]:
    """Return a shallow copy of every registered counter. Safe to
    serialize as JSON — every value in every block is a primitive
    (int / str / None)."""
    return {name: dict(block) for name, block in _REGISTRY.items()}
