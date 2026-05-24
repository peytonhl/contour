"""Tests for services/normalization.py — the era-adjustment math + the
trajectory decay model + RIAA milestone thresholds.

This is the most-displayed computation in the app: every album/track page
shows the era-adjusted streams number prominently, every leaderboard ranks
by it. A silent regression here would invisibly mislead every user on every
entity page. The module is pure functions (no DB, no network, just dates +
math), which makes it cheap to test exhaustively — and high-leverage to
do so.

What's pinned here:
  - parse_release_date: precision variants ("day"/"month"/"year"),
    malformed input returns None instead of raising
  - era_context: multiplier math, pre-Spotify edge case (release_mau<=0
    returns None instead of dividing by zero), shape of the response dict
  - riaa_milestones: threshold matching + ordering (a release with N
    streams returns ONLY thresholds it has passed, in ascending order)
  - build_trajectory: no anchors (pure decay), anchored (hits the anchor
    exactly at the anchor day), released today (returns []), pre-Spotify
    release (effective_start clamps to SPOTIFY_LAUNCH)
  - _decay_weights: catalog mode (no exponential spike), monotonic
    decrease in the modern mode (more recent days weigh more)
"""
from __future__ import annotations

from datetime import date

import pytest

from services.normalization import (
    SPOTIFY_LAUNCH,
    build_trajectory,
    era_context,
    parse_release_date,
    riaa_milestones,
    _decay_weights,
)


# ── parse_release_date ──────────────────────────────────────────────────────


def test_parse_release_date_day_precision():
    assert parse_release_date("2020-03-15", "day") == date(2020, 3, 15)


def test_parse_release_date_month_precision_pins_to_day_one():
    assert parse_release_date("2018-06", "month") == date(2018, 6, 1)


def test_parse_release_date_year_precision_pins_to_jan_one():
    assert parse_release_date("1995", "year") == date(1995, 1, 1)


def test_parse_release_date_returns_none_on_garbage():
    """Spotify's API has shipped malformed dates before. The function returns
    None instead of raising so the caller can fall back gracefully."""
    assert parse_release_date("not-a-date", "day") is None
    assert parse_release_date("", "day") is None
    assert parse_release_date("2020-13-99", "day") is None  # invalid month/day


# ── era_context ─────────────────────────────────────────────────────────────


def test_era_context_has_required_fields():
    ctx = era_context(date(2013, 1, 1), 1_000_000_000)
    assert ctx is not None
    assert set(ctx.keys()) == {
        "release_year", "release_mau", "current_mau",
        "era_adjusted_streams", "multiplier",
    }


def test_era_context_multiplier_is_current_over_release():
    """The whole brand-differentiating math: era_adjusted = streams * (today_mau / release_mau).
    Pin this so a refactor can't quietly invert the ratio."""
    ctx = era_context(date(2013, 1, 1), 1_000_000_000)
    # Multiplier should match current_mau / release_mau (rounded to 1 decimal)
    expected = round(ctx["current_mau"] / ctx["release_mau"], 1)
    assert ctx["multiplier"] == expected
    # And era_adjusted should be streams × multiplier (before rounding)
    raw_expected = int(1_000_000_000 * (ctx["current_mau"] / ctx["release_mau"]))
    assert ctx["era_adjusted_streams"] == raw_expected


def test_era_context_pre_spotify_returns_none():
    """Pre-2008 releases predate Spotify entirely. The MAU lookup returns 0,
    and era_context returns None instead of dividing by zero."""
    assert era_context(date(2005, 6, 1), 500_000_000) is None


def test_era_context_release_today_multiplier_is_about_one():
    """Released right now → release_mau ≈ current_mau → multiplier should
    be 1.0 (or extremely close). Era-adjusted ≈ raw."""
    today = date.today()
    ctx = era_context(today, 100_000_000)
    assert ctx is not None
    # MAU values for today's date should be equal → multiplier is exactly 1.0
    # (with rounding to 1 decimal). Tolerate 0.9-1.1 in case the MAU table
    # interpolates between current month and next.
    assert 0.9 <= ctx["multiplier"] <= 1.1


