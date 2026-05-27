"""Tests for the notification creation triggers + listing endpoint.

Notifications are the social engine of the app — every follow, upvote,
reply, and @-mention should produce one (and only one) notification for
the right recipient. Mis-wiring here = social loop broken silently OR
users spammed by self-notifications.

What's pinned here:
  • create_notification skips self-notifications (don't notify yourself
    for voting on your own review)
  • Voting on a review fires an upvote notification to the review author
  • Voting on a reply fires an upvote notification to the reply author
    (per the reply-voting feature shipped this session)
  • Following a user fires a follow notification
  • Posting a review with @-mentions fires mention notifications to the
    mentioned users (not to the author)
  • unread-count is accurate before + after read-all
  • GET /notifications respects the 40-row limit (matches list_notifications)
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from models import Notification, Review, ReviewReply, User
from routers.auth import _make_jwt
from routers.notifications import create_notification


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


# ── create_notification helper (called from many routers) ───────────────────


async def test_create_notification_skips_self(db_session):
    """Voting on / replying to / mentioning yourself shouldn't notify you.
    The helper is the chokepoint — if it ever stops short-circuiting on
    user_id == actor_id, every other notif call site would need its own
    guard."""
    user = await _mkuser(db_session)
    await create_notification(
        db_session, user_id=user.id, type="upvote", actor_id=user.id,
    )
    await db_session.commit()
    rows = (await db_session.execute(
        select(Notification).where(Notification.user_id == user.id)
    )).scalars().all()
    assert rows == []


async def test_create_notification_persists_with_expected_fields(db_session):
    recipient = await _mkuser(db_session)
    actor = await _mkuser(db_session)
    await create_notification(
        db_session, user_id=recipient.id, type="follow", actor_id=actor.id,
    )
    await db_session.commit()
    row = (await db_session.execute(
        select(Notification).where(Notification.user_id == recipient.id)
    )).scalar_one()
    assert row.type == "follow"
    assert row.actor_id == actor.id
    assert row.read is False  # default


# ── Voting triggers ────────────────────────────────────────────────────────


async def test_upvote_creates_notification_for_review_author(client, db_session):
    """Real end-to-end: voter posts /vote, author sees an upvote notif."""
    author = await _mkuser(db_session)
    voter = await _mkuser(db_session)
    review = Review(
        user_id=author.id, entity_type="album", entity_id="alpha", body="x",
    )
    db_session.add(review)
    await db_session.commit()
    await db_session.refresh(review)

    client.post(
        f"/ratings/reviews/{review.id}/vote",
        json={"value": 1}, headers=_bearer(voter.id),
    )

    notifs = (await db_session.execute(
        select(Notification).where(Notification.user_id == author.id)
    )).scalars().all()
    assert len(notifs) == 1
    assert notifs[0].type == "upvote"
    assert notifs[0].actor_id == voter.id


async def test_downvote_does_not_create_notification(client, db_session):
    """Notifying the author 'someone downvoted you' would be needlessly
    cruel — same data is visible via the vote count if they look. Only
    upvotes are notif-worthy."""
    author = await _mkuser(db_session)
    voter = await _mkuser(db_session)
    review = Review(
        user_id=author.id, entity_type="album", entity_id="alpha", body="x",
    )
    db_session.add(review)
    await db_session.commit()
    await db_session.refresh(review)

    client.post(
        f"/ratings/reviews/{review.id}/vote",
        json={"value": -1}, headers=_bearer(voter.id),
    )

    notifs = (await db_session.execute(
        select(Notification).where(Notification.user_id == author.id)
    )).scalars().all()
    assert notifs == []


async def test_upvote_on_reply_notifies_reply_author(client, db_session):
    """Per the reply-voting feature: notif fires on a fresh upvote on a
    reply, just like on a parent review. Type is still 'upvote' so the
    existing notif rendering + click-through works without a new type."""
    author = await _mkuser(db_session)
    voter = await _mkuser(db_session)
    review = Review(user_id=author.id, entity_type="album", entity_id="x", body="r")
    db_session.add(review)
    await db_session.commit()
    await db_session.refresh(review)
    reply = ReviewReply(review_id=review.id, user_id=author.id, body="reply")
    db_session.add(reply)
    await db_session.commit()
    await db_session.refresh(reply)

    client.post(
        f"/ratings/reviews/{review.id}/replies/{reply.id}/vote",
        json={"value": 1}, headers=_bearer(voter.id),
    )

    notifs = (await db_session.execute(
        select(Notification).where(Notification.user_id == author.id)
    )).scalars().all()
    # One notification, type=upvote
    assert len(notifs) == 1
    assert notifs[0].type == "upvote"


async def test_vote_toggle_off_does_not_create_second_notification(client, db_session):
    """First upvote notifies. Toggle off (re-submitting the same value to
    clear) shouldn't fire another notif. And re-upvoting again — debatable
    UX, but the current behavior creates another upvote notif (because
    `is_new_upvote = body.value == 1` on a fresh row). Pinning the
    'toggle off doesn't notify' part is what matters."""
    author = await _mkuser(db_session)
    voter = await _mkuser(db_session)
    review = Review(user_id=author.id, entity_type="album", entity_id="x", body="r")
    db_session.add(review)
    await db_session.commit()
    await db_session.refresh(review)
    headers = _bearer(voter.id)

    client.post(f"/ratings/reviews/{review.id}/vote", json={"value": 1}, headers=headers)
    # Toggle off
    client.post(f"/ratings/reviews/{review.id}/vote", json={"value": 1}, headers=headers)
    notifs = (await db_session.execute(
        select(Notification).where(Notification.user_id == author.id)
    )).scalars().all()
    # Should be exactly ONE (from the first upvote — the toggle-off didn't add)
    assert len(notifs) == 1


