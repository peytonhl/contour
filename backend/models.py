"""SQLAlchemy ORM models."""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Google OAuth identity (primary auth method)
    google_id: Mapped[Optional[str]] = mapped_column(String(128), unique=True, index=True, nullable=True)
    # Apple sign-in identity ("sub" claim from Apple's ID token). Same user may
    # have both google_id and apple_sub set after cross-provider account linking.
    apple_sub: Mapped[Optional[str]] = mapped_column(String(128), unique=True, index=True, nullable=True)
    # Marks the account as a moderator — required to access /moderation admin
    # endpoints (list reports, hide content, etc.). Manually toggled in DB.
    is_admin: Mapped[bool] = mapped_column(default=False)
    email: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    # Legacy Spotify ID — kept nullable for existing rows, no longer populated
    spotify_id: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True, nullable=True)
    display_name: Mapped[str] = mapped_column(String(256))
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pinned_album_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array of up to 4 Spotify album IDs
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
    """Replies to reviews. Threaded — `parent_reply_id` lets a reply target
    another reply (Reddit-style); NULL means top-level reply to the review."""
    __tablename__ = "review_replies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_id: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    body: Mapped[str] = mapped_column(Text)
    # Nullable: NULL = top-level reply (directly under the review). Non-null
    # points at another ReviewReply.id within the same review_id (validated
    # at the API layer). Indexed for fast tree-build queries.
    parent_reply_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SavedComparison(Base):
    __tablename__ = "saved_comparisons"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    user_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    result_json: Mapped[str] = mapped_column(Text, nullable=False)
    name_a: Mapped[str] = mapped_column(String(256))
    name_b: Mapped[str] = mapped_column(String(256))
    # Optional third side — null for 2-way comparisons (the legacy default).
    name_c: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)


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
    # BigInteger (int64) — Postgres INT4 caps at 2.1B and popular albums
    # routinely exceed that (UTOPIA ~7B, Astroworld ~11B). The same overflow
    # would happen here as on AlbumCache.kworb_streams.
    stream_count: Mapped[int] = mapped_column(BigInteger)
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


class UserList(Base):
    """A curated list of albums/tracks/artists created by a user."""
    __tablename__ = "user_lists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(256))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_ranked: Mapped[bool] = mapped_column(default=True)  # numbered vs. unranked
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class UserListItem(Base):
    """An entry in a user list, with a position for ordering."""
    __tablename__ = "user_list_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    list_id: Mapped[int] = mapped_column(Integer, index=True)
    position: Mapped[int] = mapped_column(Integer)   # 1-based
    entity_type: Mapped[str] = mapped_column(String(16))   # "album" | "track" | "artist"
    entity_id: Mapped[str] = mapped_column(String(64))
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class UserTasteProfile(Base):
    """
    Server-side taste profile — genres the user likes + artist IDs they've
    rated 4–5 stars.  Drives the For You feed for logged-in users.
    Populated by the onboarding flow and auto-updated on high ratings.

    Negative signal columns:
      - disliked_artist_ids: explicit "Not interested" clicks (hard exclude
        from every tier).
      - down_weighted_artist_ids: inferred from 1–2 star ratings (excluded
        from personalized seed/related/genre tiers, but still allowed to
        appear in baseline chart tiers so the user isn't blackholed).
    """
    __tablename__ = "user_taste_profiles"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    liked_artist_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)            # JSON array
    genres: Mapped[Optional[str]] = mapped_column(Text, nullable=True)                       # JSON array
    disliked_artist_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)          # JSON array
    down_weighted_artist_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)     # JSON array
    onboarding_done: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TrackCache(Base):
    __tablename__ = "track_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    spotify_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(256))
    artist: Mapped[str] = mapped_column(String(256))
    album_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    album_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    release_date: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    # Apple Music's releaseDate when we've matched the entity — generally more
    # accurate for vintage music than Spotify's catalog-upload date. The
    # discover decade ranker prefers this when populated. See the
    # v2w3x4y5z6a7 migration for the rationale.
    original_release_date: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    explicit: Mapped[bool] = mapped_column(Integer, default=False)
    popularity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    external_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    artist_ids_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON list