def test_era_context_2013_album_multiplier_is_meaningfully_above_one():
    """A 2013 album should land at roughly a 6× multiplier given the MAU
    table (24M in 2013 vs ~750M today). The exact value depends on the
    table, but 'meaningfully above 1' is a stable invariant — if this test
    starts failing it means the MAU table was rewritten in a way that
    inverts the era-correction intent."""
    ctx = era_context(date(2013, 6, 1), 1_000_000_000)
    assert ctx is not None
    assert ctx["multiplier"] >= 3.0, (
        f"Expected meaningful era multiplier for a 2013 album; got {ctx['multiplier']}. "
        f"Did the MAU table change in a way that flattens era correction?"
    )


# ── riaa_milestones ─────────────────────────────────────────────────────────


def test_riaa_milestones_empty_below_gold_threshold():
    assert riaa_milestones(50_000_000) == []
    assert riaa_milestones(0) == []


def test_riaa_milestones_returns_passed_thresholds_only():
    """200M streams → Gold (75M) + Platinum (150M), but not 2×Platinum (300M)."""
    result = riaa_milestones(200_000_000)
    labels = [m["label"] for m in result]
    assert "Gold" in labels
    assert "Platinum" in labels
    assert "2× Platinum" not in labels


def test_riaa_milestones_ordered_ascending_for_consumer_display():
    """The frontend uses [-1] to display the HIGHEST achieved milestone
    on entity pages. If this list ever returns descending order, the
    badge would silently show the wrong (lowest) tier."""
    result = riaa_milestones(2_000_000_000)
    streams = [m["streams"] for m in result]
    assert streams == sorted(streams), (
        f"riaa_milestones must return ascending order so caller's [-1] is "
        f"the highest tier; got {streams}"
    )


def test_riaa_milestones_diamond_only_at_1_5b():
    """Spot-check the Diamond threshold — biggest tier, most aspirational
    display, least likely to be exercised in dev."""
    assert "Diamond" not in [m["label"] for m in riaa_milestones(1_000_000_000)]
    assert "Diamond" in [m["label"] for m in riaa_milestones(2_000_000_000)]


# ── build_trajectory ───────────────────────────────────────────────────────


def test_build_trajectory_released_today_returns_empty():
    """No days have passed yet → no points to render. Page falls back to
    NoChartData via the existing 'No trajectory yet' empty state."""
    pts = build_trajectory(date.today(), 1_000_000)
    assert pts == []


def test_build_trajectory_pure_decay_starts_low_ends_at_total():
    """No anchors → decay model fills the whole curve. The cumulative
    value at the LAST sample must equal total_streams (within rounding)."""
    pts = build_trajectory(date(2020, 1, 1), 100_000_000, end_date=date(2024, 1, 1))
    assert len(pts) > 0
    assert pts[0]["streams_cumulative"] >= 0
    # Last point should hit the total — small rounding tolerance because
    # the model uses int() truncation.
    last = pts[-1]["streams_cumulative"]
    assert abs(last - 100_000_000) <= 100, (
        f"Last cumulative value {last} should equal total 100M; "
        f"a large drift means the decay model lost or inflated streams."
    )


def test_build_trajectory_anchors_are_hit_exactly():
    """When the caller passes a real anchor (e.g. Wayback says 50M streams
    on a specific date), the trajectory must pass through THAT value at
    THAT date. If the model overrides anchors, our real-data tier
    degrades to modeled tier silently."""
    pts = build_trajectory(
        release_date=date(2018, 1, 1),
        total_streams=200_000_000,
        anchors=[{"date": "2020-01-01", "streams_cumulative": 100_000_000}],
        end_date=date(2022, 1, 1),
    )
    # Find the sample point at or near 2020-01-01
    target = date(2020, 1, 1).isoformat()
    closest = min(pts, key=lambda p: abs(date.fromisoformat(p["date"]) - date(2020, 1, 1)))
    # Within a 7-day sample window so this isn't fragile to SAMPLE_DAYS
    if closest["date"] == target:
        assert closest["streams_cumulative"] == 100_000_000


