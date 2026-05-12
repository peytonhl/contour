"""Shared pytest fixtures for backend tests.

Sets up:
  - A fresh in-memory SQLite DB per test (clean state, no test interaction)
  - A FastAPI TestClient with the app's get_db dependency overridden
  - An RSA keypair for signing fake Apple identity tokens
  - Monkeypatches for apple_auth._fetch_jwks (so verification works against
    our test key) and for the Google OAuth httpx calls
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx
import jwt
import pytest
import pytest_asyncio
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

# Ensure backend/ is importable when pytest is invoked from the repo root.
BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# Env vars must be set BEFORE importing app modules — AuthSettings reads them
# at import time via pydantic-settings.
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-google-client")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-google-secret")
os.environ.setdefault("SPOTIFY_CLIENT_ID", "test-spotify-client")
os.environ.setdefault("SPOTIFY_CLIENT_SECRET", "test-spotify-secret")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-do-not-use-in-prod")
os.environ.setdefault("APPLE_CLIENT_ID", "com.contour.test")

# Use a throwaway SQLite DB; create_all builds the schema fresh per test.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")


from database import Base, get_db  # noqa: E402
from main import app  # noqa: E402
from services import apple_auth  # noqa: E402
import routers.auth as auth_router  # noqa: E402


# ── DB fixtures ───────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    """Per-test in-memory SQLite session. Schema is rebuilt every test, so
    tests are isolated and order-independent."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        yield session

    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession):
    """FastAPI TestClient wired to the per-test DB session via get_db override."""
    from fastapi.testclient import TestClient

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── Apple identity-token fixtures ─────────────────────────────────────────────


@pytest.fixture(scope="session")
def apple_rsa_keypair():
    """Generate a single RSA keypair reused across all Apple tests."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048, backend=default_backend())
    public_key = private_key.public_key()
    public_jwk = json.loads(RSAAlgorithm.to_jwk(public_key))
    public_jwk["kid"] = "test-key-id"
    public_jwk["alg"] = "RS256"
    public_jwk["use"] = "sig"
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return {"private_pem": private_pem, "public_jwk": public_jwk}


@pytest.fixture(autouse=True)
def mock_apple_jwks(apple_rsa_keypair, monkeypatch):
    """Patch apple_auth._fetch_jwks so token verification uses our test key."""
    async def fake_fetch():
        return [apple_rsa_keypair["public_jwk"]]
    monkeypatch.setattr(apple_auth, "_fetch_jwks", fake_fetch)
    # Also drop any cached keys from a prior test run
    apple_auth._JWKS_CACHE["keys"] = None
    apple_auth._JWKS_CACHE["fetched_at"] = 0.0


def make_apple_token(
    apple_rsa_keypair,
    *,
    sub: str = "001234.abcdef1234567890.0001",
    email: Optional[str] = "user@example.com",
    nonce: Optional[str] = None,
    audience: str = "com.contour.test",
    issuer: str = "https://appleid.apple.com",
    exp_offset: int = 600,
    extra_claims: Optional[dict] = None,
    kid: str = "test-key-id",
    signing_key: Optional[bytes] = None,
) -> str:
    """Build a signed JWT that looks like an Apple identity token."""
    now = int(time.time())
    claims = {
        "iss": issuer,
        "aud": audience,
        "sub": sub,
        "iat": now,
        "exp": now + exp_offset,
    }
    if email is not None:
        claims["email"] = email
    if nonce is not None:
        claims["nonce"] = nonce
    if extra_claims:
        claims.update(extra_claims)
    return jwt.encode(
        claims,
        signing_key or apple_rsa_keypair["private_pem"],
        algorithm="RS256",
        headers={"kid": kid},
    )


@pytest.fixture
def apple_token_factory(apple_rsa_keypair):
    """Convenience wrapper so tests don't have to pass the keypair every call."""
    def _make(**kwargs):
        return make_apple_token(apple_rsa_keypair, **kwargs)
    return _make


# ── Google OAuth mocking ──────────────────────────────────────────────────────


@pytest.fixture
def mock_google_callback(monkeypatch):
    """Patch the Google OAuth dance in /auth/callback so it doesn't hit the
    network. Tests call mock_google_callback(profile_dict) to install the mock,
    then call client.get("/auth/callback?code=...") with any code."""
    def _install(profile: dict):
        # Replace httpx.AsyncClient with one whose post/get returns the data we want.
        class _FakeResp:
            def __init__(self, data):
                self._data = data
            def raise_for_status(self):  # noqa: D401
                pass
            def json(self):
                return self._data

        class _FakeClient:
            async def __aenter__(self):
                return self
            async def __aexit__(self, *exc):
                return False
            async def post(self, *_args, **_kwargs):
                return _FakeResp({"access_token": "fake-google-access-token"})
            async def get(self, *_args, **_kwargs):
                return _FakeResp(profile)

        monkeypatch.setattr(auth_router.httpx, "AsyncClient", _FakeClient)
    return _install
