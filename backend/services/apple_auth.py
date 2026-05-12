"""
Sign in with Apple — identity token verification.

Apple's web-based Sign in with Apple returns an ID token (JWT) signed with one
of a small rotating set of RSA keys published at https://appleid.apple.com/auth/keys.

This module:
  1. Fetches and caches Apple's JWKS (24h TTL — keys rotate but rarely).
  2. Verifies the JWT signature using the kid header to select the right key.
  3. Validates the standard claims: iss, aud, exp.
  4. Validates the caller-supplied nonce against the token's nonce claim.

The service is env-gated: callers must check `is_configured()` before invoking
verification. When unconfigured, the /auth/apple endpoint should return 503 so
the frontend can hide the button.

No client secret is needed to *verify* the token (that's a server-to-server
construct used to request tokens; we receive them from the browser already
signed). All we need is the audience (Services ID).
"""
from __future__ import annotations

import os
import time
from typing import Optional

import httpx
import jwt
from jwt.algorithms import RSAAlgorithm


APPLE_ISSUER = "https://appleid.apple.com"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_PRIVATE_RELAY_DOMAIN = "@privaterelay.appleid.com"

_JWKS_CACHE: dict = {"keys": None, "fetched_at": 0.0}
_JWKS_TTL_SECONDS = 24 * 60 * 60


class AppleAuthError(Exception):
    """Raised when Apple ID token verification fails."""


def is_configured() -> bool:
    """Return True iff the env vars required to verify Apple tokens are set."""
    return bool(os.environ.get("APPLE_CLIENT_ID"))


def is_private_relay_email(email: Optional[str]) -> bool:
    """Detect Apple's private-relay email aliases.
    These are valid for account creation but must NOT be used for cross-provider
    account linking (a different provider may know the user's real email).
    """
    if not email:
        return False
    return email.lower().endswith(APPLE_PRIVATE_RELAY_DOMAIN)


async def _fetch_jwks() -> list[dict]:
    """Fetch Apple's JWKS with simple in-process caching."""
    now = time.time()
    if _JWKS_CACHE["keys"] is not None and (now - _JWKS_CACHE["fetched_at"]) < _JWKS_TTL_SECONDS:
        return _JWKS_CACHE["keys"]
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(APPLE_JWKS_URL)
        resp.raise_for_status()
        data = resp.json()
    keys = data.get("keys", [])
    _JWKS_CACHE["keys"] = keys
    _JWKS_CACHE["fetched_at"] = now
    return keys


def _public_key_from_jwk(jwk: dict):
    """Build a public RSA key object from a JWK dict (Apple uses RS256)."""
    import json
    return RSAAlgorithm.from_jwk(json.dumps(jwk))


async def verify_identity_token(
    identity_token: str,
    expected_nonce: Optional[str] = None,
    audience: Optional[str] = None,
    jwks_fetcher=None,
) -> dict:
    """Verify an Apple identity token and return the decoded claims dict.

    Raises AppleAuthError on any validation failure (caller maps to 401).

    `jwks_fetcher` is injectable for testing — defaults to the live Apple
    JWKS endpoint. Tests monkeypatch `_fetch_jwks` on this module rather than
    passing an override, so we resolve the default lazily here.

    `audience` defaults to the APPLE_CLIENT_ID env var. Tests pass an override
    so verification can happen without a configured environment.
    """
    if jwks_fetcher is None:
        jwks_fetcher = _fetch_jwks
    aud = audience if audience is not None else os.environ.get("APPLE_CLIENT_ID")
    if not aud:
        raise AppleAuthError("Apple sign-in is not configured (APPLE_CLIENT_ID unset)")

    # Decode unverified header to find which key signed this token
    try:
        header = jwt.get_unverified_header(identity_token)
    except jwt.PyJWTError as e:
        raise AppleAuthError(f"Malformed token: {e}")

    kid = header.get("kid")
    if not kid:
        raise AppleAuthError("Token missing kid in header")

    keys = await jwks_fetcher()
    jwk = next((k for k in keys if k.get("kid") == kid), None)
    if jwk is None:
        raise AppleAuthError(f"No public key matching kid={kid}")

    public_key = _public_key_from_jwk(jwk)

    # Verify signature + standard claims. PyJWT enforces exp + iat windows
    # and lets us specify expected issuer and audience.
    try:
        claims = jwt.decode(
            identity_token,
            public_key,
            algorithms=["RS256"],
            audience=aud,
            issuer=APPLE_ISSUER,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise AppleAuthError("Token expired")
    except jwt.InvalidAudienceError:
        raise AppleAuthError("Invalid audience")
    except jwt.InvalidIssuerError:
        raise AppleAuthError("Invalid issuer")
    except jwt.InvalidSignatureError:
        raise AppleAuthError("Invalid signature")
    except jwt.PyJWTError as e:
        raise AppleAuthError(f"Token validation failed: {e}")

    # Nonce check is per-flow, not part of standard JWT claims validation
    if expected_nonce is not None:
        token_nonce = claims.get("nonce")
        if token_nonce != expected_nonce:
            raise AppleAuthError("Nonce mismatch")

    return claims
