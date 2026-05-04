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

from database import get_db
from models import ArtistFavorite, Rating, Review, User
from services import spotify

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

    # Upsert user by Google ID
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()

    if user:
        user.display_name = display_name
        user.image_url = image_url
        user.email = email
        user.last_seen = datetime.utcnow()
    else:
        user = User(
            id=str(uuid.uuid4()),
            google_id=google_id,
            email=email,
            display_name=display_name,
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
        "display_name": user.display_name,
        "image_url": user.image_url,
        "email": user.email,
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
        try:
            if entity_type == "album":
                data = await spotify.get_album(entity_id)
            elif entity_type == "track":
                data = await spotify.get_track(entity_id)
            else:
                data = await spotify.get_artist(entity_id)
            return (entity_type, entity_id), {
                "name": data["name"],
                "image_url": data.get("image_url"),
                "artists": data.get("artists", []),
            }
        except Exception:
            return (entity_type, entity_id), {"name": None, "image_url": None, "artists": []}

    enriched = dict(await asyncio.gather(*[
        fetch_entity_meta(et, eid) for et, eid in unique_entities
    ]))

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
