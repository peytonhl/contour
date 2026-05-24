"""Smoke tests for the backlog + lists CRUD endpoints.

Neither has any test coverage today. Both back user-visible UI surfaces
(profile Lists tab, Want-to-Listen button on every album/track page) and
the lists endpoint mutates a foreign-key-bound child table that's easy to
leak rows from on delete.

What's pinned:
  • Backlog add → idempotent (re-adding the same entry doesn't dupe)
  • Backlog check endpoint reports presence accurately
  • Backlog remove cleans the row
  • List create returns a real ID + persists
  • List get returns the envelope frontend expects (items, owner, is_owner)
  • List update is owner-gated (403 for other users)
  • List delete cascades — UserListItem rows are wiped (no orphans)
  • List items PUT replaces the full set (the reorder/add/remove path)
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

from models import BacklogItem, User, UserList, UserListItem
from routers.auth import _make_jwt


def _bearer(user_id: str) -> dict:
    return {"Authorization": f"Bearer {_make_jwt(user_id)}"}


async def _mkuser(db) -> User:
    u = User(
        id=str(uuid.uuid4()),
        google_id=f"g_{uuid.uuid4().hex[:8]}",
        email=f"u_{uuid.uuid4().hex[:6]}@example.com",
        display_name=f"User_{uuid.uuid4().hex[:6]}",
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


# ── Backlog ─────────────────────────────────────────────────────────────────


async def test_backlog_add_creates_row(client, db_session):
    user = await _mkuser(db_session)
    r = client.post(
        "/backlog",
        json={"entity_type": "album", "entity_id": "4yP0hdKOZPNshxUOjY0cZj"},
        headers=_bearer(user.id),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["already_present"] is False
    # Row landed in DB
    row = (await db_session.execute(
        select(BacklogItem).where(BacklogItem.user_id == user.id)
    )).scalar_one_or_none()
    assert row is not None
    assert row.entity_id == "4yP0hdKOZPNshxUOjY0cZj"


async def test_backlog_add_is_idempotent(client, db_session):
    """Tapping Want-to-Listen twice in a row should be a no-op, not create
    a duplicate. The button is optimistic about state on the client; an
    accidental double-tap shouldn't pollute the list."""
    user = await _mkuser(db_session)
    headers = _bearer(user.id)
    payload = {"entity_type": "album", "entity_id": "4yP0hdKOZPNshxUOjY0cZj"}
    r1 = client.post("/backlog", json=payload, headers=headers)
    assert r1.json()["already_present"] is False
    r2 = client.post("/backlog", json=payload, headers=headers)
    assert r2.json()["already_present"] is True
    # Still only ONE row
    rows = (await db_session.execute(
        select(BacklogItem).where(BacklogItem.user_id == user.id)
    )).scalars().all()
    assert len(rows) == 1


async def test_backlog_check_endpoint_reports_presence(client, db_session):
    user = await _mkuser(db_session)
    headers = _bearer(user.id)
    # Before add: false
    r = client.get("/backlog/check/album/4yP0hdKOZPNshxUOjY0cZj", headers=headers)
    assert r.json() == {"in_backlog": False}
    # After add: true
    client.post(
        "/backlog",
        json={"entity_type": "album", "entity_id": "4yP0hdKOZPNshxUOjY0cZj"},
        headers=headers,
    )
    r = client.get("/backlog/check/album/4yP0hdKOZPNshxUOjY0cZj", headers=headers)
    assert r.json() == {"in_backlog": True}


async def test_backlog_remove_clears_row(client, db_session):
    user = await _mkuser(db_session)
    headers = _bearer(user.id)
    client.post(
        "/backlog",
        json={"entity_type": "album", "entity_id": "4yP0hdKOZPNshxUOjY0cZj"},
        headers=headers,
    )
    r = client.delete("/backlog/album/4yP0hdKOZPNshxUOjY0cZj", headers=headers)
    assert r.status_code == 200
    rows = (await db_session.execute(
        select(BacklogItem).where(BacklogItem.user_id == user.id)
    )).scalars().all()
    assert rows == []


async def test_backlog_unauthenticated_check_returns_false_not_401(client):
    """The check endpoint is hit on every entity-page render — even by
    signed-out browsers — to decide whether to show '+ Want to listen' or
    '✓ In backlog.' Returning 401 to anonymous viewers would spam errors
    on every album page load. Returns false instead."""
    r = client.get("/backlog/check/album/4yP0hdKOZPNshxUOjY0cZj")
    assert r.status_code == 200
    assert r.json() == {"in_backlog": False}


