"""Google OAuth 2.0 flow and JWT session management."""

import asyncio
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import RedirectResponse
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel
from database import get_db
from models import ArtistFavorite, Rating, Review, User, AlbumCache, TrackCache
from services import spotify
from services import apple_auth

_ENV_FILE = Path(__file__).parent.parent / ".env"

JWT_ALGORITHM = "HS256"

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


class AuthSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8")
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str = "http://localhost:8000/auth/callback"
    frontend_url: str = "http://localhost:5173"
    jwt_secret: str
    jwt_expire_days: int = 30
    # Apple sign-in — Services ID (acts as JWT audience). Optional: when unset,
    # /auth/apple returns 503 and the frontend should hide the button.
    apple_client_id: Optional[str] = None


_settings: Optional[AuthSettings] = None


def _get_settings() -> AuthSettings:
    global _settings
    if _settings is None:
        _settings = AuthSettings()
    return _settings


def _make_jwt(user_id: str) -> str:
    s = _get_settings()
    payload = {
        "sub": user_id,
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(days=s.jwt_expire_days),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> str:
    """Decode a JWT and return the user ID. Raises 401 on failure."""
    s = _get_settings()
    try:
        payload = jwt.decode(token, s.jwt_secret, algorithms=[JWT_ALGORITHM])
        return payload["sub"]
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def optional_user_id(authorization: Optional[str] = Header(None)) -> Optional[str]:
    """Dependency — returns user ID from Bearer token, or None if not logged in."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return decode_jwt(authorization[7:])
    except HTTPException:
        return None


def require_user_id(authorization: Optional[str] = Header(None)) -> str:
    """Dependency — returns user ID from Bearer token, raises 401 if missing/invalid."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    return decode_jwt(authorization[7:])  # decode_jwt raises 401 on invalid token


router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/login")
async def login():
    """Redirect the browser to Google's OAuth authorization page."""
    s = _get_settings()
    params = urlencode({
        "client_id": s.google_client_id,
        "redirect_uri": s.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
    })
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{params}")


@router.get("/callback")
async def callback(code: str, db: AsyncSession = Depends(get_db)):
    """Handle Google's OAuth callback, create/update user, issue JWT."""
    s = _get_settings()

    async with httpx.AsyncClient() as client:
        # Exchange authorization code for tokens
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "redirect_uri": s.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()

        # Fetch Google user profile
        profile_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        profile_resp.raise_for_status()
        profile = profile_resp.json()

    google_id = profile["id"]
    email = profile.get("email", "")
    display_name = profile.get("name") or email.split("@")[0]
    image_url = profile.get("picture")

    # 1. Existing user with this google_id → log them in
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()

    # 2. Else: existing user with this real email (e.g. signed in with Apple
    #    previously and now linking Google) → set google_id on that account.
    #    Apple private-relay emails are excluded — they cannot reliably match
    #    a real user's primary email.
    if user is None and email and not apple_auth.is_private_relay_email(email):
        result = await db.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()
        if existing is not None:
            existing.google_id = google_id
            user = existing

    # 3. Else: brand-new user
    if user is None:
        user = User(
            id=str(uuid.uuid4()),
            google_id=google_id,
            email=email,
            display_name=display_name,
            image_url=image_url,
        )
        db.add(user)
    else:
        user.display_name = display_name
        user.image_url = image_url
        user.email = email
        user.last_seen = datetime.utcnow()

    await db.commit()
    await db.refresh(user)

    jwt_token = _make_jwt(user.id)
    return RedirectResponse(f"{s.frontend_url}/auth/success?token={jwt_token}&provider=google")


# ── Sign in with Apple ────────────────────────────────────────────────────────


class AppleSignInRequest(BaseModel):
    identity_token: str
    nonce: Optional[str] = None
    # Apple only returns name on the *first* authentication. Frontend should
    # forward it through so we can set display_name on new account creation.
    name: Optional[str] = None


@router.post("/apple")
async def apple_sign_in(
    body: AppleSignInRequest,
    db: AsyncSession = Depends(get_db),
):
    """Verify an Apple identity token and issue a Contour JWT.

    Returns {token, provider} so the frontend can mirror the Google flow:
    store the token and call /auth/me.
    """
    s = _get_settings()
    if not s.apple_client_id:
        raise HTTPException(
            status_code=503,
            detail="Sign in with Apple is not configured on this server",
        )

    try:
        claims = await apple_auth.verify_identity_token(
            body.identity_token,
            expected_nonce=body.nonce,
            audience=s.apple_client_id,
        )
    except apple_auth.AppleAuthError as e:
        raise HTTPException(status_code=401, detail=str(e))

    apple_sub = claims["sub"]
    email = claims.get("email")
    is_relay = apple_auth.is_private_relay_email(email)
    display_name = body.name or (email.split("@")[0] if email else f"user_{apple_sub[:8]}")

    # 1. Existing user with this apple_sub → log them in
    result = await db.execute(select(User).where(User.apple_sub == apple_sub))
    user = result.scalar_one_or_none()

    # 2. Else: existing user with this real email (e.g. signed in with Google
    #    previously) → set apple_sub on that account. Relay emails skipped.
    if user is None and email and not is_relay:
        result = await db.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()
        if existing is not None:
            existing.apple_sub = apple_sub
            user = existing

    # 3. Else: brand-new user. Use the provided email even if it's a relay
    #    — we just don't use it for matching.
    if user is None:
        user = User(
            id=str(uuid.uuid4()),
            apple_sub=apple_sub,
            email=email,
            display_name=display_name,
        )
        db.add(user)
    else:
        user.last_seen = datetime.utcnow()
        # Don't overwrite display_name on existing accounts — Apple only sends
        # name on first auth and the user may have customized theirs since.
        if email and not user.email:
            user.email = email

    await db.commit()
    await db.refresh(user)

    return {"token": _make_jwt(user.id), "provider": "apple"}


@router.get("/me")
async def get_me(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Return the currently authenticated user's profile."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = decode_jwt(authorization[7:])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": user.id,
        "display_name": user.display_name,
        "image_url": user.image_url,
        "email": user.email,
        "bio": user.bio,
    }


@router.get("/profile")
async def get_profile(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Return the current user's ratings, reviews, and favorited artists."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = decode_jwt(authorization[7:])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    ratings_result = await db.execute(
        select(Rating)
        .where(Rating.user_id == user_id)
        .order_by(desc(Rating.created_at))
        .limit(50)
    )
    ratings = ratings_result.scalars().all()

    reviews_result = await db.execute(
        select(Review)
        .where(Review.user_id == user_id)
        .order_by(desc(Review.created_at))
        .limit(50)
    )
    reviews = reviews_result.scalars().all()

    favs_result = await db.execute(
        select(ArtistFavorite)
        .where(ArtistFavorite.user_id == user_id)
        .order_by(desc(ArtistFavorite.created_at))
    )
    favorites = favs_result.scalars().all()

    unique_entities = (
        {(r.entity_type, r.entity_id) for r in ratings}
        | {(r.entity_type, r.entity_id) for r in reviews}
    )

    async def fetch_entity_meta(entity_type: str, entity_id: str):
        """DB-first entity lookup — only hits Spotify as a last resort."""
        # 1. DB cache — instant, no rate-limit risk
        try:
            if entity_type == "album":
                row = (await db.execute(
                    select(AlbumCache).where(AlbumCache.spotify_id == entity_id)
                )).scalar_one_or_none()
                if row:
                    return (entity_type, entity_id), {
                        "name": row.name,
                        "image_url": row.image_url,
                        "artists": [row.artist] if row.artist else [],
                    }
            elif entity_type == "track":
                row = (await db.execute(
                    select(TrackCache).where(TrackCache.spotify_id == entity_id)
                )).scalar_one_or_none()
                if row:
                    return (entity_type, entity_id), {
                        "name": row.name,
                        "image_url": row.image_url,
                        "artists": [row.artist] if row.artist else [],
                    }
        except Exception:
            pass

        # 2. Spotify — last resort
        try:
            if entity_type == "album":
                data = await spotify.get_album(entity_id)
            elif entity_type == "track":
                data = await spotify.get_track(entity_id)
            else:
                data = await spotify.get_artist(entity_id)
            return (entity_type, entity_id), {
                "name": data.get("name"),
                "image_url": data.get("image_url"),
                "artists": data.get("artists", []),
            }
        except Exception:
            return (entity_type, entity_id), {"name": None, "image_url": None, "artists": []}

    raw = await asyncio.gather(
        *[fetch_entity_meta(et, eid) for et, eid in unique_entities],
        return_exceptions=True,
    )
    enriched = {k: v for k, v in raw if isinstance(v, dict)}

    return {
        "user": {
            "id": user.id,
            "display_name": user.display_name,
            "image_url": user.image_url,
        },
        "ratings": [
            {
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "entity_name": enriched.get((r.entity_type, r.entity_id), {}).get("name"),
                "entity_image_url": enriched.get((r.entity_type, r.entity_id), {}).get("image_url"),
                "entity_artists": enriched.get((r.entity_type, r.entity_id), {}).get("artists", []),
                "value": r.value,
                "created_at": r.created_at.isoformat(),
            }
            for r in ratings
        ],
        "reviews": [
            {
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "entity_name": enriched.get((r.entity_type, r.entity_id), {}).get("name"),
                "entity_image_url": enriched.get((r.entity_type, r.entity_id), {}).get("image_url"),
                "entity_artists": enriched.get((r.entity_type, r.entity_id), {}).get("artists", []),
                "body": r.body,
                "created_at": r.created_at.isoformat(),
            }
            for r in reviews
        ],
        "favorite_artists": [f.artist_id for f in favorites],
    }


class ProfileUpdate(BaseModel):
    bio: Optional[str] = None
    pinned_album_ids: Optional[list[str]] = None
    image_url: Optional[str] = None


@router.patch("/profile")
async def update_profile(
    body: ProfileUpdate,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Update the current user's editable profile fields (bio, pinned albums, photo)."""
    import json as _json
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = decode_jwt(authorization[7:])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.bio is not None:
        user.bio = body.bio.strip()[:300] or None  # max 300 chars, empty → null

    if body.pinned_album_ids is not None:
        ids = [str(i) for i in body.pinned_album_ids[:4]]
        user.pinned_album_ids = _json.dumps(ids)

    if body.image_url is not None:
        url = body.image_url.strip()
        if url and not url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="image_url must start with http:// or https://")
        user.image_url = url[:500] or None  # empty string → clear back to Google photo

    await db.commit()
    return {"ok": True, "bio": user.bio, "image_url": user.image_url}
