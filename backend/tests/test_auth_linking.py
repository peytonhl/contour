"""Tests for cross-provider account linking in /auth/callback and /auth/apple.

Covers the 10 scenarios specified for the Sign in with Apple milestone:

  1.  Google fresh signup → google_id set, apple_sub null
  2.  Apple fresh signup  → apple_sub set, google_id null
  3.  Google then Apple (same real email) → existing account linked, no duplicate
  4.  Apple then Google  (same real email) → existing account linked, no duplicate
  5.  Apple with private relay email, no existing match → new account, no linking
  6.  Two Apple sign-ins (same sub) → same user returned both times
  7.  Token with invalid signature → 401
  8.  Token with expired exp → 401
  9.  Token with wrong aud claim → 401
  10. Token with wrong iss claim → 401

All Apple token verification uses an in-process RSA keypair via the autouse
`mock_apple_jwks` fixture in conftest.py. Google's external HTTP calls are
patched via `mock_google_callback`.
"""
from __future__ import annotations

import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from models import User


# ── 1. Google fresh signup ───────────────────────────────────────────────────


async def test_google_fresh_signup_creates_user_with_only_google_id(
    client, db_session, mock_google_callback
):
    mock_google_callback({
        "id": "google-user-1",
        "email": "alice@example.com",
        "name": "Alice",
        "picture": "https://example.com/alice.jpg",
    })

    resp = client.get("/auth/callback?code=fake", follow_redirects=False)
    # Backend redirects to /auth/success with a token
    assert resp.status_code in (302, 307)
    assert "/auth/success?token=" in resp.headers["location"]
    assert "provider=google" in resp.headers["location"]

    users = (await db_session.execute(select(User))).scalars().all()
    assert len(users) == 1
    assert users[0].google_id == "google-user-1"
    assert users[0].apple_sub is None
    assert users[0].email == "alice@example.com"


# ── 2. Apple fresh signup ────────────────────────────────────────────────────


async def test_apple_fresh_signup_creates_user_with_only_apple_sub(
    client, db_session, apple_token_factory
):
    token = apple_token_factory(sub="apple-bob", email="bob@example.com")

    resp = client.post("/auth/apple", json={"identity_token": token, "name": "Bob"})
    assert resp.status_code == 200
    body = resp.json()
    assert "token" in body
    assert body["provider"] == "apple"

    users = (await db_session.execute(select(User))).scalars().all()
    assert len(users) == 1
    assert users[0].apple_sub == "apple-bob"
    assert users[0].google_id is None
    assert users[0].email == "bob@example.com"
    assert users[0].display_name == "Bob"


# ── 3. Google then Apple, same real email → linked ──────────────────────────


async def test_google_then_apple_links_via_real_email(
    client, db_session, mock_google_callback, apple_token_factory
):
    # Step 1: User signs up with Google
    mock_google_callback({
        "id": "google-carol",
        "email": "carol@example.com",
        "name": "Carol",
        "picture": None,
    })
    client.get("/auth/callback?code=fake", follow_redirects=False)

    # Step 2: Same human signs in with Apple, using the same real email
    token = apple_token_factory(sub="apple-carol", email="carol@example.com")
    resp = client.post("/auth/apple", json={"identity_token": token})
    assert resp.status_code == 200

    # Should be a single user with BOTH identities linked
    users = (await db_session.execute(select(User))).scalars().all()
    assert len(users) == 1, "Cross-provider linking must not create a duplicate"
    assert users[0].google_id == "google-carol"
    assert users[0].apple_sub == "apple-carol"
    assert users[0].email == "carol@example.com"


# ── 4. Apple then Google, same real email → linked ──────────────────────────


async def test_apple_then_google_links_via_real_email(
    client, db_session, mock_google_callback, apple_token_factory
):
    # Step 1: Apple-first signup
    token = apple_token_factory(sub="apple-dan", email="dan@example.com")
    client.post("/auth/apple", json={"identity_token": token, "name": "Dan"})

    # Step 2: Same human signs in with Google using same email
    mock_google_callback({
        "id": "google-dan",
        "email": "dan@example.com",
        "name": "Dan",
        "picture": None,
    })
    resp = client.get("/auth/callback?code=fake", follow_redirects=False)
    assert resp.status_code in (302, 307)

    users = (await db_session.execute(select(User))).scalars().all()
    assert len(users) == 1
    assert users[0].apple_sub == "apple-dan"
    assert users[0].google_id == "google-dan"


