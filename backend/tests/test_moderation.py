"""Tests for the UGC moderation flow (block / report / admin resolution).

Covers:
  • Block a user, then unblock — both idempotent.
  • List my blocks.
  • Submit a report; second identical submission dedupes.
  • Blocked user's reviews disappear from the global feed.
  • Admin endpoints require is_admin.
  • Admin can resolve a report and hard-delete content.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from models import ContentReport, Review, User, UserBlock
from routers.auth import _make_jwt


def _bearer(user_id: str) -> dict:
    return {"Authorization": f"Bearer {_make_jwt(user_id)}"}


async def _mkuser(db, *, is_admin: bool = False, email: str | None = None) -> User:
    u = User(
        id=str(uuid.uuid4()),
        google_id=f"g_{uuid.uuid4().hex[:8]}",
        email=email or f"u_{uuid.uuid4().hex[:6]}@example.com",
        display_name=f"User_{uuid.uuid4().hex[:6]}",
        is_admin=is_admin,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


# ── Block / unblock ──────────────────────────────────────────────────────────


async def test_block_and_unblock_user(client, db_session):
    alice = await _mkuser(db_session)
    bob = await _mkuser(db_session)

    r = client.post(f"/moderation/block/{bob.id}", headers=_bearer(alice.id))
    assert r.status_code == 200
    assert r.json() == {"blocked": True, "already": False}

    # Second block — idempotent
    r = client.post(f"/moderation/block/{bob.id}", headers=_bearer(alice.id))
    assert r.json() == {"blocked": True, "already": True}

    rows = (await db_session.execute(
        select(UserBlock).where(UserBlock.blocker_user_id == alice.id)
    )).scalars().all()
    assert len(rows) == 1

    # Unblock
    r = client.delete(f"/moderation/block/{bob.id}", headers=_bearer(alice.id))
    assert r.status_code == 200
    assert r.json() == {"blocked": False}

    rows = (await db_session.execute(
        select(UserBlock).where(UserBlock.blocker_user_id == alice.id)
    )).scalars().all()
    assert len(rows) == 0


async def test_cannot_block_self(client, db_session):
    alice = await _mkuser(db_session)
    r = client.post(f"/moderation/block/{alice.id}", headers=_bearer(alice.id))
    assert r.status_code == 400


async def test_list_my_blocks(client, db_session):
    alice = await _mkuser(db_session)
    bob = await _mkuser(db_session)
    carol = await _mkuser(db_session)

    client.post(f"/moderation/block/{bob.id}", headers=_bearer(alice.id))
    client.post(f"/moderation/block/{carol.id}", headers=_bearer(alice.id))

    r = client.get("/moderation/blocks", headers=_bearer(alice.id))
    assert r.status_code == 200
    body = r.json()
    blocked_ids = {b["user_id"] for b in body}
    assert blocked_ids == {bob.id, carol.id}


# ── Reports ──────────────────────────────────────────────────────────────────


async def test_submit_report_dedupes(client, db_session):
    alice = await _mkuser(db_session)
    bob = await _mkuser(db_session)

    review = Review(
        user_id=bob.id, entity_type="album", entity_id="alb1", body="bad review",
    )
    db_session.add(review)
    await db_session.commit()
    await db_session.refresh(review)

    payload = {"target_type": "review", "target_id": review.id, "reason": "spam"}

    r1 = client.post("/moderation/reports", headers=_bearer(alice.id), json=payload)
    assert r1.status_code == 200
    assert r1.json()["duplicate"] is False

    r2 = client.post("/moderation/reports", headers=_bearer(alice.id), json=payload)
    assert r2.status_code == 200
    assert r2.json()["duplicate"] is True
    assert r2.json()["report_id"] == r1.json()["report_id"]

    rows = (await db_session.execute(select(ContentReport))).scalars().all()
    assert len(rows) == 1


async def test_report_validates_reason(client, db_session):
    alice = await _mkuser(db_session)
    bob = await _mkuser(db_session)
    review = Review(user_id=bob.id, entity_type="album", entity_id="alb1", body="x")
    db_session.add(review); await db_session.commit(); await db_session.refresh(review)

    r = client.post("/moderation/reports", headers=_bearer(alice.id), json={
        "target_type": "review", "target_id": review.id, "reason": "made_up_reason",
    })
    assert r.status_code == 400


# ── Block filter applies to review listings ──────────────────────────────────


async def test_blocked_users_reviews_hidden_from_global_feed(client, db_session):
    alice = await _mkuser(db_session)
    bob = await _mkuser(db_session)

    # Bob writes a review
    db_session.add(Review(
        user_id=bob.id, entity_type="album", entity_id="alb1",
        body="Bob's review",
    ))
    await db_session.commit()

    # Before block — Alice can see Bob's review.
    # Response shape changed from a flat list to {items, has_more}
    # in commit 7145cf2 (pagination on /reviews/global) — pull the
    # items array out instead of iterating the dict.
    r = client.get("/reviews/global", headers=_bearer(alice.id))
    assert r.status_code == 200
    bodies = [rev["body"] for rev in r.json()["items"]]
    assert "Bob's review" in bodies

    # Alice blocks Bob
    client.post(f"/moderation/block/{bob.id}", headers=_bearer(alice.id))

    # After block — Bob's review is filtered out for Alice
    r = client.get("/reviews/global", headers=_bearer(alice.id))
    bodies = [rev["body"] for rev in r.json()["items"]]
    assert "Bob's review" not in bodies


# ── Admin endpoints ──────────────────────────────────────────────────────────


async def test_admin_endpoints_require_is_admin(client, db_session):
    regular = await _mkuser(db_session, is_admin=False)
    r = client.get("/moderation/reports", headers=_bearer(regular.id))
    assert r.status_code == 403


async def test_admin_can_resolve_and_delete_content(client, db_session):
    admin = await _mkuser(db_session, is_admin=True)
    alice = await _mkuser(db_session)
    bob = await _mkuser(db_session)

    review = Review(user_id=bob.id, entity_type="album", entity_id="alb1", body="bad")
    db_session.add(review); await db_session.commit(); await db_session.refresh(review)

    # Alice files a report
    client.post("/moderation/reports", headers=_bearer(alice.id), json={
        "target_type": "review", "target_id": review.id, "reason": "harassment",
    })

    # Admin lists open reports
    r = client.get("/moderation/reports", headers=_bearer(admin.id))
    assert r.status_code == 200
    reports = r.json()
    assert len(reports) == 1
    report_id = reports[0]["id"]

    # Admin resolves + deletes the review
    r = client.patch(f"/moderation/reports/{report_id}",
                     headers=_bearer(admin.id),
                     json={"status": "resolved", "delete_content": True})
    assert r.status_code == 200
    assert r.json()["content_deleted"] is True

    # Review is gone from the DB
    remaining = (await db_session.execute(
        select(Review).where(Review.id == review.id)
    )).scalar_one_or_none()
    assert remaining is None

    # Report shows up under "resolved"
    r = client.get("/moderation/reports?status=resolved", headers=_bearer(admin.id))
    assert any(rep["id"] == report_id and rep["status"] == "resolved" for rep in r.json())
