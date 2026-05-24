"""Tests for services/mentions.py — @-token extraction + DB resolution.

@-mentions touch security (no notification to arbitrary IDs), privacy
(can't @ blocked users into oblivion), and UI rendering (every review
body is parsed). Bugs here are user-visible in two directions:
  • False negative — typed `@peyton` doesn't link, no notification fired.
  • False positive — `peyton@gmail.com` produces a phantom mention.
The regex has historically been the source of subtle bugs (the "rebind r"
incident from session memory was on adjacent code). Tests lock it down.
"""
from __future__ import annotations

import json
import uuid

import pytest

from models import User
from services.mentions import (
    dump_ids,
    extract_mention_tokens,
    load_ids,
    resolve_combined_mentions,
    resolve_mentions,
)


async def _mkuser(db, *, display_name: str) -> User:
    u = User(
        id=str(uuid.uuid4()),
        google_id=f"g_{uuid.uuid4().hex[:8]}",
        email=f"u_{uuid.uuid4().hex[:6]}@example.com",
        display_name=display_name,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


# ── extract_mention_tokens (pure function — no DB) ──────────────────────────


def test_extract_simple_mention():
    assert extract_mention_tokens("@peyton said it") == ["peyton"]


def test_extract_mentions_in_middle_of_text():
    assert extract_mention_tokens("hey @peyton check this") == ["peyton"]


def test_extract_multiple_mentions_in_order():
    assert extract_mention_tokens("@alice and @bob") == ["alice", "bob"]


def test_extract_dedupes_case_insensitively():
    """The DB lookup is case-insensitive (display_name has a functional
    unique index on lower(...)), so the same user mentioned in two cases
    is one mention, not two — otherwise a single user could be fanned-out
    notified twice from one review."""
    assert extract_mention_tokens("@peyton thanks @Peyton") == ["peyton"]


def test_extract_does_not_match_email_addresses():
    """`peyton@gmail.com` is an email, not a mention. The regex has a
    boundary that rejects @ preceded by a name char. Without this rule,
    every review that quotes an email would silently fire mentions."""
    assert extract_mention_tokens("write me at peyton@example.com") == []
    assert extract_mention_tokens("contact: jane.smith@gmail.com please") == []


def test_extract_does_not_match_when_followed_by_more_name_chars():
    """The trailing lookahead ensures `@peyton.dev` doesn't get cut to
    just `peyton` — either the whole thing is a token (peyton.dev) or
    nothing is. Avoids "partial" mentions that don't match the typed
    intent."""
    assert extract_mention_tokens("@peyton.dev cool") == ["peyton.dev"]
    # And `@peyton.` (with a trailing dot before space) — the dot is
    # part of the allowed-char class, so the regex includes it
    # and tests show whatever the current implementation does. The
    # important invariant is "no partial truncation," not the exact
    # behavior around terminal punctuation.


def test_extract_returns_empty_for_blank_input():
    assert extract_mention_tokens("") == []
    assert extract_mention_tokens(None) == []


def test_extract_handles_consecutive_mentions():
    # 2-char minimum per the display_name validator (see auth.py) — single
    # chars like @a don't match; that's a separate test below.
    assert extract_mention_tokens("@al @bo @ce") == ["al", "bo", "ce"]


def test_extract_caps_token_length_to_30():
    """display_name validator caps at 30 chars (see auth.py). A 50-char
    @-token shouldn't match — it can't possibly be a real user."""
    huge = "x" * 50
    assert extract_mention_tokens(f"@{huge}") == []


def test_extract_requires_at_least_2_chars():
    """Pre-validator: a bare `@x` (length 1 after @) is below the
    display_name min of 2."""
    assert extract_mention_tokens("@x") == []


# ── resolve_mentions (regex + DB lookup) ────────────────────────────────────


async def test_resolve_returns_user_ids_for_matched_tokens(db_session):
    alice = await _mkuser(db_session, display_name="Alice")
    bob = await _mkuser(db_session, display_name="Bob")
    ids = await resolve_mentions(db_session, "hey @alice and @bob")
    assert set(ids) == {alice.id, bob.id}


async def test_resolve_preserves_first_appearance_order(db_session):
    """Notification dispatch reads this in order, so if it scrambles the
    sequence the recipient list isn't stable — would cause flaky tests
    AND surprise the writer (who typed @Alice first)."""
    alice = await _mkuser(db_session, display_name="Alice")
    bob = await _mkuser(db_session, display_name="Bob")
    ids = await resolve_mentions(db_session, "@bob and @alice")
    assert ids == [bob.id, alice.id]


async def test_resolve_drops_unknown_tokens_silently(db_session):
    alice = await _mkuser(db_session, display_name="Alice")
    ids = await resolve_mentions(db_session, "@alice @notarealuser @ghost")
    assert ids == [alice.id]


async def test_resolve_is_case_insensitive_against_db(db_session):
    """User registered as `Alice` — the typed `@alice` (lowercase) still
    matches. Without this, every user with a capitalized display name
    would be unreachable via lowercase @-mentions."""
    alice = await _mkuser(db_session, display_name="Alice")
    ids = await resolve_mentions(db_session, "@alice rocks")
    assert ids == [alice.id]


async def test_resolve_excludes_actor_from_self_mention(db_session):
    """Writing `@yourself` in your own review shouldn't fire a notification
    to yourself. The text still renders the mention; just no notif fanout."""
    alice = await _mkuser(db_session, display_name="Alice")
    ids = await resolve_mentions(db_session, "thanks @alice", exclude_user_id=alice.id)
    assert ids == []


async def test_resolve_caps_to_max_mentions(db_session):
    """Spam protection — a body like `@a @b @c ...` shouldn't fan out
    100 notifications. Test the cap by passing a small max."""
    users = [await _mkuser(db_session, display_name=f"User{i}") for i in range(10)]
    body = " ".join(f"@User{i}" for i in range(10))
    ids = await resolve_mentions(db_session, body, max_mentions=3)
    assert len(ids) == 3


# ── resolve_combined_mentions (frontend autocomplete picks + body parse) ────


async def test_combined_uses_client_picks_first(db_session):
    """The frontend autocomplete passes resolved user IDs because it can
    pick multi-word display names that the server regex can't see.
    Validated picks should appear in the output even if the regex misses
    them."""
    multi = await _mkuser(db_session, display_name="Adam Zhang")
    # Body says "@adam" which the regex matches but DB lookup fails (the
    # user's display_name is "Adam Zhang" not "Adam"). The client picked
    # the right user via autocomplete and passes the ID explicitly.
    ids = await resolve_combined_mentions(
        db_session, "hey @adam",
        client_user_ids=[multi.id],
    )
    assert multi.id in ids


async def test_combined_rejects_bogus_client_ids(db_session):
    """A malicious client can't poke arbitrary user IDs into a mention
    list — every ID is validated against the User table first."""
    alice = await _mkuser(db_session, display_name="Alice")
    bogus = str(uuid.uuid4())  # never inserted
    ids = await resolve_combined_mentions(
        db_session, "",
        client_user_ids=[alice.id, bogus],
    )
    assert alice.id in ids
    assert bogus not in ids


async def test_combined_excludes_actor_from_client_picks(db_session):
    """Even if the client says 'mention the actor,' the resolver drops
    the actor's ID — same self-notification protection as the regex path."""
    alice = await _mkuser(db_session, display_name="Alice")
    bob = await _mkuser(db_session, display_name="Bob")
    ids = await resolve_combined_mentions(
        db_session, "",
        client_user_ids=[alice.id, bob.id],
        exclude_user_id=alice.id,
    )
    assert alice.id not in ids
    assert bob.id in ids


async def test_combined_dedupes_picks_and_regex_match(db_session):
    """If both the autocomplete pick AND the regex match resolve to the
    same user, they should appear once in the output (not twice)."""
    alice = await _mkuser(db_session, display_name="Alice")
    ids = await resolve_combined_mentions(
        db_session, "@alice rocks",
        client_user_ids=[alice.id],
    )
    assert ids == [alice.id]


# ── dump_ids / load_ids (storage round-trip) ────────────────────────────────


def test_dump_ids_empty_returns_none_for_null_column():
    """The DB column is nullable; storing NULL is cheaper than storing
    an empty JSON array and lets queries distinguish 'no mentions' from
    'empty list' cheaply."""
    assert dump_ids([]) is None
    assert dump_ids(()) is None


def test_dump_load_roundtrips_a_list():
    ids = ["u1", "u2", "u3"]
    serialized = dump_ids(ids)
    assert isinstance(serialized, str)
    assert load_ids(serialized) == ids


def test_load_ids_tolerates_corrupted_storage():
    """A corrupted row shouldn't break the entire review-list render.
    None / malformed JSON / non-list values all return [] silently."""
    assert load_ids(None) == []
    assert load_ids("") == []
    assert load_ids("not json") == []
    assert load_ids('{"not": "a list"}') == []
    assert load_ids("123") == []
