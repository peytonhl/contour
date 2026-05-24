"""Tests for pure helper functions across the backend — small, deterministic,
high-leverage. These are exactly the kind of code that breaks quietly under
refactor because the behavior is "obvious to read."

Covered:
  • routers.ratings._controversial_score — the sort math behind the
    Controversial tab on every entity page. Bad math here changes feed
    ordering invisibly.
  • services.deezer._signed_url_ttl — Akamai-signed Deezer preview URLs
    have a baked-in expiry. Caching past expiry serves dead URLs that
    fail to play. The cap-to-expiry behavior is what keeps the For You
    feed's audio working.
"""
from __future__ import annotations

import time

import pytest

from routers.ratings import _controversial_score
from services.deezer import _signed_url_ttl


# ── _controversial_score ───────────────────────────────────────────────────


def test_controversial_zero_when_no_votes():
    assert _controversial_score(0, 0) == 0.0


def test_controversial_zero_for_purely_positive_review():
    """A 50-upvote / 0-downvote review is not controversial — it's
    universally loved. The sort must return 0 so this never bubbles
    above a 5-up / 3-down balanced review on the Controversial tab."""
    assert _controversial_score(50, 0) == 0.0
    assert _controversial_score(1, 0) == 0.0


def test_controversial_nonzero_when_any_downvote_exists():
    """Even one downvote on a small-community review is signal — without
    this floor, the Controversial tab would be empty until reviews got
    20+ votes each. The +0.5 in the formula floors a single-downvote
    review's score above zero."""
    assert _controversial_score(5, 1) > 0


def test_controversial_balanced_reviews_score_higher_than_lopsided():
    """5 up / 5 down should beat 9 up / 1 down — same total, but the
    balanced one is more divisive by definition. Pins the formula's
    `min(up, down) + 0.5` factor."""
    balanced = _controversial_score(5, 5)
    lopsided = _controversial_score(9, 1)
    assert balanced > lopsided


def test_controversial_grows_with_total_votes():
    """At equal balance, more votes = stronger 'this is a real argument'
    signal. 100-up/100-down should beat 5-up/5-down."""
    small = _controversial_score(5, 5)
    big = _controversial_score(100, 100)
    assert big > small


def test_controversial_ordering_examples():
    """Anchor the actual numeric ordering across a handful of shapes so
    a refactor can't quietly reshuffle the Controversial feed without
    a failing test."""
    s_pure_positive = _controversial_score(50, 0)
    s_lopsided      = _controversial_score(10, 1)
    s_balanced_med  = _controversial_score(8, 8)
    s_balanced_big  = _controversial_score(50, 50)
    # Pure positive sinks to the bottom; balanced reviews rise
    assert s_pure_positive == 0
    assert s_lopsided > s_pure_positive
    assert s_balanced_med > s_lopsided
    assert s_balanced_big > s_balanced_med


# ── _signed_url_ttl ────────────────────────────────────────────────────────


def test_signed_url_ttl_with_no_url_returns_fallback():
    """None / empty input doesn't crash — used during cache writes where
    the preview URL is sometimes legitimately absent."""
    result = _signed_url_ttl(None)
    assert result > 0
    result = _signed_url_ttl("")
    assert result > 0


def test_signed_url_ttl_without_hdnea_returns_fallback():
    """A bare URL with no Akamai signature falls back to the default
    short TTL — without this, the cache would store the URL forever and
    the player would 403 on every subsequent serve when the implicit
    Akamai window expired."""
    result = _signed_url_ttl("https://e-cdns-preview-1.dzcdn.net/stream/abc")
    assert result > 0
    assert result < 24 * 3600  # short default, not infinite


def test_signed_url_ttl_parses_future_exp_and_returns_remaining():
    """The whole point — if the URL says it expires at t+900, our TTL
    should be ~900 minus a safety margin (so the cache evicts BEFORE
    the URL actually goes dead)."""
    future_exp = int(time.time()) + 900
    url = f"https://e-cdns-preview-1.dzcdn.net/stream/x?hdnea=exp={future_exp}~acl=/*~hmac=abc123"
    ttl = _signed_url_ttl(url)
    # Should be close to 900, less than 900 (safety margin subtracted)
    assert 60 <= ttl <= 900


def test_signed_url_ttl_floors_at_60_for_expired_urls():
    """An already-expired URL would compute a negative TTL — that'd cause
    the cache to either reject the entry or store-forever depending on
    the cache impl. The 60s floor ensures we always write a small but
    nonzero TTL so the entry leaves cache quickly without breaking the
    write path."""
    past_exp = int(time.time()) - 1000
    url = f"https://e-cdns-preview-1.dzcdn.net/stream/x?hdnea=exp={past_exp}~acl=/*~hmac=abc"
    ttl = _signed_url_ttl(url)
    assert ttl == 60


def test_signed_url_ttl_handles_malformed_exp():
    """Defensive: a URL with `hdnea=exp=notanumber` shouldn't crash, just
    fall back to the default TTL."""
    url = "https://e-cdns-preview-1.dzcdn.net/stream/x?hdnea=exp=notanumber~acl=/*"
    ttl = _signed_url_ttl(url)
    assert ttl > 0
