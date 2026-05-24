import asyncio
import json
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, delete, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from constants import HIGH_RATING_THRESHOLD, LOW_RATING_THRESHOLD, MIN_RATING, MAX_RATING, RATING_STEP, VALID_RATING_VALUES
from database import get_db, AsyncSessionLocal
from models import AlbumCache, AppleMusicLink, Rating, Review, ReviewLike, ReviewVote, ReviewReply, ReviewReplyVote, TrackCache, User, UserTasteProfile
from routers.auth import optional_user_id
from routers.moderation import blocked_user_ids
from routers.notifications import create_notification
from services import spotify
from services import mentions as _mentions

SPOTIFY_ID_RE = re.compile(r'^[A-Za-z0-9]{22}$')
VALID_ENTITY_TYPES = {"album", "track", "artist"}

router = APIRouter(prefix="/ratings", tags=["ratings"])


def _validate_entity(entity_type: str, entity_id: str):
    if entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid entity_type")
    if not SPOTIFY_ID_RE.match(entity_id):
        raise HTTPException(status_code=400, detail="Invalid entity_id format")


# ── Input models ──────────────────────────────────────────────────────────────

class RatingIn(BaseModel):
    value: float
    # Optional: pass the artist's Spotify ID when rating a track so we can
    # auto-update the server-side taste profile for high ratings.
    artist_id: Optional[str] = None

    @field_validator("value")
    @classmethod
    def validate_value(cls, v):
        if v not in VALID_RATING_VALUES:
            raise ValueError(f"Rating must be a multiple of {RATING_STEP} between {MIN_RATING} and {MAX_RATING}")
        return v


class ReviewIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)
    value: Optional[float] = None
    # Optional list of user IDs the frontend's mention autocomplete
    # resolved against the @-tokens in the body. Sent alongside the body
    # because the server-side regex parser only handles single-word
    # tokens (display names can contain spaces, but @Adam Zhang is
    # ambiguous to parse — the autocomplete already knows which user
    # was picked). Backend unions these with regex-parsed IDs so both
    # autocomplete picks AND bare typed @-tokens resolve correctly.
    # Older clients omit this field and continue working on the regex
    # path alone.
    mention_user_ids: Optional[list[str]] = None

    @field_validator("value")
    @classmethod
    def validate_value(cls, v):
        if v is not None and v not in VALID_RATING_VALUES:
            raise ValueError(f"Rating must be a multiple of {RATING_STEP} between {MIN_RATING} and {MAX_RATING}")
        return v


class VoteIn(BaseModel):
    value: int

    @field_validator("value")
    @classmethod
    def validate_value(cls, v):
        if v not in {1, -1}:
            raise ValueError("Vote must be 1 (upvote) or -1 (downvote)")
        return v


class ReplyIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)
    # Optional — when set, reply targets another reply (threaded). When null,
    # reply is top-level (directly under the review). The POST endpoint
    # validates the parent belongs to the same review so a client can't
    # cross-thread replies.
    parent_reply_id: Optional[int] = None
    # Same shape as ReviewIn.mention_user_ids — autocomplete-picked
    # user IDs, optional. See ReviewIn for the full rationale.
    mention_user_ids: Optional[list[str]] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _controversial_score(upvotes: int, downvotes: int) -> float:
    """Higher = more divisive.

    Strict Reddit-style "controversial" requires both sides, but on a small
    community even one downvote is the clearest signal of disagreement we'll
    get — pure-positive reviews would never reach the threshold and the
    filter would feel broken. So we treat any downvote as a baseline signal,
    rewarding balance and total engagement on top.

    A purely positive review (downvotes == 0) is by definition not
    controversial → score 0, ranking below anything with even a single
    downvote.
    """
    total = upvotes + downvotes
    if total == 0 or downvotes == 0:
        return 0.0
    # The +0.5 ensures one-sided downvoted reviews score above zero so they
    # bubble to the top of the controversial tab. Balanced reviews still
    # dominate as both up and down counts grow.
    return total * (min(upvotes, downvotes) + 0.5) / (max(upvotes, downvotes) + 1)