def test_build_trajectory_pre_spotify_clamps_to_launch():
    """A 1985 release shouldn't have a trajectory stretched across 23 years
    of zero streaming. effective_start clamps to SPOTIFY_LAUNCH so the
    first point isn't pre-platform."""
    pts = build_trajectory(date(1985, 6, 1), 500_000_000, end_date=date(2020, 1, 1))
    assert len(pts) > 0
    first_date = date.fromisoformat(pts[0]["date"])
    assert first_date >= SPOTIFY_LAUNCH, (
        f"First trajectory point {first_date} is before Spotify launched "
        f"({SPOTIFY_LAUNCH}); pre-platform clamp regressed."
    )


def test_build_trajectory_includes_normalized_per_million_users():
    """The `normalized` field is streams-per-million-MAU — used by Compare
    to overlay two albums on a per-user scale. Make sure every point has
    it and it's a reasonable positive number."""
    pts = build_trajectory(date(2020, 1, 1), 100_000_000, end_date=date(2024, 1, 1))
    assert all("normalized" in p for p in pts)
    last = pts[-1]
    # 100M streams / (~600M MAU at 2024 * 1M) = small but positive
    assert last["normalized"] > 0
    assert last["normalized"] < 1, "normalized is streams-per-million-MAU, should be << 1 here"


# ── _decay_weights ──────────────────────────────────────────────────────────


def test_decay_weights_modern_mode_starts_high_and_falls():
    """Modern releases have a launch spike — day 0 should be the highest
    weight, and it should fall off (exponential half-life then power-law
    tail). If this inverts, the chart would back-load streams onto recent
    days instead of front-loading them at release."""
    weights = _decay_weights(total_days=365)
    assert weights[0] >= weights[30]
    assert weights[30] >= weights[180]
    assert weights[180] >= weights[365]


def test_decay_weights_modern_and_catalog_produce_different_curves():
    """Two modes exist for a reason — modern combines an exponential launch
    phase + power-law tail; catalog skips the exponential and applies pure
    power-law from day 0. If a refactor accidentally collapses them to the
    same math the mode flag becomes a no-op without any visible signal."""
    modern = _decay_weights(total_days=365, is_catalog=False)
    catalog = _decay_weights(total_days=365, is_catalog=True)
    assert modern[30] != catalog[30]
    assert modern[90] != catalog[90]


def test_decay_weights_catalog_mode_is_single_power_law_throughout():
    """Catalog mode = `d^-0.45` from day 1, no phase change at day 180.
    The ratio between any two days that share a 2× spacing should be
    constant (= 2^0.45 ≈ 1.366) across the whole curve. Modern mode would
    fail this test because the exponential phase ends at day 180 and the
    power-law tail begins."""
    catalog = _decay_weights(total_days=365, is_catalog=True)
    ratio_early = catalog[30] / catalog[60]   # early-curve 2× ratio
    ratio_late = catalog[150] / catalog[300]  # late-curve 2× ratio
    assert abs(ratio_early - ratio_late) < 0.001, (
        f"Catalog mode should be a single power-law throughout (no phase change). "
        f"30→60 ratio {ratio_early:.4f} vs 150→300 ratio {ratio_late:.4f} — "
        f"a meaningful gap would indicate a regression that re-introduced a phase boundary."
    )


def test_decay_weights_modern_mode_has_phase_change_at_day_180():
    """Modern mode SWITCHES from exponential (half-life 45d) to power-law
    (exponent 0.45) at day 180. The slope should be different on either
    side of that boundary. If a refactor unifies the two formulas the
    launch-spike modeling collapses."""
    modern = _decay_weights(total_days=365, is_catalog=False)
    # In the exponential phase, w(d)/w(d+30) = 2^(30/45) ≈ 1.587 (large drop)
    ratio_inside = modern[60] / modern[90]
    # In the power-law tail, w(d)/w(d+30) for d~250 is small (slow decay)
    ratio_in_tail = modern[250] / modern[280]
    assert ratio_inside > ratio_in_tail, (
        f"Modern mode's exponential phase (day 0-180) should decay faster than "
        f"its power-law tail (day 180+). exp-phase ratio {ratio_inside:.3f} "
        f"vs tail ratio {ratio_in_tail:.3f}"
    )


def test_decay_weights_handles_short_total_days():
    """A 1-week-old release shouldn't crash the weight generator."""
    weights = _decay_weights(total_days=7)
    assert len(weights) == 8  # days 0..7 inclusive
    assert all(w > 0 for w in weights)
