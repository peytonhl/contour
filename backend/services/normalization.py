"""
Trajectory modeling and normalization.

Data quality tiers (best to worst):
  1. kworb_daily  — real daily chart data from Kworb entity page
  2. wayback      — cumulative totals at multiple archive snapshots
  3. kworb_total  — Kworb total only, shape is modeled
  (popularity fallback removed — it was noise)

When anchor points are available, the trajectory is interpolated through them.
The decay model fills only gaps that real data doesn't cover.
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Optional

from data.spotify_mau import get_mau_for_date


def parse_release_date(release_date: str, precision: str) -> Optional[date]:
    try:
        if precision == "day":
            return date.fromisoformat(release_date)
        elif precision == "month":
            year, month = release_date.split("-")[:2]
            return date(int(year), int(month), 1)
        else:
            return date(int(release_date[:4]), 1, 1)
    except Exception:
        return None


# Sampling resolution — one chart point every N days
SAMPLE_DAYS = 7


def build_trajectory(
    release_date: date,
    total_streams: int,
    anchors: Optional[list[dict]] = None,
    end_date: Optional[date] = None,
) -> list[dict]:
    """
    Generate trajectory data points from release to end_date.

    If `anchors` is provided (list of {date: str, streams_cumulative: int}),
    the curve is interpolated through them. The decay model fills any gaps
    at the start (before first anchor) and is used as the sole source
    when no anchors exist.

    Each point: {day, date, streams_cumulative, normalized}
    normalized = cumulative_streams / MAU_at_that_date (streams per million users)
    """
    if end_date is None:
        end_date = date.today()

    total_days = (end_date - release_date).days
    if total_days <= 0:
        return []

    # Build the sample day list
    sample_days = list(range(0, total_days + 1, SAMPLE_DAYS))
    if total_days not in sample_days:
        sample_days.append(total_days)

    # Convert anchors to (day_offset, stream_count) pairs
    anchor_pairs: list[tuple[int, int]] = []
    if anchors:
        for a in anchors:
            try:
                a_date = date.fromisoformat(a["date"])
                a_streams = int(a.get("streams_cumulative") or a.get("streams") or 0)
                day_offset = (a_date - release_date).days
                if 0 < day_offset <= total_days and a_streams > 0:
                    anchor_pairs.append((day_offset, a_streams))
            except (ValueError, KeyError):
                continue
        anchor_pairs.sort()

    # Always add the total as the final anchor (day = total_days)
    if total_streams > 0:
        # If the last anchor is close to total but not exact, just append total
        if not anchor_pairs or anchor_pairs[-1][0] < total_days:
            anchor_pairs.append((total_days, total_streams))

    points = []
    for day_idx in sample_days:
        streams = _interpolate(day_idx, total_days, total_streams, anchor_pairs)
        sample_date = release_date + timedelta(days=day_idx)
        mau = get_mau_for_date(sample_date)
        points.append({
            "day": day_idx,
            "date": sample_date.isoformat(),
            "streams_cumulative": streams,
            "normalized": round(streams / (mau * 1_000_000), 4) if mau > 0 else 0,
        })

    return points


def _interpolate(
    day: int,
    total_days: int,
    total_streams: int,
    anchor_pairs: list[tuple[int, int]],
) -> int:
    """
    Return the stream count for `day` by:
      - If day is before the first anchor: use decay model scaled to reach first anchor
      - If day is between two anchors: linear interpolation
      - If day is after the last anchor: shouldn't happen (total is always last anchor)
    """
    if not anchor_pairs:
        # No anchors at all — pure model
        return _model_value(day, total_days, total_streams)

    first_anchor_day, first_anchor_streams = anchor_pairs[0]
    last_anchor_day, last_anchor_streams = anchor_pairs[-1]

    # Before the first anchor — use decay model, scaled to hit first anchor
    if day <= first_anchor_day:
        if first_anchor_day == 0:
            return first_anchor_streams
        model_at_first = _model_value(first_anchor_day, total_days, total_streams)
        if model_at_first == 0:
            return 0
        scale = first_anchor_streams / model_at_first
        return int(_model_value(day, total_days, total_streams) * scale)

    # Find the surrounding anchor pair and linearly interpolate
    for i in range(len(anchor_pairs) - 1):
        d0, s0 = anchor_pairs[i]
        d1, s1 = anchor_pairs[i + 1]
        if d0 <= day <= d1:
            if d1 == d0:
                return s1
            t = (day - d0) / (d1 - d0)
            return int(s0 + t * (s1 - s0))

    # After the last anchor (shouldn't normally reach here since total is last)
    return last_anchor_streams


def _model_value(day: int, total_days: int, total_streams: int) -> int:
    """Pure decay model — cumulative streams at `day`."""
    weights = _decay_weights(total_days)
    if not weights or sum(weights) == 0:
        return 0
    cumulative = sum(weights[:day + 1])
    return int((cumulative / sum(weights)) * total_streams)


def _decay_weights(total_days: int) -> list[float]:
    """
    Per-day streaming weight — two-phase model:
      Phase 1 (days 0–180): exponential decay, half-life ~45 days
      Phase 2 (days 180+): power-law catalog tail, exponent -0.45
    """
    HALF_LIFE = 45.0
    TRANSITION = 180
    EXPONENT = 0.45

    transition_val = math.exp(-TRANSITION * math.log(2) / HALF_LIFE)
    tail_scale = transition_val * (TRANSITION ** EXPONENT)

    weights = []
    for d in range(total_days + 1):
        if d <= TRANSITION:
            w = math.exp(-d * math.log(2) / HALF_LIFE)
        else:
            w = tail_scale * math.pow(d, -EXPONENT)
        weights.append(w)
    return weights


def era_context(release_date: date, total_streams: int) -> dict:
    """Return era-adjustment context for display on album/track pages."""
    today = date.today()
    release_mau = get_mau_for_date(release_date)
    current_mau = get_mau_for_date(today)

    if release_mau <= 0:
        return None

    multiplier = current_mau / release_mau
    era_adjusted = int(total_streams * multiplier)

    return {
        "release_year": release_date.year,
        "release_mau": round(release_mau),
        "current_mau": round(current_mau),
        "era_adjusted_streams": era_adjusted,
        "multiplier": round(multiplier, 1),
    }


def riaa_milestones(total_streams: int) -> list[dict]:
    """Return RIAA certification thresholds this track/album has passed."""
    thresholds = [
        {"label": "Gold", "streams": 75_000_000},
        {"label": "Platinum", "streams": 150_000_000},
        {"label": "2× Platinum", "streams": 300_000_000},
        {"label": "3× Platinum", "streams": 450_000_000},
        {"label": "4× Platinum", "streams": 600_000_000},
        {"label": "5× Platinum", "streams": 750_000_000},
        {"label": "Diamond", "streams": 1_500_000_000},
    ]
    return [t for t in thresholds if t["streams"] <= total_streams]


def data_tier(anchor_sources: list[str]) -> str:
    """
    Return a human-readable data quality tier label given the set of
    anchor sources present for this entity.
    """
    if "kworb_daily" in anchor_sources:
        return "kworb_daily"
    if "wayback" in anchor_sources:
        return "wayback"
    return "modeled"