async def _enrich_reviews(reviews, db, user_id, entity_type=None, entity_id=None):
    """Shared helper: batch-fetch votes, replies, users, and ratings for a list of reviews."""
    if not reviews:
        return []

    review_ids = [r.id for r in reviews]

    # Batch: votes
    vote_rows = (await db.execute(
        select(ReviewVote).where(ReviewVote.review_id.in_(review_ids))
    )).scalars().all()

    vote_map: dict = {}       # review_id -> {up, down}
    user_vote_map: dict = {}  # review_id -> caller's vote
    for v in vote_rows:
        vm = vote_map.setdefault(v.review_id, {"up": 0, "down": 0})
        if v.value == 1:
            vm["up"] += 1
        else:
            vm["down"] += 1
        if user_id and v.user_id == user_id:
            user_vote_map[v.review_id] = v.value

    # Batch: reply counts
    reply_rows = (await db.execute(
        select(ReviewReply.review_id, func.count(ReviewReply.id))
        .where(ReviewReply.review_id.in_(review_ids))
        .group_by(ReviewReply.review_id)
    )).all()
    reply_counts = {row[0]: row[1] for row in reply_rows}

    # Batch: users (authors + mentioned users). Combining the two avoids a
    # second round-trip when reviews mention each other's authors.
    mention_ids_per_review: dict[int, list[str]] = {
        r.id: _mentions.load_ids(r.mention_user_ids) for r in reviews
    }
    all_mentioned: set[str] = set()
    for ids in mention_ids_per_review.values():
        all_mentioned.update(ids)
    user_ids = list({r.user_id for r in reviews} | all_mentioned)
    user_objs = (await db.execute(
        select(User).where(User.id.in_(user_ids))
    )).scalars().all()
    user_map = {u.id: u for u in user_objs}

    # Batch: ratings keyed by (user_id, entity_type, entity_id). Works for
    # both the scoped per-entity reviews list AND the unscoped global feed
    # where each review may target a different entity. The previous version
    # only populated rating_map when scoped, so every Community-tab review
    # carried rating=null and the star badge silently hid — which is what
    # the "Community tab shows one star for everything" bug looked like
    # from the UI side.
    rating_keys = [(rev.user_id, rev.entity_type, rev.entity_id) for rev in reviews]
    rating_map: dict = {}
    if rating_keys:
        rating_rows = (await db.execute(
            select(Rating).where(
                tuple_(Rating.user_id, Rating.entity_type, Rating.entity_id).in_(rating_keys)
            )
        )).scalars().all()
        rating_map = {
            (r.user_id, r.entity_type, r.entity_id): r.value for r in rating_rows
        }

    out = []
    for rev in reviews:
        votes = vote_map.get(rev.id, {"up": 0, "down": 0})
        up, down = votes["up"], votes["down"]
        u = user_map.get(rev.user_id)
        # `edited` covers user-visible edits, not the microsecond skew between
        # the two `default=datetime.utcnow` columns at insert time. 2s is well
        # above that skew and well below any real edit's response loop.
        edited = (rev.updated_at - rev.created_at).total_seconds() > 2
        # Resolve mention IDs → {id, display_name} pairs the frontend can
        # use to render @-tokens as links without a follow-up lookup. Drop
        # any ID that no longer resolves to a user (deletion or mid-flight
        # rename collision) so the renderer can fall back to plain text.
        mentions_out = []
        for mid in mention_ids_per_review.get(rev.id, []):
            mu = user_map.get(mid)
            if mu is None:
                continue
            mentions_out.append({"id": mu.id, "display_name": mu.display_name})

        out.append({
            "id": rev.id,
            "entity_type": rev.entity_type,
            "entity_id": rev.entity_id,
            "body": rev.body,
            "created_at": rev.created_at.isoformat() + "Z",
            "updated_at": rev.updated_at.isoformat() + "Z",
            "edited": edited,
            "rating": rating_map.get((rev.user_id, rev.entity_type, rev.entity_id)),
            "upvotes": up,
            "downvotes": down,
            "user_vote": user_vote_map.get(rev.id),
            "replies_count": reply_counts.get(rev.id, 0),
            "mentions": mentions_out,
            "_controversial": _controversial_score(up, down),
            "user": {
                "id": rev.user_id,
                "display_name": u.display_name if u else "Unknown",
                "image_url": u.image_url if u else None,
            },
        })
    return out


# ── Background taste-profile updater ──────────────────────────────────────────

async def _update_taste_from_rating(user_id: str, artist_id: str) -> None:
    """
    Prepend artist_id to the user's liked_artist_ids in UserTasteProfile.

    Also:
      • Removes the artist from down_weighted_artist_ids if present — a high
        rating supersedes any previous low one.
      • Merges the artist's Spotify genres into profile.genres so tier 2 of
        the For You feed reflects evolving taste rather than staying frozen
        at the onboarding picks. We take up to 2 genres per rated artist,
        prepend, dedupe, cap at 20.

    Spotify failure is non-fatal — the artist-level update still proceeds so
    a flaky Spotify call doesn't lose the rating's primary signal.
    """
    # Fetch the artist's genres before the DB session — spotify.get_artist is
    # Redis-cached 30d so this is usually a hash hit, but a cold miss can
    # take a beat and we don't want to hold a DB transaction open across it.
    new_genres: list[str] = []
    try:
        meta = await spotify.get_artist(artist_id)
        new_genres = list((meta.get("genres") or [])[:2])
    except Exception:
        pass  # non-fatal — genre evolution stalls this cycle, retries next 4–5★

    async with AsyncSessionLocal() as db:
        profile = await db.get(UserTasteProfile, user_id)
        if profile:
            existing: list[str] = json.loads(profile.liked_artist_ids or "[]")
            if artist_id not in existing:
                merged = [artist_id] + existing
                profile.liked_artist_ids = json.dumps(merged[:20])
            down: list[str] = json.loads(profile.down_weighted_artist_ids or "[]")
            if artist_id in down:
                profile.down_weighted_artist_ids = json.dumps([a for a in down if a != artist_id])
            if new_genres:
                existing_genres: list[str] = json.loads(profile.genres or "[]")
                merged_genres = list(dict.fromkeys(new_genres + existing_genres))[:20]
                if merged_genres != existing_genres:
                    profile.genres = json.dumps(merged_genres)
            profile.updated_at = datetime.utcnow()
        else:
            # Seed a fresh profile with both the artist and any genres we
            # could fetch — gives tier 2 something to work with even before
            # the user opens the onboarding genre picker.
            profile = UserTasteProfile(
                user_id=user_id,
                liked_artist_ids=json.dumps([artist_id]),
                genres=json.dumps(new_genres[:20]),
                onboarding_done=False,
            )
            db.add(profile)
        await db.commit()


