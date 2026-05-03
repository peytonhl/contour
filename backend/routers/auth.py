"""Spotify OAuth 2.0 flow and JWT session management."""

import base64
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

from database import get_db
from models import ArtistFavorite, Rating, Review, User

_ENV_FILE = Path(__file__).parent.parent / ".env"

JWT_ALGORITHM = "HS256"


class AuthSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8")
    spotify_client_id: str
    spotify_client_secret: str
    spotify_redirect_uri: str = "http://localhost:8000/auth/callback"
    frontend_url: str = "http://localhost:5173"
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_expire_days: int = 7


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


router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/login")
async def login():
    """Redirect the browser to Spotify's OAuth authorization page."""
    s = _get_settings()
    params = urlencode({
        "client_id": s.spotify_client_id,
        "response_type": "code",
        "redirect_uri": s.spotify_redirect_uri,
        "scope": "user-read-private",
    })
    return RedirectResponse(f"https://accounts.spotify.com/authorize?{params}")


@router.get("/callback")
async def callback(code: str, db: AsyncSession = Depends(get_db)):
    """Handle Spotify's OAuth callback, create/update user, issue JWT."""
    s = _get_settings()
    creds = base64.b64encode(
        f"{s.spotify_client_id}:{s.spotify_client_secret}".encode()
    ).decode()

    async with httpx.AsyncClient() as client:
        # Exchange code for Spotify tokens
        token_resp = await client.post(
            "https://accounts.spotify.com/api/token",
            headers={"Authorization": f"Basic {creds}"},
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": s.spotify_redirect_uri,
            },
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()

        # Fetch Spotify profile
        profile_resp = await client.get(
            "https://api.spotify.com/v1/me",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        profile_resp.raise_for_status()
        profile = profile_resp.json()

    spotify_id = profile["id"]
    images = profile.get("images", [])
    image_url = images[0]["url"] if images else None

    # Upsert user
    result = await db.execute(select(User).where(User.spotify_id == spotify_id))
    user = result.scalar_one_or_none()

    if user:
        user.display_name = profile.get("display_name") or spotify_id
        user.image_url = image_url
        user.last_seen = datetime.utcnow()
    else:
        user = User(
            id=str(uuid.uuid4()),
            spotify_id=spotify_id,
            display_name=profile.get("display_name") or spotify_id,
            image_url=image_url,
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)

    jwt_token = _make_jwt(user.id)
    return RedirectResponse(f"{s.frontend_url}/auth/success?token={jwt_token}")


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
        "spotify_id": user.spotify_id,
        "display_name": user.display_name,
        "image_url": user.image_url,
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

    # Recent ratings
    ratings_result = await db.execute(
        select(Rating)
        .where(Rating.user_id == user_id)
        .order_by(desc(Rating.created_at))
        .limit(50)
    )
    ratings = ratings_result.scalars().all()

    # Recent reviews
    reviews_result = await db.execute(
        select(Review)
        .where(Review.user_id == user_id)
        .order_by(desc(Review.created_at))
        .limit(50)
    )
    reviews = reviews_result.scalars().all()

    # Favorited artists
    favs_result = await db.execute(
        select(ArtistFavorite)
        .where(ArtistFavorite.user_id == user_id)
        .order_by(desc(ArtistFavorite.created_at))
    )
    favorites = favs_result.scalars().all()

    return {
        "user": {
            "id": user.id,
            "display_name": user.display_name,
            "image_url": user.image_url,
        },
        "ratings": [
            {"entity_type": r.entity_type, "entity_id": r.entity_id, "value": r.value, "created_at": r.created_at.isoformat()}
            for r in ratings
        ],
        "reviews": [
            {"entity_type": r.entity_type, "entity_id": r.entity_id, "body": r.body, "created_at": r.created_at.isoformat()}
            for r in reviews
        ],
        "favorite_artists": [f.artist_id for f in favorites],
    }