# ── Lists ───────────────────────────────────────────────────────────────────


async def test_create_list_returns_id_and_persists(client, db_session):
    user = await _mkuser(db_session)
    r = client.post(
        "/lists/",
        json={"title": "Best 2024 records", "description": "rolling top-10", "is_ranked": True},
        headers=_bearer(user.id),
    )
    assert r.status_code == 200
    body = r.json()
    assert "id" in body
    assert body["title"] == "Best 2024 records"
    row = (await db_session.execute(
        select(UserList).where(UserList.id == body["id"])
    )).scalar_one_or_none()
    assert row is not None
    assert row.user_id == user.id


async def test_create_list_rejects_empty_title(client, db_session):
    user = await _mkuser(db_session)
    r = client.post(
        "/lists/",
        json={"title": "   ", "is_ranked": False},
        headers=_bearer(user.id),
    )
    assert r.status_code == 400


async def test_get_list_returns_expected_envelope(client, db_session):
    """ListDetailPage reads this exact shape — if a field renames the page
    crashes silently. Pin the keys so the frontend contract is stable."""
    user = await _mkuser(db_session)
    created = client.post(
        "/lists/",
        json={"title": "T", "is_ranked": False},
        headers=_bearer(user.id),
    ).json()
    r = client.get(f"/lists/{created['id']}", headers=_bearer(user.id))
    assert r.status_code == 200
    body = r.json()
    assert {"id", "title", "description", "is_ranked", "items",
            "item_count", "is_owner", "owner"}.issubset(body.keys())
    assert body["is_owner"] is True


async def test_update_list_is_owner_gated(client, db_session):
    """Another user PATCHing my list must get 403, not 200. Without this,
    any signed-in user could rename arbitrary lists."""
    owner = await _mkuser(db_session)
    intruder = await _mkuser(db_session)
    lst = client.post(
        "/lists/",
        json={"title": "mine", "is_ranked": False},
        headers=_bearer(owner.id),
    ).json()
    r = client.patch(
        f"/lists/{lst['id']}",
        json={"title": "yours"},
        headers=_bearer(intruder.id),
    )
    assert r.status_code == 403


async def test_delete_list_cascades_to_items(client, db_session):
    """Deleting a list must wipe its UserListItem rows. No FK enforcement
    in the schema (per the explicit-cascade pattern this codebase uses);
    if the endpoint forgets to delete items, they accumulate forever as
    orphans pointing at a list_id that no longer exists."""
    user = await _mkuser(db_session)
    headers = _bearer(user.id)
    lst = client.post(
        "/lists/",
        json={"title": "Doomed", "is_ranked": False},
        headers=headers,
    ).json()
    # Add an item via PUT /items
    client.put(
        f"/lists/{lst['id']}/items",
        json={"items": [{"entity_type": "album", "entity_id": "spotify_x", "position": 0}]},
        headers=headers,
    )
    # Confirm item landed
    items = (await db_session.execute(
        select(UserListItem).where(UserListItem.list_id == lst["id"])
    )).scalars().all()
    assert len(items) == 1
    # Delete the list
    r = client.delete(f"/lists/{lst['id']}", headers=headers)
    assert r.status_code == 200
    # Item rows should be gone
    items_after = (await db_session.execute(
        select(UserListItem).where(UserListItem.list_id == lst["id"])
    )).scalars().all()
    assert items_after == [], "list items orphaned after parent list delete"


async def test_put_items_replaces_full_set(client, db_session):
    """PUT /items is full-replace semantics (sends the whole desired array
    each call). After PUT'ing 2 items then PUT'ing 1 different item, only
    the 1 should remain. Without this guarantee the frontend reorder /
    remove flows leave ghost rows."""
    user = await _mkuser(db_session)
    headers = _bearer(user.id)
    lst = client.post(
        "/lists/",
        json={"title": "Test", "is_ranked": False},
        headers=headers,
    ).json()
    # Put 2 items
    client.put(
        f"/lists/{lst['id']}/items",
        json={"items": [
            {"entity_type": "album", "entity_id": "a", "position": 0},
            {"entity_type": "album", "entity_id": "b", "position": 1},
        ]},
        headers=headers,
    )
    # Replace with a single different item
    client.put(
        f"/lists/{lst['id']}/items",
        json={"items": [
            {"entity_type": "track", "entity_id": "c", "position": 0},
        ]},
        headers=headers,
    )
    items = (await db_session.execute(
        select(UserListItem).where(UserListItem.list_id == lst["id"])
    )).scalars().all()
    assert len(items) == 1
    assert items[0].entity_id == "c"