async def _down_weight_from_rating(user_id: str, artist_id: str) -> None:
    """
    Append artist_id to down_weighted_artist_ids on a 1–2 star rating.

    Discover router applies a three-state model based on whether this
    artist is also in liked_artist_ids (since 2026-05-19):
      • If artist is in down_weighted ONLY → blocked from every tier
        (user has only negative signal for them; Colin Hogan's Shaboozey).
      • If artist is in BOTH liked AND down_weighted → ambivalent.
        Removed from active tier 1 seeds but NOT blocked from baselines —
        they show at chart frequency. Prevents one 1★ rating from
        derailing the whole feed for an artist the user otherwise loves.
      • Liked ONLY → unaffected by this fn (it doesn't touch
        liked_artist_ids).

    Misclick recovery: /settings/taste-profile → "Re-derive from ratings"
    wipes the down-weight + liked artist lists entirely.

    If the artist is in liked_artist_ids, we leave that alone; the discover
    router resolves the conflict by treating any liked artist as an active
    seed regardless of whether it's also down-weighted (a recent high rating
    overwrote it then this newer low rating is recorded — the user is
    ambivalent and the next refresh will balance it out).
    """
    async with AsyncSessionLocal() as db:
        profile = await db.get(UserTasteProfile, user_id)
        if profile:
            existing: list[str] = json.loads(profile.down_weighted_artist_ids or "[]")
            if artist_id not in existing:
                merged = [artist_id] + existing
                profile.down_weighted_artist_ids = json.dumps(merged[:50])
                profile.updated_at = datetime.utcnow()
        else:
            profile = UserTasteProfile(
                user_id=user_id,
                liked_artist_ids=json.dumps([]),
                genres=json.dumps([]),
                down_weighted_artist_ids=json.dumps([artist_id]),
                onboarding_done=False,
            )
            db.add(profile)
        await db.commit()


async def _record_dislike(user_id: str, artist_id: str) -> None:
    """
    Append artist_id to disliked_artist_ids — explicit "Not interested" click.

    Hard signal: every tier excludes the artist. Also removes them from
    liked_artist_ids if present (the user changed their mind).
    """
    async with AsyncSessionLocal() as db:
        profile = await db.get(UserTasteProfile, user_id)
        if profile:
            existing: list[str] = json.loads(profile.disliked_artist_ids or "[]")
            if artist_id not in existing:
                merged = [artist_id] + existing
                profile.disliked_artist_ids = json.dumps(merged[:200])
            liked: list[str] = json.loads(profile.liked_artist_ids or "[]")
            if artist_id in liked:
                profile.liked_artist_ids = json.dumps([a for a in liked if a != artist_id])
            profile.updated_at = datetime.utcnow()
        else:
            profile = UserTasteProfile(
                user_id=user_id,
                liked_artist_ids=json.dumps([]),
                genres=json.dumps([]),
                disliked_artist_ids=json.dumps([artist_id]),
                onboarding_done=False,
            )
            db.add(profile)
        await db.commit()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/{entity_type}/{entity_id}/rate")