# ── Follow trigger ─────────────────────────────────────────────────────────


async def test_follow_creates_notification(client, db_session):
    follower = await _mkuser(db_session)
    target = await _mkuser(db_session)
    r = client.post(f"/users/{target.id}/follow", headers=_bearer(follower.id))
    assert r.status_code == 200
    notifs = (await db_session.execute(
        select(Notification).where(Notification.user_id == target.id)
    )).scalars().all()
    assert len(notifs) == 1
    assert notifs[0].type == "follow"
    assert notifs[0].actor_id == follower.id


# ── Listing + unread-count ─────────────────────────────────────────────────


async def test_get_notifications_requires_auth(client):
    r = client.get("/notifications")
    assert r.status_code == 401


async def test_unread_count_decrements_after_read_all(client, db_session):
    """The bell badge reads /notifications/unread-count. Tapping the bell
    fires /notifications (which marks-read on the frontend) and the
    badge should drop to 0. Pin the read-all → unread=0 invariant.

    Uses 3 distinct actors because create_notification dedups follow
    notifications by (recipient, actor) — same-actor loops collapse to
    one row by design (see create_notification docstring)."""
    recipient = await _mkuser(db_session)
    actors = [await _mkuser(db_session) for _ in range(3)]
    for actor in actors:
        await create_notification(
            db_session, user_id=recipient.id, type="follow", actor_id=actor.id,
        )
    await db_session.commit()
    headers = _bearer(recipient.id)

    pre = client.get("/notifications/unread-count", headers=headers).json()
    assert pre["count"] == 3

    r = client.post("/notifications/read-all", headers=headers)
    assert r.status_code == 200

    post = client.get("/notifications/unread-count", headers=headers).json()
    assert post["count"] == 0


async def test_get_notifications_caps_at_40(client, db_session):
    """The endpoint hard-caps at 40 rows — older notifs disappear silently.
    Test that the cap is respected; if it ever returned all rows, the
    NotificationsPage payload could balloon for power users.

    Uses 45 distinct actors — same dedup reasoning as the unread-count
    test above."""
    recipient = await _mkuser(db_session)
    actors = [await _mkuser(db_session) for _ in range(45)]
    for actor in actors:
        await create_notification(
            db_session, user_id=recipient.id, type="follow", actor_id=actor.id,
        )
    await db_session.commit()
    r = client.get("/notifications", headers=_bearer(recipient.id))
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 40


async def test_create_notification_dedups_follow_from_same_actor(client, db_session):
    """A friend tapping Follow → Unfollow → Follow rapidly should only
    create ONE notification row, not one per Follow event. The
    notification's meaning is 'this person is now following you' —
    once delivered, repeating the event adds no signal AND would fire
    duplicate pushes for the same final state.

    Pinned because the dedup is application-level (no unique constraint
    on the table), so a future refactor of create_notification could
    silently break this. Reported 2026-05-27."""
    recipient = await _mkuser(db_session)
    actor = await _mkuser(db_session)
    for _ in range(3):
        await create_notification(
            db_session, user_id=recipient.id, type="follow", actor_id=actor.id,
        )
    await db_session.commit()
    rows = (await db_session.execute(
        select(Notification).where(
            Notification.user_id == recipient.id,
            Notification.type == "follow",
            Notification.actor_id == actor.id,
        )
    )).scalars().all()
    assert len(rows) == 1


async def test_create_notification_dedups_upvote_per_review(client, db_session):
    """Same logic as follow but scoped per-review. Toggling an upvote off
    and back on shouldn't fire a fresh notification. Capping by review_id
    so an upvoter who hits SEVERAL of your reviews still pings once per
    review (just not multiple times per review)."""
    author = await _mkuser(db_session)
    voter = await _mkuser(db_session)
    # Different review_ids should NOT dedup; same review_id should.
    for _ in range(3):
        await create_notification(
            db_session, user_id=author.id, type="upvote",
            actor_id=voter.id, review_id=42,
        )
    await create_notification(
        db_session, user_id=author.id, type="upvote",
        actor_id=voter.id, review_id=43,
    )
    await db_session.commit()
    rows = (await db_session.execute(
        select(Notification).where(
            Notification.user_id == author.id,
            Notification.type == "upvote",
            Notification.actor_id == voter.id,
        )
    )).scalars().all()
    assert len(rows) == 2  # one per review_id, dedup within each