# ── 5. Apple private relay email → no linking ───────────────────────────────


async def test_apple_private_relay_does_not_link(
    client, db_session, mock_google_callback, apple_token_factory
):
    # Existing Google account
    mock_google_callback({
        "id": "google-eve",
        "email": "eve@example.com",
        "name": "Eve",
        "picture": None,
    })
    client.get("/auth/callback?code=fake", follow_redirects=False)

    # User signs in with Apple but Apple returns a relay alias. The relay must
    # NOT match Eve's real email — a new account is created.
    relay_email = "eve_relay_alias@privaterelay.appleid.com"
    token = apple_token_factory(sub="apple-eve-relay", email=relay_email)
    resp = client.post("/auth/apple", json={"identity_token": token})
    assert resp.status_code == 200

    users = (
        await db_session.execute(select(User).order_by(User.created_at))
    ).scalars().all()
    assert len(users) == 2, "Private relay email must not trigger linking"
    google_user = next(u for u in users if u.google_id == "google-eve")
    apple_user = next(u for u in users if u.apple_sub == "apple-eve-relay")
    assert google_user.apple_sub is None
    assert apple_user.google_id is None
    assert apple_user.email == relay_email


# ── 6. Repeat Apple sign-in returns same user ───────────────────────────────


async def test_repeat_apple_signin_returns_same_user(
    client, db_session, apple_token_factory
):
    token_1 = apple_token_factory(sub="apple-frank", email="frank@example.com")
    resp1 = client.post("/auth/apple", json={"identity_token": token_1, "name": "Frank"})
    assert resp1.status_code == 200

    # Second sign-in (Apple often omits name on subsequent auths)
    token_2 = apple_token_factory(sub="apple-frank", email="frank@example.com")
    resp2 = client.post("/auth/apple", json={"identity_token": token_2})
    assert resp2.status_code == 200

    users = (await db_session.execute(select(User))).scalars().all()
    assert len(users) == 1
    assert users[0].apple_sub == "apple-frank"
    # First-time display_name should be preserved across re-auths
    assert users[0].display_name == "Frank"


# ── 7-10. Token validation failure modes ─────────────────────────────────────


async def test_invalid_signature_rejected(client, apple_rsa_keypair, apple_token_factory):
    """A token signed with a different key (not in our JWKS) must be rejected."""
    rogue_key = rsa.generate_private_key(
        public_exponent=65537, key_size=2048, backend=default_backend()
    )
    rogue_pem = rogue_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    # Signed with rogue key, but claims kid=test-key-id (matching our JWKS).
    # Signature verification with the real public key will fail.
    token = apple_token_factory(sub="apple-attacker", signing_key=rogue_pem)
    resp = client.post("/auth/apple", json={"identity_token": token})
    assert resp.status_code == 401


async def test_expired_token_rejected(client, apple_token_factory):
    token = apple_token_factory(sub="apple-expired", exp_offset=-60)  # exp 60s in the past
    resp = client.post("/auth/apple", json={"identity_token": token})
    assert resp.status_code == 401
    assert "expired" in resp.json()["detail"].lower()


async def test_wrong_audience_rejected(client, apple_token_factory):
    token = apple_token_factory(sub="apple-wrongaud", audience="com.someone.else")
    resp = client.post("/auth/apple", json={"identity_token": token})
    assert resp.status_code == 401
    assert "audience" in resp.json()["detail"].lower()


async def test_wrong_issuer_rejected(client, apple_token_factory):
    token = apple_token_factory(sub="apple-wrongiss", issuer="https://evil.example.com")
    resp = client.post("/auth/apple", json={"identity_token": token})
    assert resp.status_code == 401
    assert "issuer" in resp.json()["detail"].lower()
