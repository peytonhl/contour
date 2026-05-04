"""SQLAlchemy ORM models."""

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Google OAuth identity (new primary auth method)
    google_id: Mapped[Optional[str]] = mapped_column(String(128), unique=True, index=True, nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    # Legacy Spotify ID — kept nullable for existing rows, no longer populated
    spotify_id: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True, nullable=True)
    display_name: Mapped[str] = mapped_column(String(256))
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Rating(Base):
    __tablename__ = "ratings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(16))  # "album" or "track"
    entity_id: Mapped[str] = mapped_column(String(64), index=True)
    value: Mapped[float] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(16))
    entity_id: Mapped[str] = mapped_column(String(64), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ReviewLike(Base):
    __tablename__ = "review_likes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64))
    review_id: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ReviewVote(Base):
    """Up/down votes on reviews. value=1 upvote, value=-1 downvote."""
    __tablename__ = "review_votes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    review_id: Mapped[int] = mapped_column(Integer, index=True)
    value: Mapped[int] = mapped_column(Integer)  # 1 or -1
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ReviewReply(Base):
    """Replies to reviews."""
    __tablename__ = "review_replies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_id: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ArtistFavorite(Base):
    __tablename__ = "artist_favorites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    artist_id: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SavedComparison(Base):
    __tablename__ = "saved_comparisons"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    user_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    result_json: Mapped[str] = mapped_column(Text, nullable=False)
    name_a: Mapped[str] = mapped_column(String(256))
    name_b: Mapped[str] = mapped_column(String(256))


class UserFollow(Base):
    __tablename__ = "user_follows"

    follower_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    following_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class StreamAnchor(Base):
    """
    Real historical stream count data points for a track or album.
    Sources: kworb_daily (live Kworb entity page) or wayback (archived snapshots).

    Once stored, these are never deleted — historical data doesn't change.
    The wayback_fetched_at column prevents redundant Wayback re-fetches.
    """
    __tablename__ = "stream_anchors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_id: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(16))   # "track" | "album"
    snapshot_date: Mapped[str] = mapped_column(String(16)) # ISO date "YYYY-MM-DD"
    stream_count: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(32))        # "kworb_daily" | "wayback"
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AnchorFetchStatus(Base):
    """
    Tracks whether we've attempted Wayback and/or Kworb daily fetches for an entity.
    Prevents hammering the same entity repeatedly.
    """
    __tablename__ = "anchor_fetch_status"

    entity_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(16), primary_key=True)
    kworb_daily_fetched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    wayback_fetched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Notification(Base):
    """In-app notifications: follow, upvote, reply."""
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)   # recipient
    type: Mapped[str] = mapped_column(String(16))                  # "follow" | "upvote" | "reply"
    actor_id: Mapped[str] = mapped_column(String(64))              # who triggered it
    review_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    entity_type: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    entity_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    read: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AlbumCache(Base):
    __tablename__ = "album_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    spotify_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(256))
    artist: Mapped[str] = mapped_column(String(256))
    release_date: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    release_date_precision: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    label: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    popularity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Stream enrichment — filled in async by Kworb scrape
    kworb_streams: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # "pending" | "done" | "failed"
    enrichment_status: Mapped[str] = mapped_column(String(16), default="pending")
    enriched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
