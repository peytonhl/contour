"""Pin the title+artist match validator that gates Deezer preview-URL
acceptance.

The matcher exists because Deezer's relevance ranker would sometimes
float an unrelated more-popular track above the actual match for a
free-text query (e.g. searching `Kodak Black Honey Bun` returned ZEZE
because ZEZE has higher popularity), and `get_preview` would then cache
the wrong audio URL under the asked-for track's cache key. Reported
2026-05-27 — Honey Bun's deck card played ZEZE.

These tests pin the match semantics so a future "relax the matcher to
catch more edge cases" refactor doesn't silently start accepting
ZEZE-as-Honey-Bun again.
"""
from __future__ import annotations

import pytest

from services.deezer import _is_match, _normalize_for_match


# ── _normalize_for_match: lowercase + strip parens + collapse whitespace ────


def test_normalize_lowercases_and_strips_punct():
    assert _normalize_for_match("Honey Bun!") == "honey bun"
    assert _normalize_for_match("D.A.N.C.E.") == "d a n c e"


def test_normalize_strips_feat_parenthetical():
    assert _normalize_for_match("Honey Bun (feat. Drake)") == "honey bun"
    assert _normalize_for_match("Honey Bun (ft. Drake)") == "honey bun"
    assert _normalize_for_match("Honey Bun (with Drake)") == "honey bun"
    # Bracket variant
    assert _normalize_for_match("Honey Bun [feat. Drake]") == "honey bun"


def test_normalize_keeps_unrelated_parens():
    # Parens that aren't feat. markers stay (well, get punct-stripped but
    # contents preserved). This avoids over-stripping legitimate version
    # suffixes — e.g. "(Live)" tracks should not normalize to the studio
    # version they're not.
    assert _normalize_for_match("Song (Live)") == "song live"


# ── _is_match: the cross-track-contamination guard ──────────────────────────


def test_match_exact():
    assert _is_match("Honey Bun", "Kodak Black", "Honey Bun", "Kodak Black")


def test_match_rejects_different_song_same_artist():
    """The reported bug: searching Honey Bun returned ZEZE. Pin that
    the matcher catches this."""
    assert not _is_match("Honey Bun", "Kodak Black", "ZEZE", "Kodak Black")
    assert not _is_match("Honey Bun", "Kodak Black", "Tunnel Vision", "Kodak Black")


def test_match_rejects_same_song_different_artist():
    """A cover or unrelated artist's song with the same title — don't
    match. (Less common but plausible failure mode.)"""
    assert not _is_match("Honey Bun", "Kodak Black", "Honey Bun", "Some Other Rapper")


def test_match_allows_feat_difference():
    """Spotify and Deezer disagree on how to encode features — Spotify
    often writes "Honey Bun (feat. Drake)" while Deezer might just say
    "Honey Bun" with a separate `contributors` field. Both should match."""
    assert _is_match(
        "Honey Bun (feat. Drake)", "Kodak Black",
        "Honey Bun", "Kodak Black",
    )
    assert _is_match(
        "Honey Bun", "Kodak Black",
        "Honey Bun (feat. Drake)", "Kodak Black",
    )


def test_match_allows_artist_substring():
    """For features, one side may list multiple artists while the other
    lists just the primary. Substring match handles this."""
    assert _is_match(
        "Honey Bun", "Kodak Black",
        "Honey Bun", "Kodak Black, Drake",
    )
    assert _is_match(
        "Honey Bun", "Kodak Black, Drake",
        "Honey Bun", "Kodak Black",
    )


def test_match_handles_case_and_punctuation():
    assert _is_match("Honey Bun!", "Kodak Black", "honey bun", "kodak black")
    assert _is_match("HONEY BUN", "Kodak Black", "Honey Bun", "Kodak Black")


def test_match_rejects_short_title_collision():
    """A title prefix substring match would let "Honey" match "Honeysuckle
    Rose". The matcher uses startswith-with-space-boundary to prevent this."""
    assert not _is_match("Honey", "Artist", "Honeysuckle Rose", "Artist")


def test_match_allows_version_suffix():
    """A version qualifier ("Remastered", "Live", "Sped Up") on one side
    should still match. This is intentional: Deezer often has only one
    version of a track, and rejecting "Honey Bun (Remastered 2020)" when
    we asked for "Honey Bun" would lose the preview entirely.

    Trade-off: a user might get a slightly different mix than they
    expected. Acceptable — the title still identifies the song. Returning
    None means no preview at all, which is worse UX."""
    assert _is_match(
        "Honey Bun", "Kodak Black",
        "Honey Bun (Remastered)", "Kodak Black",
    )
