"""Smoke tests for the pagination + voting paths shipped in this session.

These exist to lock down the contracts that the frontend depends on:
  - Every paginated endpoint returns `{items, has_more, total}`, not a bare list.
  - Sort runs over the full pool BEFORE the slice on review pagination, so
    "top"/"controversial" ranks stay stable across pages.
  - Reply votes live in a separate table so they NEVER feed into the parent
    review's controversial-sort score. (User-requested invariant.)
  - The vote endpoint cross-checks reply.review_id against the URL's review_id
    so a client can't forge a vote into another thread.
  - Alembic has a single head (the bug I caused 2026-05-22 — branching tree
    crashed app startup on Railway with no signal beyond 502s).
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from models import Review, ReviewReply, ReviewReplyVote, ReviewVote, User, UserList
from routers.auth import _make_jwt


def _bearer(user_id: str) -> dict:
    return {"Authorization": f"Bearer {_make_jwt(user_id)}"}


async def _mkuser(db, *, display_name: str | None = None) -> User:
    u = User(
        id=str(uuid.uuid4()),
        google_id=f"g_{uuid.uuid4().hex[:8]}",
        email=f"u_{uuid.uuid4().hex[:6]}@example.com",
        display_name=display_name or f"User_{uuid.uuid4().hex[:6]}",
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _mkreview(db, *, user: User, entity_id: str = "spotify_test_album", body: str = "great") -> Review:
    r = Review(
        user_id=user.id,
        entity_type="album",
        entity_id=entity_id,
        body=body,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


# ── Pagination envelope shape ────────────────────────────────────────────────


async def test_reviews_endpoint_returns_envelope_when_empty(client):
    """Fresh DB, never-seen album → must return the envelope, NOT a bare list.
    The frontend's `revs.items ?? []` unwrap would explode on a bare list."""
    r = client.get("/ratings/album/never-seen-album/reviews?limit=20&offset=0")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict), f"expected envelope dict, got {type(body).__name__}"
    assert set(body.keys()) >= {"items", "has_more", "total"}
    assert body["items"] == []
    assert body["has_more"] is False
    assert body["total"] == 0


async def test_reviews_pagination_slices_and_reports_has_more(client, db_session):
    user = await _mkuser(db_session)
    # 25 reviews on the same album so we cross the default 20-page boundary
    for i in range(25):
        await _mkreview(db_session, user=user, body=f"r{i}")
    # Page 1 of 20
    r1 = client.get("/ratings/album/spotify_test_album/reviews?limit=20&offset=0")
    assert r1.status_code == 200
    p1 = r1.json()
    assert p1["total"] == 25
    assert len(p1["items"]) == 20
    assert p1["has_more"] is True
    # Page 2 picks up the remaining 5
    r2 = client.get("/ratings/album/spotify_test_album/reviews?limit=20&offset=20")
    p2 = r2.json()
    assert len(p2["items"]) == 5
    assert p2["has_more"] is False
    # No overlap between page 1 and page 2 — protects against an off-by-one
    # in offset/limit math that could re-show the same reviews
    p1_ids = {r["id"] for r in p1["items"]}
    p2_ids = {r["id"] for r in p2["items"]}
    assert p1_ids.isdisjoint(p2_ids), "pagination overlap — same review appeared on two pages"


async def test_reviews_top_sort_is_stable_across_pages(client, db_session):
    """Sort runs over the FULL pool before slicing (not per-page). If this
    breaks, the frontend's "Load more" would show out-of-order rows."""
    user = await _mkuser(db_session)
    # Make 5 reviews; pre-vote them with different scores so "top" has a real order
    reviews = []
    for i in range(5):
        r = await _mkreview(db_session, user=user, body=f"r{i}")
        reviews.append(r)
        # Give review i a number of upvotes equal to i (so r4 ranks highest)
        for j in range(i):
            voter = await _mkuser(db_session)
            db_session.add(ReviewVote(user_id=voter.id, review_id=r.id, value=1))
        await db_session.commit()

    # Page 1 (top 2) + page 2 (next 3), combined, should be ordered r4, r3, r2, r1, r0
    p1 = client.get("/ratings/album/spotify_test_album/reviews?sort=top&limit=2&offset=0").json()
    p2 = client.get("/ratings/album/spotify_test_album/reviews?sort=top&limit=2&offset=2").json()
    p3 = client.get("/ratings/album/spotify_test_album/reviews?sort=top&limit=2&offset=4").json()
    combined = [*p1["items"], *p2["items"], *p3["items"]]
    upvote_seq = [r["upvotes"] for r in combined]
    assert upvote_seq == sorted(upvote_seq, reverse=True), (
        f"top sort not stable across pages: {upvote_seq}"
    )


async def test_replies_endpoint_returns_envelope_when_empty(client, db_session):
    user = await _mkuser(db_session)
    review = await _mkreview(db_session, user=user)
    r = client.get(f"/ratings/reviews/{review.id}/replies?limit=50&offset=0")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict)
    assert set(body.keys()) >= {"items", "has_more", "total"}
    assert body["items"] == []


async def test_user_lists_endpoint_returns_envelope(client, db_session):
    user = await _mkuser(db_session)
    r = client.get(f"/users/{user.id}/lists?limit=20&offset=0")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict), f"user lists endpoint must return envelope; got {type(body).__name__}"
    assert set(body.keys()) >= {"items", "has_more", "total"}