async def rate(
    entity_type: str, entity_id: str, body: RatingIn,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to rate")
    _validate_entity(entity_type, entity_id)

    existing = (await db.execute(
        select(Rating).where(
            Rating.user_id == user_id,
            Rating.entity_type == entity_type,
            Rating.entity_id == entity_id,
        )
    )).scalar_one_or_none()

    if existing:
        existing.value = body.value
    else:
        db.add(Rating(user_id=user_id, entity_type=entity_type,
                      entity_id=entity_id, value=body.value))
    await db.commit()

    # Update taste profile in background (non-blocking) on track ratings.
    # 4–5 stars → liked seed.  1–2 stars → soft down-weight.  2.5–3.5 is
    # neutral and produces no taste signal beyond the per-track exclusion
    # already handled by Rating itself.
    if body.artist_id and entity_type == "track":
        if body.value >= HIGH_RATING_THRESHOLD:
            asyncio.create_task(_update_taste_from_rating(user_id, body.artist_id))
        elif body.value <= LOW_RATING_THRESHOLD:
            asyncio.create_task(_down_weight_from_rating(user_id, body.artist_id))

    return {"ok": True, "value": body.value}


@router.get("/{entity_type}/{entity_id}/summary")
async def summary(
    entity_type: str, entity_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    avg_val, count = (await db.execute(
        select(func.avg(Rating.value), func.count(Rating.id)).where(
            Rating.entity_type == entity_type,
            Rating.entity_id == entity_id,
        )
    )).one()

    user_rating = user_review = None
    if user_id:
        user_rating = (await db.execute(
            select(Rating.value).where(
                Rating.user_id == user_id,
                Rating.entity_type == entity_type,
                Rating.entity_id == entity_id,
            )
        )).scalar_one_or_none()
        user_review = (await db.execute(
            select(Review.body).where(
                Review.user_id == user_id,
                Review.entity_type == entity_type,
                Review.entity_id == entity_id,
            )
        )).scalar_one_or_none()

    return {
        "average": round(avg_val, 2) if avg_val else None,
        "count": count,
        "user_rating": user_rating,
        "user_review": user_review,
    }


@router.post("/{entity_type}/{entity_id}/review")
async def upsert_review(
    entity_type: str, entity_id: str, body: ReviewIn,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to leave a review")
    _validate_entity(entity_type, entity_id)
    if not body.body.strip():
        raise HTTPException(status_code=400, detail="Review cannot be empty")

    if body.value is not None:
        existing_rating = (await db.execute(
            select(Rating).where(
                Rating.user_id == user_id,
                Rating.entity_type == entity_type,
                Rating.entity_id == entity_id,
            )
        )).scalar_one_or_none()
        if existing_rating:
            existing_rating.value = body.value
        else:
            db.add(Rating(user_id=user_id, entity_type=entity_type,
                          entity_id=entity_id, value=body.value))

    existing_review = (await db.execute(
        select(Review).where(
            Review.user_id == user_id,
            Review.entity_type == entity_type,
            Review.entity_id == entity_id,
        )
    )).scalar_one_or_none()

    body_text = body.body.strip()

    # Resolve @-mentions BEFORE we know the review id so we can persist the
    # ID list alongside the body and fire one notification per mentioned
    # user once the commit lands. Self-mentions are filtered out by the
    # resolver so users can't @ themselves into a notification.
    # Uses the COMBINED resolver: client_user_ids comes from the
    # frontend autocomplete (handles multi-word display names that the
    # regex can't), unioned with regex-parsed tokens for bare typed
    # mentions.
    mention_ids = await _mentions.resolve_combined_mentions(
        db, body_text,
        client_user_ids=body.mention_user_ids,
        exclude_user_id=user_id,
    )

    # Diff against the previous mention set so an edit only notifies the
    # NEWLY added mentions, not everyone who was tagged in earlier versions.
    prior_mention_ids: set[str] = set()
    if existing_review:
        prior_mention_ids = set(
            _mentions.load_ids(existing_review.mention_user_ids)
        )

    if existing_review:
        existing_review.body = body_text
        existing_review.updated_at = datetime.utcnow()
        existing_review.mention_user_ids = _mentions.dump_ids(mention_ids)
        review = existing_review
    else:
        review = Review(
            user_id=user_id, entity_type=entity_type,
            entity_id=entity_id, body=body_text,
            mention_user_ids=_mentions.dump_ids(mention_ids),
        )
        db.add(review)
        # Flush so review.id is populated for the notification's review_id
        # FK without ending the transaction.
        await db.flush()

    # Fire one "mention" notification per newly-mentioned user. We use the
    # existing create_notification helper so the same fanout path (and
    # later, the push pipeline from feature 2) catches mentions for free.
    for muid in mention_ids:
        if muid in prior_mention_ids:
            continue
        await create_notification(
            db,
            user_id=muid,
            type="mention",
            actor_id=user_id,
            review_id=review.id,
            entity_type=entity_type,
            entity_id=entity_id,
        )

    await db.commit()
    # Return the review id so the For You / Discover flow can open the
    # CardPreviewModal directly on the just-posted review without an
    # extra fetch. New-insert path needed an await refresh to populate
    # the autoincrement id; existing-update path already had it.
    if not existing_review:
        await db.refresh(review)
    return {"ok": True, "review_id": review.id}


@router.get("/users/{user_id}/hot-take")
async def get_user_hot_take(
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Find the user's most-divergent rating versus community consensus, for
    the "hot take" shareable card.

    A rating qualifies as a hot take when:
      - the entity has ≥ 5 community ratings (so there's a real consensus
        to be contrarian against; one-rating entities trivially have 100%
        divergence with no signal)
      - the user's rating exists for that entity (filtered by the join)
      - |user_rating − community_avg| ≥ 1.0 (less than a star apart isn't
        a "take" — they basically agree)

    Returns the single biggest divergence as the headline hot take.
    404 when no rating qualifies — the frontend hides the share button
    in that case rather than offering a card with nothing punchy to say.
    """
    # ── 1. User's ratings ───────────────────────────────────────────────────
    user_ratings = (await db.execute(
        select(Rating).where(Rating.user_id == user_id)
    )).scalars().all()
    if not user_ratings:
        raise HTTPException(status_code=404, detail="No ratings to draw from")

    rated_keys = [(r.entity_type, r.entity_id) for r in user_ratings]

    # ── 2. Community avg + count for each rated entity ──────────────────────
    # GROUP BY (entity_type, entity_id), then filter to >= 5 ratings. The
    # tuple_().in_() form keeps this one query.
    community = (await db.execute(
        select(
            Rating.entity_type,
            Rating.entity_id,
            func.avg(Rating.value).label("avg"),
            func.count(Rating.id).label("n"),
        )
        .where(tuple_(Rating.entity_type, Rating.entity_id).in_(rated_keys))
        .group_by(Rating.entity_type, Rating.entity_id)
        .having(func.count(Rating.id) >= 5)
    )).all()
    community_map = {(c.entity_type, c.entity_id): (float(c.avg), int(c.n)) for c in community}

    # ── 3. Score each rating by divergence; pick the biggest ────────────────
    best = None  # (divergence, rating_row, community_avg, community_count)
    for r in user_ratings:
        comm = community_map.get((r.entity_type, r.entity_id))
        if not comm:
            continue
        avg, count = comm
        divergence = abs(r.value - avg)
        if divergence < 1.0:
            continue
        if best is None or divergence > best[0]:
            best = (divergence, r, avg, count)

    if best is None:
        raise HTTPException(status_code=404, detail="No hot takes yet — your ratings line up with the community")

    _, rating_row, comm_avg, comm_count = best

    # ── 4. Hydrate entity meta + Apple cover (same approach as review card) ─
    entity_name = entity_artist = spotify_cover = None
    if rating_row.entity_type == "album":
        row = (await db.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == rating_row.entity_id)
        )).scalar_one_or_none()
        if row:
            entity_name, entity_artist, spotify_cover = row.name, row.artist, row.image_url
    elif rating_row.entity_type == "track":
        row = (await db.execute(
            select(TrackCache).where(TrackCache.spotify_id == rating_row.entity_id)
        )).scalar_one_or_none()
        if row:
            entity_name, entity_artist, spotify_cover = row.name, row.artist, row.image_url

    apple_artwork = None
    if rating_row.entity_type in ("album", "track"):
        apple_link = (await db.execute(
            select(AppleMusicLink).where(
                AppleMusicLink.spotify_id == rating_row.entity_id,
                AppleMusicLink.entity_type == rating_row.entity_type,
                AppleMusicLink.storefront == "us",
            )
        )).scalar_one_or_none()
        if apple_link and apple_link.artwork_url:
            apple_artwork = apple_link.artwork_url

    # Track covers prefer Spotify; album covers prefer Apple. See the review
    # card-data endpoint below for the full rationale — short version: Apple's
    # ISRC search can return a non-canonical "primary album" for tracks that
    # appear on multiple releases (single + studio album + curated playlists),
    # so for tracks we anchor to Spotify's reliable track.album.images.
    if rating_row.entity_type == "track":
        cover_url = spotify_cover or apple_artwork
    else:
        cover_url = apple_artwork or spotify_cover

    user = (await db.execute(
        select(User).where(User.id == user_id)
    )).scalar_one_or_none()

    return {
        "user": {
            "id": user_id,
            "display_name": (user.display_name if user else "Unknown"),
            "image_url": (user.image_url if user else None),
        },
        "rating": rating_row.value,
        "community_avg": round(comm_avg, 2),
        "community_count": comm_count,
        "divergence": round(rating_row.value - comm_avg, 2),  # signed: + = hotter, − = cooler
        "entity": {
            "type": rating_row.entity_type,
            "id": rating_row.entity_id,
            "name": entity_name,
            "artist": entity_artist,
            "cover_url": cover_url,
        },
    }


@router.get("/reviews/{review_id}/card-data")
async def get_review_card_data(
    review_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    One-shot payload for the Vercel-OG shareable-card renderer.

    Returns everything the renderer needs in a single round-trip:
      - review body, created_at, stars
      - author display name + avatar
      - entity name, primary artist, cover URL (Apple Music preferred,
        Spotify fallback)

    No auth required — review cards are public artifacts representing
    public reviews. The renderer is a Vercel Edge Function and must not
    need a session token to fetch this.

    Cover preference: AppleMusicLink.artwork_url when present (Apple's
    1200×1200 art beats Spotify's 640 cap). Falls back to the cached
    Spotify image. No live Apple Music API call here — if we don't have
    a cached match for the entity yet, the user just gets a Spotify-art
    card. Lazy backfill happens elsewhere (apple_music router).
    """
    review = (await db.execute(
        select(Review).where(Review.id == review_id)
    )).scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    user = (await db.execute(
        select(User).where(User.id == review.user_id)
    )).scalar_one_or_none()

    # Entity meta from the local cache. We deliberately don't fall through
    # to a live Spotify call here — keeping this endpoint fast and free of
    # rate-limit risk matters more than the edge-case of a review on an
    # entity we've never cached (it'd render with no cover, which is
    # acceptable degradation).
    entity_name: Optional[str] = None
    entity_artist: Optional[str] = None
    spotify_cover: Optional[str] = None
    if review.entity_type == "album":
        row = (await db.execute(
            select(AlbumCache).where(AlbumCache.spotify_id == review.entity_id)
        )).scalar_one_or_none()
        if row:
            entity_name, entity_artist, spotify_cover = row.name, row.artist, row.image_url
    elif review.entity_type == "track":
        row = (await db.execute(
            select(TrackCache).where(TrackCache.spotify_id == review.entity_id)
        )).scalar_one_or_none()
        if row:
            entity_name, entity_artist, spotify_cover = row.name, row.artist, row.image_url

    # Apple Music artwork lookup — cached match only (no live fetch).
    # storefront defaults to "us" everywhere else in this codebase so we
    # match that here for cache-hit alignment.
    apple_artwork: Optional[str] = None
    if review.entity_type in ("album", "track"):
        apple_link = (await db.execute(
            select(AppleMusicLink).where(
                AppleMusicLink.spotify_id == review.entity_id,
                AppleMusicLink.entity_type == review.entity_type,
                AppleMusicLink.storefront == "us",
            )
        )).scalar_one_or_none()
        if apple_link and apple_link.artwork_url:
            apple_artwork = apple_link.artwork_url

    # Cover preference depends on entity type:
    #   - Albums: Apple first. When the user picked an album directly, Apple's
    #     by-album-id lookup is reliable AND ships at 1200×1200 vs Spotify's
    #     640px cap. Resolution win, no ambiguity.
    #   - Tracks: Spotify first. Apple's ISRC search returns a song with one
    #     primary album, but for tracks that appear on multiple releases
    #     (single + studio album + curated playlists), Apple may pick the
    #     "wrong" one — e.g. a curated-playlist cover instead of the single
    #     the user actually rated. Spotify's `track.album.images` is always
    #     the album the user saw in the search result they tapped, so it
    #     stays anchored to user intent even at lower resolution.
    # Apple stays as a fallback for tracks when Spotify's cache is empty
    # (rare — TrackCache.image_url populates on every track view).
    if review.entity_type == "track":
        cover_url = spotify_cover or apple_artwork
        cover_source = "spotify" if spotify_cover else ("apple" if apple_artwork else None)
    else:
        cover_url = apple_artwork or spotify_cover
        cover_source = "apple" if apple_artwork else ("spotify" if spotify_cover else None)

    # Star rating: pull the author's Rating row for the same entity (if any).
    rating_row = (await db.execute(
        select(Rating).where(
            Rating.user_id == review.user_id,
            Rating.entity_type == review.entity_type,
            Rating.entity_id == review.entity_id,
        )
    )).scalar_one_or_none()

    return {
        "review": {
            "id": review.id,
            "body": review.body,
            "created_at": review.created_at.isoformat() + "Z",
            "rating": rating_row.value if rating_row else None,
        },
        "author": {
            "id": review.user_id,
            "display_name": (user.display_name if user else "Unknown"),
            "image_url": (user.image_url if user else None),
        },
        "entity": {
            "type": review.entity_type,
            "id": review.entity_id,
            "name": entity_name,
            "artist": entity_artist,
            "cover_url": cover_url,
            "cover_source": cover_source,
        },
    }


@router.delete("/reviews/{review_id}")
async def delete_review(
    review_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """Delete the caller's own review. Cascades to votes/replies/likes.

    The user's underlying Rating row is preserved — a user may want to retain
    their star rating while removing the written words. Admins can delete
    other users' reviews via the moderation router, not this endpoint.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to delete reviews")

    review = (await db.execute(
        select(Review).where(Review.id == review_id)
    )).scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if review.user_id != user_id:
        raise HTTPException(status_code=403, detail="You can only delete your own review")

    # Mirror the cascade order used by moderation._resolve_report — no FKs
    # are enforced at the DB level so the API has to spell it out. Reply
    # votes must be wiped BEFORE the replies themselves, otherwise the
    # subquery loses its target IDs.
    reply_ids_to_clean = [r[0] for r in (await db.execute(
        select(ReviewReply.id).where(ReviewReply.review_id == review_id)
    )).all()]
    if reply_ids_to_clean:
        await db.execute(delete(ReviewReplyVote).where(ReviewReplyVote.reply_id.in_(reply_ids_to_clean)))
    await db.execute(delete(ReviewVote).where(ReviewVote.review_id == review_id))
    await db.execute(delete(ReviewLike).where(ReviewLike.review_id == review_id))
    await db.execute(delete(ReviewReply).where(ReviewReply.review_id == review_id))
    await db.execute(delete(Review).where(Review.id == review_id))
    await db.commit()
    return {"ok": True}


@router.get("/{entity_type}/{entity_id}/reviews")
async def list_reviews(
    entity_type: str, entity_id: str,
    sort: str = Query("recent", pattern="^(recent|top|controversial)$"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """List reviews on an entity. Paginated by `limit` + `offset` over the
    sort-applied result set — i.e., sort runs on the full pool BEFORE the
    slice, so "top" / "controversial" remain stable across pages and a
    given review keeps its rank as the user requests more pages.

    Response shape is `{items, has_more, total}`. Previously bare list;
    callers must read .items now. Capacitor live-update model means the
    shape change reaches every client when the new bundle is loaded.
    """
    reviews = (await db.execute(
        select(Review).where(
            Review.entity_type == entity_type,
            Review.entity_id == entity_id,
        )
    )).scalars().all()

    # Hide reviews authored by users the viewer has blocked.
    blocked = await blocked_user_ids(db, user_id)
    if blocked:
        reviews = [r for r in reviews if r.user_id not in blocked]

    out = await _enrich_reviews(reviews, db, user_id,
                                entity_type=entity_type, entity_id=entity_id)

    if sort == "recent":
        out.sort(key=lambda x: x["created_at"], reverse=True)
    elif sort == "top":
        out.sort(key=lambda x: x["upvotes"] - x["downvotes"], reverse=True)
    elif sort == "controversial":
        out.sort(key=lambda x: x["_controversial"], reverse=True)

    # Remove internal sort key
    for r in out:
        r.pop("_controversial", None)

    total = len(out)
    page = out[offset:offset + limit]
    return {
        "items": page,
        "has_more": offset + limit < total,
        "total": total,
    }


@router.post("/reviews/{review_id}/vote")
async def vote_review(
    review_id: int, body: VoteIn,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to vote")

    existing = (await db.execute(
        select(ReviewVote).where(
            ReviewVote.user_id == user_id,
            ReviewVote.review_id == review_id,
        )
    )).scalar_one_or_none()

    is_new_upvote = False
    if existing:
        if existing.value == body.value:
            # Same vote — toggle off
            await db.execute(delete(ReviewVote).where(
                ReviewVote.user_id == user_id,
                ReviewVote.review_id == review_id,
            ))
            user_vote = None
        else:
            existing.value = body.value
            user_vote = body.value
            is_new_upvote = body.value == 1
    else:
        db.add(ReviewVote(user_id=user_id, review_id=review_id, value=body.value))
        user_vote = body.value
        is_new_upvote = body.value == 1

    # Notify review author on new upvote
    if is_new_upvote:
        review = (await db.execute(
            select(Review).where(Review.id == review_id)
        )).scalar_one_or_none()
        if review:
            await create_notification(db, user_id=review.user_id, type="upvote",
                                      actor_id=user_id, review_id=review_id)

    await db.commit()

    # Return updated counts
    vote_rows = (await db.execute(
        select(ReviewVote).where(ReviewVote.review_id == review_id)
    )).scalars().all()
    upvotes = sum(1 for v in vote_rows if v.value == 1)
    downvotes = sum(1 for v in vote_rows if v.value == -1)
    return {"upvotes": upvotes, "downvotes": downvotes, "user_vote": user_vote}


@router.post("/reviews/{review_id}/replies/{reply_id}/vote")
async def vote_reply(
    review_id: int, reply_id: int, body: VoteIn,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """Up/down vote on a single reply. Mirrors vote_review in behavior
    (toggle off on same value, switch on opposite value, create on new)
    but writes to the separate ReviewReplyVote table. The review_id in
    the URL is verified against the reply's stored review_id so a client
    can't vote on a reply by guessing IDs in a totally different thread.

    Critically: reply votes are NOT factored into the parent review's
    controversial-sort score. The hierarchy is "votes on a reply rank
    only the replies among themselves; the parent review's ranking
    looks only at votes cast on the parent review itself." Achieved by
    keeping the data in a separate table — ratings._controversial_score
    only ever sees ReviewVote rows."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to vote")

    # Verify the reply exists and actually belongs to this review.
    reply = (await db.execute(
        select(ReviewReply).where(ReviewReply.id == reply_id)
    )).scalar_one_or_none()
    if not reply:
        raise HTTPException(status_code=404, detail="Reply not found")
    if reply.review_id != review_id:
        raise HTTPException(status_code=400, detail="Reply does not belong to this review")

    existing = (await db.execute(
        select(ReviewReplyVote).where(
            ReviewReplyVote.user_id == user_id,
            ReviewReplyVote.reply_id == reply_id,
        )
    )).scalar_one_or_none()

    is_new_upvote = False
    if existing:
        if existing.value == body.value:
            # Same vote — toggle off (matches the parent review's behavior)
            await db.execute(delete(ReviewReplyVote).where(
                ReviewReplyVote.user_id == user_id,
                ReviewReplyVote.reply_id == reply_id,
            ))
            user_vote = None
        else:
            existing.value = body.value
            user_vote = body.value
            is_new_upvote = body.value == 1
    else:
        db.add(ReviewReplyVote(user_id=user_id, reply_id=reply_id, value=body.value))
        user_vote = body.value
        is_new_upvote = body.value == 1

    # Symmetry with vote_review: notify the reply author on a fresh upvote.
    # Same notification type ("upvote") + review_id so the existing notification
    # template + click-through (which links to the entity page anchored at the
    # review) still works without a new notification type.
    if is_new_upvote and reply.user_id != user_id:
        await create_notification(db, user_id=reply.user_id, type="upvote",
                                  actor_id=user_id, review_id=review_id)

    await db.commit()

    # Return updated counts
    vote_rows = (await db.execute(
        select(ReviewReplyVote).where(ReviewReplyVote.reply_id == reply_id)
    )).scalars().all()
    upvotes = sum(1 for v in vote_rows if v.value == 1)
    downvotes = sum(1 for v in vote_rows if v.value == -1)
    return {"upvotes": upvotes, "downvotes": downvotes, "user_vote": user_vote}


@router.get("/reviews/{review_id}/replies")
async def get_replies(
    review_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """List replies on a review. Paginated by `limit` + `offset` over the
    chronologically-ordered (created_at asc) result set. Default page size
    is 50 — bigger than the review page because each reply is a much
    smaller payload than a parent review row.

    Response shape: `{items, has_more, total}`. Frontend's buildReplyTree
    handles cases where a reply's parent is in a not-yet-loaded page — the
    orphan re-roots as a top-level reply so the thread still renders
    instead of dropping rows.

    Block filtering applies BEFORE pagination so a viewer never sees
    blocked-user replies counted toward their page total.
    """
    all_replies = (await db.execute(
        select(ReviewReply)
        .where(ReviewReply.review_id == review_id)
        .order_by(ReviewReply.created_at.asc())
    )).scalars().all()

    if not all_replies:
        return {"items": [], "has_more": False, "total": 0}

    # Hide replies from users the viewer has blocked.
    blocked = await blocked_user_ids(db, user_id)
    if blocked:
        all_replies = [r for r in all_replies if r.user_id not in blocked]
        if not all_replies:
            return {"items": [], "has_more": False, "total": 0}

    total = len(all_replies)
    replies = all_replies[offset:offset + limit]
    has_more = offset + limit < total
    if not replies:
        return {"items": [], "has_more": has_more, "total": total}

    # Batch-fetch all reply votes for this thread in one query. Aggregating
    # to {reply_id: {up, down}} client-side keeps this proportional to the
    # number of distinct replies (typically <50), not to the vote count.
    reply_ids = [r.id for r in replies]
    reply_vote_rows = (await db.execute(
        select(ReviewReplyVote).where(ReviewReplyVote.reply_id.in_(reply_ids))
    )).scalars().all()
    reply_vote_map: dict[int, dict[str, int]] = {}
    reply_user_vote_map: dict[int, int] = {}
    for v in reply_vote_rows:
        bucket = reply_vote_map.setdefault(v.reply_id, {"up": 0, "down": 0})
        if v.value == 1:
            bucket["up"] += 1
        elif v.value == -1:
            bucket["down"] += 1
        if user_id and v.user_id == user_id:
            reply_user_vote_map[v.reply_id] = v.value

    # Combine reply authors with @-mentioned users so the response carries
    # both display names + IDs for mention-link rendering without a second
    # round-trip.
    mention_ids_per_reply: dict[int, list[str]] = {
        r.id: _mentions.load_ids(r.mention_user_ids) for r in replies
    }
    all_mentioned: set[str] = set()
    for ids in mention_ids_per_reply.values():
        all_mentioned.update(ids)
    user_ids = list({r.user_id for r in replies} | all_mentioned)
    users = (await db.execute(
        select(User).where(User.id.in_(user_ids))
    )).scalars().all()
    user_map = {u.id: u for u in users}

    out = []
    for r in replies:
        mentions_out = []
        for mid in mention_ids_per_reply.get(r.id, []):
            mu = user_map.get(mid)
            if mu is None:
                continue
            mentions_out.append({"id": mu.id, "display_name": mu.display_name})
        votes = reply_vote_map.get(r.id, {"up": 0, "down": 0})
        out.append({
            "id": r.id,
            "body": r.body,
            # NULL = top-level reply under the review; non-null = threaded reply
            # pointing at another reply in the same review. Frontend uses this to
            # build the tree client-side.
            "parent_reply_id": r.parent_reply_id,
            "created_at": r.created_at.isoformat() + "Z",
            "mentions": mentions_out,
            # Vote shape mirrors what GET /reviews/... returns for the parent
            # review (upvotes / downvotes / user_vote) so the same vote UI
            # used at the top level can be reused for replies.
            "upvotes": votes["up"],
            "downvotes": votes["down"],
            "user_vote": reply_user_vote_map.get(r.id),
            "user": {
                "id": r.user_id,
                "display_name": user_map[r.user_id].display_name if r.user_id in user_map else "Unknown",
                "image_url": user_map[r.user_id].image_url if r.user_id in user_map else None,
            },
        })
    return {"items": out, "has_more": has_more, "total": total}


@router.post("/reviews/{review_id}/reply")
async def post_reply(
    review_id: int, body: ReplyIn,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to reply")

    # Verify review exists
    review = (await db.execute(
        select(Review).where(Review.id == review_id)
    )).scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    # When parent_reply_id is set, the parent must (a) exist and (b) belong
    # to this same review. Without the second check a malicious client could
    # graft a reply onto a totally different thread by forging the ID.
    if body.parent_reply_id is not None:
        parent = (await db.execute(
            select(ReviewReply).where(ReviewReply.id == body.parent_reply_id)
        )).scalar_one_or_none()
        if not parent or parent.review_id != review_id:
            raise HTTPException(status_code=400, detail="Invalid parent_reply_id")

    body_text = body.body.strip()

    # Resolve @-mentions in the reply body. Same combined-resolver
    # pattern as upsert_review so multi-word display names picked via
    # the autocomplete also resolve correctly.
    mention_ids = await _mentions.resolve_combined_mentions(
        db, body_text,
        client_user_ids=body.mention_user_ids,
        exclude_user_id=user_id,
    )

    db.add(ReviewReply(
        review_id=review_id,
        user_id=user_id,
        body=body_text,
        parent_reply_id=body.parent_reply_id,
        mention_user_ids=_mentions.dump_ids(mention_ids),
    ))
    # Notify the review author for top-level replies; for threaded replies
    # notify the parent reply's author instead so the right person hears
    # about it. Skip self-notifies (replying to yourself shouldn't notify).
    notify_user_id = review.user_id
    if body.parent_reply_id is not None and parent.user_id != user_id:
        notify_user_id = parent.user_id
    if notify_user_id != user_id:
        await create_notification(db, user_id=notify_user_id, type="reply",
                                  actor_id=user_id, review_id=review_id)

    # Fire one "mention" per @-tagged user. Skip the recipient who's
    # already getting a "reply" notification — they'd otherwise get two
    # pings for the same action.
    for muid in mention_ids:
        if muid == notify_user_id:
            continue
        await create_notification(
            db,
            user_id=muid,
            type="mention",
            actor_id=user_id,
            review_id=review_id,
            entity_type=review.entity_type,
            entity_id=review.entity_id,
        )

    await db.commit()
    return {"ok": True}


# Keep legacy like endpoint so old cached frontend calls don't break
@router.post("/reviews/{review_id}/like")
async def toggle_like(
    review_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to like reviews")
    existing = (await db.execute(
        select(ReviewLike).where(
            ReviewLike.user_id == user_id,
            ReviewLike.review_id == review_id,
        )
    )).scalar_one_or_none()
    if existing:
        await db.execute(delete(ReviewLike).where(
            ReviewLike.user_id == user_id,
            ReviewLike.review_id == review_id,
        ))
        liked = False
    else:
        db.add(ReviewLike(user_id=user_id, review_id=review_id))
        liked = True
    await db.commit()
    return {"liked": liked}
