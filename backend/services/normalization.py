"""
Trajectory modeling and normalization.

Since day-by-day historical stream data is not publicly available,
we model the curve using a streaming decay function:
  - High velocity in the first ~30 days (release week spike)
  - Gradual decay over months following release
  - Long catalog tail settling to a low steady-state

The model is calibrated so the cumulative area under the curve
equals the known total stream count (from Kworb) at the endpoint.
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


def popularity_to_streams(popularity: Optional[int]) -> int:
    if not popularity:
        return 10_000_000
    if popularity >= 90:
        return 2_000_000_000
    if popularity >= 80:
        return 800_000_000
    if popularity >= 70:
        return 300_000_000
    if popularity >= 60:
        return 100_000_000
    if popularity >= 50:
        return 40_000_000
    return 10_000_000

# Sampling resolution — one point every N days for the chart
SAMPLE_DAYS = 7


def model_trajectory(
    release_date: date,
    total_streams: int,
    end_date: Optional[date] = None,
) -> list[dict]:
    """
    Generate a list of data points from day 0 to end_date.

    Each point: { day: int, date: str, streams_cumulative: int, normalized: float }

    normalized = cumulative_streams / MAU_at_that_date  (as a ratio × 1000 for readability)
    """
    if end_date is None:
        end_date = date.today()

    total_days = (end_date - release_date).days
    if total_days <= 0:
        return []

    # Build daily weights using the decay model
    weights = _decay_weights(total_days)
    total_weight = sum(weights)

    points = []
    cumulative = 0.0

    for day_idx in range(0, total_days + 1, SAMPLE_DAYS):
        # Accumulate streams up to this sample day
        block_end = min(day_idx + SAMPLE_DAYS, total_days + 1)
        cumulative += sum(weights[day_idx:block_end])

        streams = int((cumulative / total_weight) * total_streams)
        sample_date = release_date + timedelta(days=day_idx)
        mau = get_mau_for_date(sample_date)

        points.append(
            {
                "day": day_idx,
                "date": sample_date.isoformat(),
                "streams_cumulative": streams,
                # Streams per user (cumulative streams ÷ total MAU)
                "normalized": round(streams / (mau * 1_000_000), 4),
            }
        )

    return points


def _decay_weights(total_days: int) -> list[float]:
    """
    Per-day streaming weight — two-phase model calibrated to observed patterns:

      Phase 1 (days 0–180): exponential decay, half-life ~45 days.
        Puts ~20% of lifetime streams in month 1, ~55% by month 6.

      Phase 2 (days 180+): power-law catalog tail connected smoothly at
        the phase boundary. Exponent -0.45 gives a heavier long tail,
        reflecting catalog listening on playlists and radio.

    Rough calibration targets (% of lifetime streams):
      Month 1:  ~15–20%
      Month 6:  ~45–55%
      Year 1:   ~60–70%
      Year 2+:  remainder spread slowly
    """
    HALF_LIFE = 45.0
    TRANSITION = 180
    EXPONENT = 0.45

    # Value of phase-1 curve at the transition point
    transition_val = math.exp(-TRANSITION * math.log(2) / HALF_LIFE)
    # Scale factor so the power-law tail matches at the boundary
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
    """
    Return plain-English era adjustment context:
      - release_mau: Spotify MAU (millions) at time of release
      - current_mau: Spotify MAU today
      - era_adjusted_streams: what total_streams would be if released today
      - multiplier: how many times more impressive than raw number suggests
    """
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


def riaa_milestones(total_streams: int, certification_data: Optional[dict] = None) -> list[dict]:
    """
    Return RIAA certification thresholds that this album has passed,
    as day-index annotations for the chart.

    Thresholds are stream equivalents (1 stream = 1/150 album unit, roughly):
      Gold:     500K album units  →  ~75M streams
      Platinum: 1M album units    →  ~150M streams
      (multiplatinum scales linearly)
    """
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
