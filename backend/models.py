"""SQLAlchemy ORM models."""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, Float, Index, Integer, String, Text
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
    # Per-notification-type push opt-outs as a JSON dict, e.g.
    # {"follow": true, "upvote": false, "reply": true, "mention": true}.
    # Missing keys = enabled. Null column = ALL enabled (the default for
    # every user; only flips to JSON when the user explicitly opts out of
    # something). See routers/notifications.py for the read/write API.
    notification_prefs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    # JSON-encoded list of user IDs resolved from @-mention tokens in
    # the body at write time. Stored explicitly so the frontend can
    # render mention links + the notification fanout knows who to ping
    # without having to re-parse on every read. Null / missing = no
    # mentions. See migration z6a7b8c9d0e1.
    mention_user_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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


class ReviewReplyVote(Base):
    """Up/down votes on replies (sub-comments). Mirrors ReviewVote's shape but
    keyed on a reply_id. Deliberately a separate table from ReviewVote so the
    review-level controversial-sort score (in ratings._controversial_score)
    stays scoped to *review* votes only — reply votes never bubble into a
    parent review's ranking. value=1 upvote, value=-1 downvote."""
    __tablename__ = "review_reply_votes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    reply_id: Mapped[int] = mapped_column(Integer, index=True)
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
    # Same shape as Review.mention_user_ids — JSON array of user IDs that
    # this reply @-mentions. See migration z6a7b8c9d0e1.
    mention_user_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    """In-app notifications: follow, upvote, reply, mention.

    `mention` notifications fire when another user @-tags the recipient in
    a review or reply body. The fanout happens in routers/ratings.py via
    services/mentions.py — see those for parsing + dedupe semantics.
    """
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)   # recipient
    type: Mapped[str] = mapped_column(String(16))                  # "follow" | "upvote" | "reply" | "mention"
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
    # User-driven hard-exclude of genre families. Populated by the profile-page
    # "Not for me" toggle. Tier 1 of the discover feed drops these from the
    # candidate genre pool BEFORE weighted sampling, so an excluded genre
    # never even queries Spotify. Separate column from genres (positive
    # signal) so the two can drift independently — a user can like "indie"
    # and exclude "indie folk" without contradiction.
    excluded_genres: Mapped[Optional[str]] = mapped_column(Text, nullable=True)              # JSON array
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
    # Denormalized first element of artist_ids_json — the track's
    # primary artist. Indexed so "find all tracks where primary artist
    # is X" is a single B-tree lookup instead of a full TrackCache
    # scan + Python JSON parse. Same data as artist_ids_json[0]; the
    # JSON column stays as the canonical store (preserves featured-
    # artist ordering), the column here is purely a queryable index.
    # Populated by services.spotify._persist_track_to_db on every
    # upsert + backfilled by migration b0c1d2e3f4g5.
    primary_artist_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)


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


class ArtistGenre(Base):
    """Many-to-many join: artist → Last.fm tags with weights.

    Derived from ArtistCache.genres (JSON), which remains the
    canonical store. This table exists purely as a queryable index —
    "find every artist tagged 'hip-hop'" goes from a full ArtistCache
    scan + Python JSON parse + per-tag substring loop to a single
    indexed SQL query.

    Sync rules:
      - On every successful ArtistCache.genres write (via
        services.spotify._fetch_and_persist_artist_genres), the
        artist's existing rows here are deleted and replaced with
        the new tag set. Stale rows can't outlive a successful
        re-fetch.
      - The JSON column stays the source of truth for downstream
        consumers (/me-state debug, probes, the legacy
        _normalize_genres_data shim) — this table is derived. If
        the two disagree, the JSON wins; re-run the artist's
        reconciler to repair.

    Each row stores tag_weight = the tag's share of the artist's
    total tag-count mass on Last.fm (so a sum across an artist's
    rows = 1.0, modulo equal-weighting for legacy untyped tags).
    The weighted-confidence matcher (threshold 0.25) is now a
    SQL HAVING SUM(tag_weight) >= 0.25, no Python loop.
    """
    __tablename__ = "artist_genres"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    artist_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Lowercased tag name (matches _normalize_genres_data output).
    # 128 chars is generous — most tags are short (rock, hip-hop)
    # but Last.fm allows long compound tags ("seen them live" etc.
    # which we ignore at the filter layer but still store).
    tag_name: Mapped[str] = mapped_column(String(128), nullable=False)
    tag_weight: Mapped[float] = mapped_column(Float, nullable=False)

    __table_args__ = (
        # Hot path: "find artists matching family X" → SELECT artist_id
        # WHERE tag_name LIKE '%X%' or tag_name IN (...). Index on
        # tag_name speeds the equality form (most common path after
        # alias expansion); LIKE '%X%' is unsargable but still
        # benefits from the smaller per-row payload vs ArtistCache.
        Index("ix_artist_genres_tag_name", "tag_name"),
        # Hot path: "what tags does artist Y have" + dedupe write
        # constraint. Unique because each (artist, tag) is one row.
        Index("ix_artist_genres_artist_tag", "artist_id", "tag_name", unique=True),
    )


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


class DeviceToken(Base):
    """A push-notification device token registered by a logged-in user.

    Tokens are written on app launch after permission grant (see the
    frontend's PushPermissionGate) and looked up by services/push_sender.py
    to fan a Notification out to every active device the recipient has
    registered.

    Stale tokens (Apple has rotated them, user uninstalled the app, etc.)
    are detected lazily by APNs returning 410 Gone — the push sender
    deletes those rows so future fanouts don't waste a request on them.

    Token uniqueness is per-token (not per-user-token-pair) so an account
    switch on a single device steals ownership cleanly: the second
    register-token call wins via INSERT ... ON CONFLICT (token) → swap
    user_id. See migration b0c1d2e3f4g5.
    """
    __tablename__ = "device_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    token: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    platform: Mapped[str] = mapped_column(String(16))  # "ios" | "android"
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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