# ── Voting ──────────────────────────────────────────────────────────────────


async def test_vote_review_requires_auth(client, db_session):
    user = await _mkuser(db_session)
    review = await _mkreview(db_session, user=user)
    r = client.post(f"/ratings/reviews/{review.id}/vote", json={"value": 1})
    assert r.status_code == 401


async def test_vote_review_toggle_off_when_same_value_resubmitted(client, db_session):
    author = await _mkuser(db_session)
    voter = await _mkuser(db_session)
    review = await _mkreview(db_session, user=author)
    headers = _bearer(voter.id)

    # First upvote
    r1 = client.post(f"/ratings/reviews/{review.id}/vote", json={"value": 1}, headers=headers)
    assert r1.json() == {"upvotes": 1, "downvotes": 0, "user_vote": 1}
    # Re-submit same value → toggle off
    r2 = client.post(f"/ratings/reviews/{review.id}/vote", json={"value": 1}, headers=headers)
    assert r2.json() == {"upvotes": 0, "downvotes": 0, "user_vote": None}
    # Switch to downvote
    r3 = client.post(f"/ratings/reviews/{review.id}/vote", json={"value": -1}, headers=headers)
    assert r3.json() == {"upvotes": 0, "downvotes": 1, "user_vote": -1}


# ── Reply votes — the hierarchy invariant ───────────────────────────────────


async def test_reply_votes_do_not_affect_review_controversial_score(client, db_session):
    """User-requested invariant: reply votes never bubble into the parent
    review's ranking. Implementation guarantee: reply votes live in a
    separate table (ReviewReplyVote), so the review-level scorer never
    sees them. This test pins that contract."""
    author = await _mkuser(db_session)
    voter_a = await _mkuser(db_session)
    voter_b = await _mkuser(db_session)
    review = await _mkreview(db_session, user=author)
    reply = ReviewReply(
        review_id=review.id,
        user_id=author.id,
        body="reply body",
    )
    db_session.add(reply)
    await db_session.commit()
    await db_session.refresh(reply)

    # Pile a balanced controversial-shaped vote pattern onto the REPLY
    headers_a = _bearer(voter_a.id)
    headers_b = _bearer(voter_b.id)
    client.post(f"/ratings/reviews/{review.id}/replies/{reply.id}/vote",
                json={"value": 1}, headers=headers_a)
    client.post(f"/ratings/reviews/{review.id}/replies/{reply.id}/vote",
                json={"value": -1}, headers=headers_b)

    # Verify the reply vote stuck
    reply_votes = (await db_session.execute(
        select(ReviewReplyVote).where(ReviewReplyVote.reply_id == reply.id)
    )).scalars().all()
    assert len(reply_votes) == 2

    # Verify the parent review's vote table is untouched
    review_votes = (await db_session.execute(
        select(ReviewVote).where(ReviewVote.review_id == review.id)
    )).scalars().all()
    assert review_votes == [], "reply votes leaked into the parent review's vote table"

    # Confirm review's controversial sort is unaffected — endpoint should
    # return the review with upvotes=0, downvotes=0 regardless of reply votes
    feed = client.get("/ratings/album/spotify_test_album/reviews?sort=controversial").json()
    items = feed["items"]
    assert len(items) == 1
    assert items[0]["upvotes"] == 0
    assert items[0]["downvotes"] == 0


async def test_vote_reply_rejects_cross_thread_review_id(client, db_session):
    """A client can't vote on reply R by passing a different review_id in the
    URL — the endpoint cross-checks reply.review_id against the URL value."""
    author = await _mkuser(db_session)
    voter = await _mkuser(db_session)
    review_a = await _mkreview(db_session, user=author, entity_id="album_a")
    review_b = await _mkreview(db_session, user=author, entity_id="album_b")
    reply_on_a = ReviewReply(
        review_id=review_a.id,
        user_id=author.id,
        body="on a",
    )
    db_session.add(reply_on_a)
    await db_session.commit()
    await db_session.refresh(reply_on_a)

    # Vote on reply_on_a via review_a's URL — should succeed
    ok = client.post(
        f"/ratings/reviews/{review_a.id}/replies/{reply_on_a.id}/vote",
        json={"value": 1}, headers=_bearer(voter.id),
    )
    assert ok.status_code == 200

    # Vote on reply_on_a via review_b's URL — should be rejected as 400
    bad = client.post(
        f"/ratings/reviews/{review_b.id}/replies/{reply_on_a.id}/vote",
        json={"value": 1}, headers=_bearer(voter.id),
    )
    assert bad.status_code == 400


# ── Alembic head check ─────────────────────────────────────────────────────


def test_alembic_has_single_head():
    """Branching migration trees crash app startup on Railway with nothing
    but 502s to indicate why. I caused exactly this bug 2026-05-22 by
    pointing a new migration's down_revision at the wrong parent. This
    test runs the same check the application boot would have made."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from pathlib import Path

    backend_dir = Path(__file__).parent.parent
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    scripts = ScriptDirectory.from_config(cfg)
    heads = scripts.get_heads()
    assert len(heads) == 1, (
        f"Alembic migration tree has {len(heads)} heads: {heads}. "
        "Branching trees crash app startup. Check that the most recent "
        "migration's down_revision points at the previous head."
    )