class AlbumCache(Base):
    __tablename__ = "album_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    spotify_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(256))
    artist: Mapped[str] = mapped_column(String(256))
    release_date: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    release_date_precision: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    # Apple Music's releaseDate when we've matched the entity — generally more
    # accurate for vintage music than Spotify's catalog-upload date. See
    # migration v2w3x4y5z6a7 + the discover decade-preference docs.
    original_release_date: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    label: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    popularity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Stream enrichment — filled in async by Kworb scrape.
    # BigInteger (int64): Postgres INT4 maxes at 2.1B and popular albums
    # routinely exceed that. UTOPIA ~7B, Astroworld ~11B. Using Integer
    # here would silently break enrichment for every popular album with
    # asyncpg DataError: "value out of int32 range" on the UPDATE.
    kworb_streams: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    # "pending" | "done" | "failed"
    enrichment_status: Mapped[str] = mapped_column(String(16), default="pending")
    enriched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class ArtistCache(Base):
    """Tracks when we last fetched a full discography for each artist.

    Used by the search router to decide whether to refresh album data from
    Spotify (daily cadence) so users see new releases on drop day.

    Also caches lightweight artist metadata (genres, image, popularity) so
    the profile-taste endpoint can derive top genres without making a Spotify
    call per artist — the single hottest source of Spotify fan-out on the
    site before this was added.
    """
    __tablename__ = "artist_cache"

    spotify_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(256))
    discography_fetched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    genres: Mapped[Optional[str]] = mapped_column(Text, nullable=True)          # JSON array
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    popularity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    meta_fetched_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class UserBlock(Base):
    """`blocker` has blocked `blocked` — `blocked`'s content (reviews, replies,
    feed activity) is hidden from `blocker`. Asymmetric: the blocked user can
    still see the blocker's content (Twitter-style)."""
    __tablename__ = "user_blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    blocker_user_id: Mapped[str] = mapped_column(String(64), index=True)
    blocked_user_id: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ContentReport(Base):
    """User-submitted report against a review or reply. Admin reviews these
    under /moderation/reports and resolves them (delete content / dismiss)."""
    __tablename__ = "content_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reporter_user_id: Mapped[str] = mapped_column(String(64), index=True)
    # "review" or "reply"
    target_type: Mapped[str] = mapped_column(String(16))
    target_id: Mapped[int] = mapped_column(Integer, index=True)
    # enum: spam / harassment / hate_speech / explicit_content / misinformation / other
    reason: Mapped[str] = mapped_column(String(32))
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # open / resolved / dismissed
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    resolved_by_user_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)


class AppleMusicLink(Base):
    """Cached mapping from a Spotify entity ID to its Apple Music counterpart.

    A row is written even when no match was found (apple_music_id NULL) so we
    don't retry every page load. Re-matching can be forced by deleting the row.

    `artwork_url` stores a sized Apple Music artwork URL (Apple's CDN templates
    URLs as `https://.../{w}x{h}bb.jpg` — we substitute 1200×1200 for a
    sharp render on high-DPR mobile, well above Spotify's 640×640 ceiling).
    Populated lazily: rows from before this column existed get NULL and are
    backfilled on the next match-endpoint hit for that entity.
    """
    __tablename__ = "apple_music_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    spotify_id: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(16))  # "album" or "track"
    apple_music_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    artwork_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    storefront: Mapped[str] = mapped_column(String(8), default="us")
    # "isrc", "text", or "none" (negative cache)
    match_method: Mapped[str] = mapped_column(String(16), default="none")
    matched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ImportLog(Base):
    """One row per CSV import attempt — for support/debug and per-user history."""
    __tablename__ = "import_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    source: Mapped[str] = mapped_column(String(16))  # "rym" (also "aoty" reserved for future)
    file_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    matched_count: Mapped[int] = mapped_column(Integer, default=0)
    unmatched_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class BacklogItem(Base):
    """Albums or tracks a user wants to listen to. Always public — surfaces on profile."""
    __tablename__ = "backlog_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(16), default="album")  # "album" | "track"
    entity_id: Mapped[str] = mapped_column(String(64), index=True)  # Spotify album or track ID
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class SearchEvent(Base):
    """A logged search query — used to compute /trending/searched.

    user_id is optional (logged-out searches still count). Pruning is best-effort
    via window-based aggregation, no TTL is enforced at the DB layer.
    """
    __tablename__ = "search_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    query: Mapped[str] = mapped_column(String(128), index=True)  # normalized lowercased
    user_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
