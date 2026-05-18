"""
For You feed — personalized track discovery.

Personalization signals (logged-in)
───────────────────────────────────
Read server-side from UserTasteProfile so they follow the user across devices:
  • liked_artist_ids       — set by onboarding + every 4–5★ track rating
  • genres                 — set by onboarding (client also caches own copy)
  • excluded_genres        — user-driven hard-exclude via profile-page
                              toggle. Removed from the tier 1 candidate pool
                              BEFORE weighted sampling, so an excluded genre
                              never spends a Spotify search slot.
  • disliked_artist_ids    — explicit "Not interested" clicks (hard exclude)
  • down_weighted_artist_ids — inferred from 1–2★ ratings (soft exclude:
                              dropped from tier 1 personalized pivots,
                              still allowed in baseline chart tiers)

Cold-start vs. personalized
───────────────────────────
There is no hard threshold — *any* liked artist or genre signal is used
immediately (a 5★ on the first card affects the very next batch). When
the user has nothing yet, the feed serves Deezer charts + new music for
variety while the taste profile builds.

Tier ladder (in order, until `limit` tracks are gathered)
─────────────────────────────────────────────────────────
Three modes; mutually exclusive, chosen at request time:

  • Vintage (year_range set; user has ≥60% decade pref in one decade)
      1. Weighted-genre pivot, Spotify, year-locked
      2. Spotify genre-agnostic baselines, year-locked

  • Genre-locked (user has any preferred genre OR any excluded genre)
      1. Weighted-genre pivot, Spotify — bumped to k=6, limit=20/genre
      2. Spotify search on user's UNSAMPLED preferred genres
      3. Deezer keyword fallback restricted to user genres (rare)
    Deezer chart is deliberately SKIPPED here: it's genre-agnostic and was
    the source of the "country in my hip-hop feed" leakage when the chart
    happened to be country-heavy.

  • Cold-start (no genre prefs, no exclusions)
      1. Weighted-genre pivot (no-op if no prefs)
      2. Deezer chart baseline /chart/0/tracks
      3. Deezer new music search
      4. Deezer keyword fallbacks

Weighted-genre pivot details: sample k genres from profile.genres weighted
by position (decay 0.90^i). Front of the list = most-recent + most-
frequent prepend, so a user's top genre lands in ~50% of batches while
position-15 still lands in ~6%. For each sampled genre, Spotify search
returns a pool that's then popularity-curve-sampled to match the user's
average liked-track popularity (target_popularity).

Tier 1 honors down-weighted artists. Tiers 2–4 only honor hard dislikes.
This means a single low rating won't blackhole an artist from charts, but
explicit "Not interested" will.

Cover-spam filter (all tiers)
─────────────────────────────
_is_low_quality_cover runs per-track in the response path (inside the
_make_adder closure, before exclusion checks). Catches the workout /
karaoke / tribute / "Originally Performed by" / "BPM" spam that Spotify
and Deezer both surface in volume. Independent of genre/artist filters
because the cover-factory artists are often legitimately tagged with
on-genre microgenres ("hip hop running workout") and pass the artist-
genre verification. Patterns live at module level, conservative by
design — see _COVER_TITLE_PATTERNS / _COVER_ARTIST_PATTERNS.

Cross-tier decade rerank
────────────────────────
Inside each tier's add-batch loop, candidates are re-sorted by how well
their release_date matches the user's 4–5★ decade distribution (see
_compute_decade_preference / _decade_score). A user who rates mostly
80s tracks gets 80s-era candidates surfaced at the top of every tier's
slice — including tier 2 chart candidates that happen to be reissues
or vintage-leaning playlists. Decades not in the user's history still
flow through at a 0.05 floor so the feed never goes empty when the
preferred pool is thin. Tier ORDER is preserved (tier 1 still adds
before tier 2 etc.) — only WITHIN-tier ordering changes.

Release-date accuracy: we COALESCE TrackCache/AlbumCache.original_release_date
(populated from Apple Music when matched — more accurate for vintage
catalog) over Spotify's release_date (often the remaster/reissue date).

Concentrated-decade year-lock (tier 1 AND tier 2)
─────────────────────────────────────────────────
When the user's positive decade preference is ≥ 60% concentrated in a
single decade, tier 1's Spotify search appends a year:YYYY-YYYY filter
so candidates COME FROM that decade rather than being filtered after
the fact. Tier 2-4 also swap: Deezer has no year-filter syntax, so
in vintage mode tier 2 becomes a Spotify year-locked baseline across
3 high-coverage genres (pop/rock/hip-hop), and tiers 3-4 (Deezer new
music + keyword fallbacks) are skipped entirely — they'd contribute
modern candidates that contradict the user's explicit decade pick.
Mixed-taste users (no dominant decade) keep the unfiltered Spotify
search at tier 1 AND the Deezer baseline at tiers 2-4.

Negative signal (1–2★ ratings)
──────────────────────────────
_compute_negative_preferences mirrors the positive computation but on
1-2★ ratings:
  • negative_decade_pref: applied as a half-strength penalty to
    _decade_score for matching decades. A user who 1★s 2010s tracks
    sees 2010s candidates ranked lower in every tier's batch.
  • negative_genre_pref: tier 1's seed genre list is filtered to drop
    genres where ≥ 30% of the down-weighted-artists belong. Fallback
    keeps ≥ 2 genres eligible so a heavy negative signal can't empty
    the seed pool.

Multi-genre diversity
─────────────────────
Tier 1 samples k=4 genres per batch (bumped from 3) with position
decay 0.90 (flattened from 0.85). Users with a wide profile see more
of their tail genres surface instead of the top genre dominating every
batch.
"""

import asyncio
import json
import logging
import random
import re
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

logger = logging.getLogger(__name__)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlbumCache, ArtistCache, Rating, TrackCache, UserTasteProfile
from routers.auth import optional_user_id
from services import spotify
from services import deezer as deezer_svc
from services.limiter import limiter

router = APIRouter(prefix="/discover", tags=["discover"])


# ── Low-quality-cover detection ────────────────────────────────────────────────
# Spotify (and to a lesser extent Deezer) are flooded with workout / karaoke /
# tribute / "in the style of" covers — labels generate BPM-matched and karaoke
# versions of popular songs at scale to capture stream royalties. These
# survived the artist-genre verification filter because the cover artists are
# genuinely tagged with on-genre microgenres ("hip hop running workout" matches
# "hip-hop" via substring, so a track called "Get Low - Running Mix 140 BPM"
# by "Workout Music" passes that check). The fix is a track-level pattern
# denylist applied at the discover-tier level, so it catches matches from
# every source (Spotify genre search, Deezer chart, Deezer search).
#
# Patterns are CONSERVATIVE. False positives — accidentally filtering a legit
# "Acoustic Version" / "Live at X" / "Remastered" / "Sped Up" track — are the
# expensive failure mode (real song missing from feed). False negatives — some
# covers slip through — are cheap (one bad card in a deck of ten). Anything
# that's a real-catalog variation of an original release explicitly is NOT
# matched. Add a pattern only when you've seen the same kind of cover spam
# show up at least three different ways in production.
_COVER_TITLE_PATTERNS = re.compile(
    r"(?:"
    r"\d{2,3}\s*bpm"                       # "140 BPM", "120bpm"
    r"|workout\s+mix"
    r"|running\s+mix"
    r"|cardio\s+mix"
    r"|aerobics?\s+mix"
    r"|spinning?\s+mix"
    r"|cycling\s+mix"
    r"|treadmill\s+mix"
    r"|karaoke\s+version"
    r"|\(karaoke\)|\[karaoke\]"
    r"|-\s*karaoke(?:\s|$)"
    r"|originally\s+performed\s+by"
    r"|in\s+the\s+style\s+of"
    r"|made\s+famous\s+by"
    r"|tribute\s+to"
    r"|-\s*tribute(?:\s|$)"
    r"|lullaby\s+version"
    r"|music\s+box\s+version"
    r"|8[-\s]bit\s+version"
    r"|cover\s+version"
    r")",
    re.IGNORECASE,
)

# Album-name denylist. Catches the "factory beat pack" sub-industry — labels
# pushing instrumental-loop packs labeled "Hip Hop Instrumental Beats 2019,
# Pt. 12" / "Type Beats Vol. 5" / "Lo-Fi Beats to Study To" to capture
# royalties on playlist auto-shuffle. The track titles in these packs are
# often just stock names ("Rompo El Tempo", "Sad", "Vibe 04") with no
# spam signal of their own; the album name is the only tell.
#
# Patterns are tightly anchored to avoid clobbering real albums:
#   - "Instrumental Beats" → only ever appears in spam packs
#   - "Type Beat" → "Drake Type Beat", "Future Type Beats Vol 3" — spam
#   - "Beats Vol. X" / "Beats Pt. X" / "Beats, Pt. X" — almost always a pack
#   - "<lofi|trap|hip-hop|rap|boom-bap> Beats" with word boundary — pack pattern
#     (legit albums name themselves "Beats, Rhymes and Life" / "Donuts" / etc.
#     — none have a genre prefix immediately before the word "Beats")
#   - "Music for (studying|sleeping|yoga|workout|meditation|...)" — the focus-
#     playlist factory pattern. "Music for Airports" (Eno) is NOT in the
#     allowed-after list, so it's safe.
_COVER_ALBUM_PATTERNS = re.compile(
    r"(?:"
    r"instrumental\s+beats"
    r"|type\s+beats?"
    r"|beat\s+pack"
    # "Beats Vol. X" / "Instrumentals Vol. 51" / "Instrumental Pt. 3" — all
    # variants of the factory pack-numbering format. The original pattern
    # was beats-only; extending to instrumentals catches "Hip-Hop
    # Instrumentals, Vol. 51" which slipped through on first deploy.
    r"|(?:beats?|instrumentals?),?\s*(?:vol|pt|part)\.?\s*\d"
    r"|royalty[-\s]?free"
    r"|background\s+music\s+for"
    r"|(?:lofi|lo[-\s]?fi|trap|boom[\s-]?bap|hip[-\s]?hop|hiphop|rap)\s+beats?\b"
    r"|music\s+for\s+(?:studying|sleep(?:ing)?|yoga|workout|meditation|reading|focus|concentration|relaxation|spa|massage)"
    # Children's-cover-pack vertical. "Kidz Bop 30", "Kidz Bop Kids"
    # albums, "The Best of Kidz Bop". Distinct from karaoke vibes —
    # same category of mass-produced covers, different audience.
    r"|kidz\s+bop"
    r"|toddler\s+(?:tunes|songs|hits)"
    r"|nursery\s+rhymes?\s+(?:vol|pt|collection|favorites|hits)"
    r")",
    re.IGNORECASE,
)

# Artist-name denylist. Matched against EACH artist name on the track — if
# ANY credited artist's name fits the pattern, drop the track. Anchored with
# word boundaries so "Tributary Music Co." (hypothetical legit artist) isn't
# clobbered by the broader "tribute" rule.
_COVER_ARTIST_PATTERNS = re.compile(
    r"\b(?:"
    r"karaoke"
    r"|tribute\s+band"
    r"|workout\s+music"
    r"|running\s+music"
    r"|cycling\s+music"
    r"|spinning\s+music"
    r"|yoga\s+music"
    r"|spa\s+music"
    r"|lullaby"
    r"|sleep\s+music"
    r"|cover\s+band"
    r"|cover\s+hits"
    r"|hit\s+crew"
    r"|hit\s+co\.?"
    r"|studio\s+sound\s+group"
    r"|8[-\s]bit\s+(?:universe|arcade)"
    r"|music\s+box"
    r"|kidz\s+bop"          # "Kidz Bop Kids" — children's pop covers
    r"|toddler\s+tunes"
    r"|nursery\s+rhymes"
    r")\b",
    re.IGNORECASE,
)


def _is_low_quality_cover(track: dict) -> bool:
    """True if the track looks like a workout / karaoke / tribute cover or a
    factory beat-pack track, not an original release. See module-level
    _COVER_*_PATTERNS for the pattern catalog and the rationale on
    conservativeness.

    Triggers on ANY of three independent signals (one is enough):
      1. Track title contains a known cover-spam suffix (BPM, "Workout Mix",
         "Karaoke Version", "Originally Performed by", "In the Style of",
         etc.).
      2. Album name matches a factory-beat-pack pattern ("Hip Hop
         Instrumental Beats 2019, Pt. 12", "Type Beats Vol. 5",
         "Lo-Fi Beats to Study To"). This catches the case where the
         track title alone is generic and gives zero signal — the album
         name is the only tell.
      3. Credited artist name matches a well-known cover-factory label
         ("Workout Music", "The Karaoke Channel", "Lullaby Players").
    """
    name = track.get("name") or ""
    if name and _COVER_TITLE_PATTERNS.search(name):
        return True
    album_name = track.get("album_name") or ""
    if album_name and _COVER_ALBUM_PATTERNS.search(album_name):
        return True
    artists = track.get("artists") or []
    for a in artists:
        if a and _COVER_ARTIST_PATTERNS.search(a):
            return True
    return False

# Deezer queries for the new-music and fallback tiers (no Spotify needed).
# Tier 2 uses the chart API directly (no text search → no "Top Hits band" problem).
_DEEZER_NEW_QUERIES = ["new music 2025", "new songs 2025", "fresh music"]
_DEEZER_FALLBACK_QUERIES = [
    "pop hits",
    "hip hop",
    "indie pop",
    "r&b",
    "alternative rock",
]


# Explicit non-English language tags often appear in romanized form inside
# album metadata: "Jetlee (Dialogues) [TELUGU]", "Bharat Anthem (Hindi)",
# "Sajni (Tamil Version)". The track title and primary artist name are
# often romanized ASCII (passing the Latin-script gate), so the album-name
# tag is the only reliable signal. This list is the major non-English
# language tags we've seen pollute the english-mode feed; matched
# case-insensitively against both bracketed and parenthesized forms.
#
# Spanish is intentionally NOT on this list — Spanish-language tracks are
# allowed in english mode (their text is Latin-script and they're a
# significant fraction of US streaming). When the user explicitly picks
# language=spanish we don't apply this filter at all.
_NON_ENGLISH_ALBUM_TAG_PATTERNS = re.compile(
    # `[language]` / `(language)` / `[language version]` / `(tamil dub)` etc.
    # The opening bracket + optional whitespace anchor prevents matches
    # against legit text like "Hindi Zahra" or "My Telugu Cousin" — the
    # language word has to be RIGHT after the bracket. After the language
    # word, allow either an immediate closing bracket, or a space followed
    # by non-bracket content up to the close (covers "(Tamil Version)",
    # "[Hindi Songs]", "(Telugu Movie)" etc.).
    r"[\[\(]\s*(?:"
    r"telugu|hindi|tamil|punjabi|bengali|malayalam|kannada|marathi"
    r"|gujarati|urdu|nepali|sinhala|odia|assamese"
    r"|arabic|farsi|persian|hebrew|turkish"
    r"|mandarin|cantonese|chinese|korean|japanese|thai|vietnamese|indonesian|tagalog|filipino"
    r"|russian|polish|czech|slovak|hungarian|romanian|bulgarian|serbian|croatian|ukrainian"
    r"|greek"
    # Common short tags
    r"|tel(?:ugu)?|hin(?:di)?|tam(?:il)?|pun(?:jabi)?|ben(?:gali)?"
    r")(?:\s+[^\[\]\(\)]*)?[\]\)]",
    re.IGNORECASE,
)


def _is_likely_english(text: str) -> bool:
    """
    Return True if the text looks like it's primarily Latin/English.
    Filters out Cyrillic, CJK, Arabic, etc. while allowing French/Spanish
    accented chars (which are ≤30 % of most Western-language titles).
    """
    if not text:
        return True
    non_ascii = sum(1 for c in text if ord(c) > 127)
    return (non_ascii / len(text)) < 0.3


def _passes_language_filter(text: str, language: str) -> bool:
    """
    Single dispatch: route to the right filter based on the language enum
    coming from the /feed request.

      english → Latin script only (filters Cyrillic/CJK/Arabic/etc.;
                Latin-script tracks in other Western languages still pass).
                Maps to the old english_only=True behavior.
      spanish → Latin script only. NOT a strict Spanish-only filter — the
                actual Spanish bias comes from passing market="ES" to
                Spotify's search, which surfaces Spanish-region-popular
                tracks at the top of the genre pool. The previous version
                of this filter required Spanish diacritics or stopwords on
                track/artist text, which dropped ~everything because most
                rap and classical search results are English-titled even
                when popular in Spain. Result: empty feed, never loads.
                Now we trust Spotify's market-based ranking and just keep
                the Latin-script gate to filter Cyrillic/CJK.
      all     → no filter; everything passes.
    """
    if language == "all":
        return True
    return _is_likely_english(text)  # Latin-script gate for both english + spanish


def _weighted_sample(items: list, weights: list[float], k: int) -> list:
    """
    Sample `k` items from `items` without replacement, weighted by `weights`.

    Uses Efraimidis-Spirakis weighted reservoir sampling: assign each item
    a key = U ** (1 / w), sort descending, take top k. Equivalent to
    drawing k times from the discrete distribution and removing the chosen
    item each draw, but in a single sort pass.

    When k >= len(items) returns all items (trivially). When weights and
    items lengths mismatch, zip truncates to the shorter — caller's
    responsibility to keep them aligned.
    """
    if k >= len(items):
        return list(items)
    keyed = [
        (random.random() ** (1.0 / max(w, 1e-9)), x)
        for x, w in zip(items, weights)
    ]
    keyed.sort(key=lambda p: p[0], reverse=True)
    return [x for _, x in keyed[:k]]


async def _compute_target_popularity(db: AsyncSession, user_id: str) -> float | None:
    """
    Average Spotify popularity (0–100) of the tracks this user has rated 4–5★.

    Drives the per-user popularity curve in spotify.search_tracks_by_genre.
    A user whose high-rated tracks average to popularity ~25 (consistent
    niche taste) gets a sampling curve peaked at 25; one whose average is
    ~80 (mainstream-listener) gets a curve peaked at 80. Returns None if
    the user has zero high ratings of tracks we have popularity data for,
    in which case the genre search falls back to a target=70 default
    (mild mainstream lean — fine for cold-start).

    Cheap indexed join (ratings.user_id + track_cache.spotify_id are both
    indexed). Run on every /feed call; no caching beyond what SQLAlchemy's
    session does — the value drifts slowly enough that staleness inside a
    single request isn't a concern, and recomputing keeps it honest as
    the user rates more tracks.
    """
    row = await db.execute(
        select(func.avg(TrackCache.popularity))
        .select_from(Rating)
        .join(TrackCache, Rating.entity_id == TrackCache.spotify_id)
        .where(
            Rating.user_id == user_id,
            Rating.entity_type == "track",
            Rating.value >= 4.0,
            TrackCache.popularity.is_not(None),
        )
    )
    avg = row.scalar()
    return float(avg) if avg is not None else None


async def _compute_decade_preference(
    db: AsyncSession, user_id: str
) -> Optional[dict[str, float]]:
    """
    Distribution of release decades across the user's 4–5★ ratings.

    Returns something like {"1980s": 0.65, "1990s": 0.20, "2010s": 0.15}
    when there's enough signal, or None otherwise. The For You feed uses
    this to bias candidate ordering inside each tier so a user who
    consistently 5★s 80s tracks doesn't get the feed dominated by
    current-week chart hits.

    Thresholds: requires ≥ 5 high ratings AND ≥ 3 of them resolving to
    a parseable release year. Below those, no signal — the rest of the
    feed code treats None as "no decade preference yet, keep tier order
    as-is" so cold-start users see normal variety.

    Reads release_date out of the local TrackCache / AlbumCache (already
    populated for everything the user has interacted with). No Spotify
    fetch — cheap query.
    """
    high_ratings = (await db.execute(
        select(Rating).where(
            Rating.user_id == user_id,
            Rating.value >= 4,
            Rating.entity_type.in_(("track", "album")),
        )
    )).scalars().all()

    if len(high_ratings) < 5:
        return None

    track_ids = [r.entity_id for r in high_ratings if r.entity_type == "track"]
    album_ids = [r.entity_id for r in high_ratings if r.entity_type == "album"]

    # Prefer original_release_date (populated from Apple Music when matched)
    # over Spotify's release_date — Apple is generally more accurate for
    # vintage catalog where Spotify shows the remaster upload date. COALESCE
    # picks Apple's value first, Spotify's as fallback, NULL when neither
    # is populated.
    release_dates: list[str] = []
    if track_ids:
        rows = (await db.execute(
            select(func.coalesce(TrackCache.original_release_date, TrackCache.release_date))
            .where(TrackCache.spotify_id.in_(track_ids))
        )).scalars().all()
        release_dates.extend(d for d in rows if d)
    if album_ids:
        rows = (await db.execute(
            select(func.coalesce(AlbumCache.original_release_date, AlbumCache.release_date))
            .where(AlbumCache.spotify_id.in_(album_ids))
        )).scalars().all()
        release_dates.extend(d for d in rows if d)

    decade_counts: dict[str, int] = {}
    for date_str in release_dates:
        m = re.match(r"^(\d{4})", date_str or "")
        if not m:
            continue
        year = int(m.group(1))
        if year < 1950 or year > 2100:
            continue
        decade_key = f"{(year // 10) * 10}s"
        decade_counts[decade_key] = decade_counts.get(decade_key, 0) + 1

    total = sum(decade_counts.values())
    if total < 3:
        return None

    return {d: c / total for d, c in decade_counts.items()}


def _decade_score(
    release_date: Optional[str],
    decade_pref: Optional[dict[str, float]],
    negative_decade_pref: Optional[dict[str, float]] = None,
) -> float:
    """
    Score 0–1 for how well a candidate track's release decade matches the
    viewer's decade preference. Used to re-rank within a tier so the
    user's preferred era surfaces at the top of the candidate pool.

    Returns 0.5 (neutral) when there's no preference signal yet — keeps
    cold-start ordering unchanged. For users with a preference, decades
    they've rated get their proportional weight; decades they haven't
    rated get a small floor (0.05) so candidates from "other" decades
    can still surface when the preferred pool is thin, instead of the
    feed going empty.

    negative_decade_pref dampens the score for decades the user has
    consistently 1–2★'d. The penalty is half-strength of the positive
    weight so a single down-rating can't blackhole a decade with one
    counter-data-point — the user has to consistently dislike a decade
    for it to drop noticeably.
    """
    if not decade_pref:
        return 0.5
    if not release_date:
        return 0.3  # unknown date — minor penalty, not exclusion
    m = re.match(r"^(\d{4})", release_date)
    if not m:
        return 0.3
    year = int(m.group(1))
    decade_key = f"{(year // 10) * 10}s"
    base = max(decade_pref.get(decade_key, 0.05), 0.05)
    if negative_decade_pref:
        penalty = negative_decade_pref.get(decade_key, 0.0) * 0.5
        base = max(base - penalty, 0.01)
    return base


async def _compute_negative_preferences(
    db: AsyncSession, user_id: str
) -> tuple[Optional[dict[str, float]], Optional[dict[str, float]]]:
    """
    Decade + genre distributions from the user's 1–2★ ratings — the "what
    they actively dislike" signal that complements the positive 4–5★ one.

    Returns (negative_decade_pref, negative_genre_pref). Either can be
    None when there's not enough data; both can be None on a clean
    profile. Mirrors _compute_decade_preference's lazy DB-only approach —
    no Spotify/external calls.

    Decade: bin 1–2★ ratings by release year (Apple's date when
    populated, Spotify's as fallback — same COALESCE as positive).
    Genre: take the user's down_weighted_artist_ids (already maintained
    by ratings._down_weight_from_rating on every 1–2★ track rating),
    fetch each artist's ArtistCache.genres, count.

    Returns dicts normalized to proportions: {"2010s": 0.6, "2020s": 0.4}
    and {"trap": 0.5, "soundcloud rap": 0.3, ...}.
    """
    low_ratings = (await db.execute(
        select(Rating).where(
            Rating.user_id == user_id,
            Rating.value <= 2,
            Rating.entity_type.in_(("track", "album")),
        )
    )).scalars().all()
    if len(low_ratings) < 3:
        return None, None

    # ── Decade signal ────────────────────────────────────────────────
    track_ids = [r.entity_id for r in low_ratings if r.entity_type == "track"]
    album_ids = [r.entity_id for r in low_ratings if r.entity_type == "album"]
    release_dates: list[str] = []
    if track_ids:
        rows = (await db.execute(
            select(func.coalesce(TrackCache.original_release_date, TrackCache.release_date))
            .where(TrackCache.spotify_id.in_(track_ids))
        )).scalars().all()
        release_dates.extend(d for d in rows if d)
    if album_ids:
        rows = (await db.execute(
            select(func.coalesce(AlbumCache.original_release_date, AlbumCache.release_date))
            .where(AlbumCache.spotify_id.in_(album_ids))
        )).scalars().all()
        release_dates.extend(d for d in rows if d)

    decade_counts: dict[str, int] = {}
    for date_str in release_dates:
        m = re.match(r"^(\d{4})", date_str or "")
        if not m:
            continue
        year = int(m.group(1))
        if year < 1950 or year > 2100:
            continue
        decade_counts[f"{(year // 10) * 10}s"] = decade_counts.get(f"{(year // 10) * 10}s", 0) + 1
    total_decades = sum(decade_counts.values())
    negative_decade_pref = (
        {d: c / total_decades for d, c in decade_counts.items()}
        if total_decades >= 2
        else None
    )

    # ── Genre signal ─────────────────────────────────────────────────
    # Read down_weighted_artist_ids out of the profile — already populated
    # by ratings._down_weight_from_rating on every 1-2★ track rating. Then
    # bin each artist's cached Spotify genres.
    from models import ArtistCache, UserTasteProfile
    profile = await db.get(UserTasteProfile, user_id)
    negative_genre_pref: Optional[dict[str, float]] = None
    if profile and profile.down_weighted_artist_ids:
        down_artists: list[str] = json.loads(profile.down_weighted_artist_ids or "[]")
        if down_artists:
            artist_rows = (await db.execute(
                select(ArtistCache.genres).where(ArtistCache.spotify_id.in_(down_artists))
            )).scalars().all()
            genre_counts: dict[str, int] = {}
            for genres_json in artist_rows:
                if not genres_json:
                    continue
                try:
                    for g in json.loads(genres_json):
                        if isinstance(g, str) and g.strip():
                            genre_counts[g] = genre_counts.get(g, 0) + 1
                except Exception:
                    continue
            total_genres = sum(genre_counts.values())
            if total_genres >= 3:
                negative_genre_pref = {g: c / total_genres for g, c in genre_counts.items()}

    return negative_decade_pref, negative_genre_pref


def _flatten_shuffle_add(results: list, adder) -> None:
    """
    Flatten per-query results from an asyncio.gather() call, shuffle as a
    single pool, and add to the batch.

    Why: without this, results cluster by source query — all 15 "pop hits"
    in a row, then 15 "indie pop", etc. The feed feels monotone at the top
    even when upstream diversity is healthy.

    Pairs with the removal of the post-slice random.shuffle(result) at the
    end of /feed: tier order is now stable (tier 1 personalized first,
    tier 2 chart baseline later), so within-tier shuffle is what supplies
    the variety the post-slice shuffle used to (badly) provide.
    """
    flat = [t for res in results if isinstance(res, list) for t in res]
    random.shuffle(flat)
    adder(flat)


@router.get("/feed")
@limiter.limit("60/minute")
async def get_discover_feed(
    request: Request,
    genres: Optional[str] = Query(None, description="Comma-separated genre slugs from client prefs (logged-out fallback)"),
    liked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs rated 4–5 stars (logged-out fallback)"),
    disliked_artists: Optional[str] = Query(None, description="Comma-separated artist IDs marked 'not interested' (logged-out fallback; logged-in users use server profile)"),
    exclude: Optional[str] = Query(None, description="Comma-separated track IDs already shown to this user in the current scroll session — excluded from the batch so prefetches don't repeat tracks from earlier batches"),
    english_only: bool = Query(True, description="DEPRECATED — use `language` instead. Kept for older mobile clients that still send this param; mapped to language=english when true, language=all when false."),
    language: Optional[str] = Query(None, description="Language filter: 'english' (Latin script only, default), 'spanish' (Spanish indicators required), 'all' (no filter). Overrides english_only when set."),
    limit: int = Query(10, le=20),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(optional_user_id),
):
    """
    Return a batch of tracks for the For You scroll feed.
    For logged-in users every personalization signal is read server-side from
    UserTasteProfile; client params act as a fallback for logged-out users.
    """
    # Exclude tracks this user has already rated — track-level signal,
    # independent of artist-level dislikes.
    exclude_ids: set[str] = set()
    if user_id:
        rated_ids = (await db.execute(
            select(Rating.entity_id).where(
                Rating.user_id == user_id,
                Rating.entity_type == "track",
            )
        )).scalars().all()
        exclude_ids.update(rated_ids)

    # Client-supplied session exclusion list — track IDs the user has
    # already seen this scroll session. Prevents prefetch batches from
    # repeating tracks from earlier batches when the same Deezer chart
    # response is still warm in cache.
    if exclude:
        exclude_ids.update(e.strip() for e in exclude.split(",") if e.strip())

    # ── Resolve preferences from server profile or client fallback ───────────
    genre_list: list[str] = []
    excluded_genre_set: set[str] = set()
    liked_artist_ids: list[str] = []
    disliked_set: set[str] = set()
    down_weighted_set: set[str] = set()

    if user_id:
        try:
            profile = await db.get(UserTasteProfile, user_id)
            if profile:
                genre_list = json.loads(profile.genres or "[]")
                # getattr — excluded_genres column was added in migration
                # x4y5z6a7b8c9; on prod rows pre-deploy it's missing.
                excluded_genre_set = set(
                    json.loads(getattr(profile, "excluded_genres", None) or "[]")
                )
                liked_artist_ids = json.loads(profile.liked_artist_ids or "[]")
                disliked_set = set(json.loads(profile.disliked_artist_ids or "[]"))
                down_weighted_set = set(json.loads(profile.down_weighted_artist_ids or "[]"))
        except Exception:
            # Table or new columns may not exist yet on first deploy
            pass

    # Hard-filter the candidate genre list with the user's exclusions BEFORE
    # tier 1 sees them. Tier 1's weighted sample never picks an excluded
    # genre, which means we never spend a Spotify search slot on tracks the
    # user has explicitly said "not for me". This is the cheapest possible
    # negative-signal mechanism — no API calls, no post-filter, the genre
    # is just gone from the eligible pool.
    if excluded_genre_set:
        genre_list = [g for g in genre_list if g not in excluded_genre_set]

    # Logged-out (or empty server profile) → use client-provided values
    if not genre_list:
        genre_list = [g.strip() for g in genres.split(",")] if genres else []
    if not liked_artist_ids:
        liked_artist_ids = [a.strip() for a in liked_artists.split(",")] if liked_artists else []
    if not disliked_set and disliked_artists:
        disliked_set = {a.strip() for a in disliked_artists.split(",") if a.strip()}

    # Seed list for personalized tiers — exclude both hard dislikes and
    # down-weighted artists. We use a low rating as a "don't pivot off this
    # artist" signal even if it was previously liked.
    seed_artist_ids = [
        a for a in liked_artist_ids
        if a not in disliked_set and a not in down_weighted_set
    ]

    # Soft-exclude is the union of dislikes + down-weights for tier 1
    # (personalized genre pivots). Tiers 2–4 (chart baselines) only honor
    # hard dislikes — a single low rating shouldn't blackhole an artist
    # from popular charts.
    soft_excluded = disliked_set | down_weighted_set

    # Per-user popularity target. A user whose 4–5★ track ratings average
    # to popularity=25 has signaled niche-leaning taste; the Laplace curve
    # inside search_tracks_by_genre will peak there. None → cold-start
    # default (target=70, mild mainstream lean). Only relevant for tier 1
    # — tiers 2–4 are mainstream chart baselines by definition.
    target_popularity: float | None = None
    if user_id:
        try:
            target_popularity = await _compute_target_popularity(db, user_id)
        except Exception:
            # If TrackCache hasn't been populated for any of this user's
            # rated tracks yet (e.g. fresh DB on a new deploy), fall back
            # silently to the cold-start default.
            target_popularity = None

    # Decade-preference signal. Computed from the user's 4–5★ ratings —
    # if they consistently rate 80s tracks high, the feed should favor
    # 80s candidates within each tier. Cold-start users (< 5 high ratings)
    # get None back and the ranker is a no-op. See _decade_score().
    decade_pref: Optional[dict[str, float]] = None
    # Negative signals from 1–2★ ratings — what the user actively dislikes.
    # Negative decade dampens decade_score for low-rated eras; negative
    # genre is used below to filter out heavily-down-rated genres from
    # tier 1's seed pool.
    negative_decade_pref: Optional[dict[str, float]] = None
    negative_genre_pref: Optional[dict[str, float]] = None
    if user_id:
        try:
            decade_pref = await _compute_decade_preference(db, user_id)
        except Exception:
            decade_pref = None
        try:
            negative_decade_pref, negative_genre_pref = await _compute_negative_preferences(db, user_id)
        except Exception:
            negative_decade_pref, negative_genre_pref = None, None

    # When the positive decade preference is concentrated (≥ 60% in one
    # decade), pin Spotify search to that year range so we don't waste a
    # candidate slot on modern hits for a user who reliably wants vintage.
    # Mixed-taste users (no single decade dominant) still get the
    # unfiltered search — they get within-tier re-ranking but full
    # year breadth in the candidate pool. The +0.0001 epsilon avoids
    # rounding-tie cases.
    year_range: Optional[str] = None
    if decade_pref:
        top_decade, top_share = max(decade_pref.items(), key=lambda kv: kv[1])
        if top_share >= 0.60 - 0.0001:
            # decade key is "1980s" — strip the trailing "s" and turn into
            # a Spotify year-range filter like "1980-1989".
            try:
                start = int(top_decade[:-1])
                year_range = f"{start}-{start + 9}"
            except Exception:
                year_range = None

    tracks: list[dict] = []
    seen: set[str] = set()
    # Counter for the cover-spam filter — tracks dropped because they matched
    # _is_low_quality_cover. Logged at request end so we can see if patterns
    # are doing too much or too little and tune over time.
    covers_filtered = 0

    # Resolve language filter mode. `language` query param takes precedence
    # when set (current clients); fall back to mapping the legacy boolean
    # english_only so older mobile builds still get the expected behavior.
    if language in ("english", "spanish", "all"):
        active_language = language
    else:
        active_language = "english" if english_only else "all"

    # Spanish mode biases Spotify's genre search to the Spanish market
    # (market=ES surfaces tracks popular in Spain). The post-fetch language
    # filter does only a Latin-script gate in Spanish mode — too-strict
    # diacritic / stopword filtering left the feed empty for users whose
    # profile genres (hip-hop, classical) don't carry obvious Spanish text
    # markers even when popular in Spain. Letting Spotify's market scoring
    # do the heavy lifting is the right division of responsibility.
    spotify_market = "ES" if active_language == "spanish" else "US"

    def _make_adder(excluded: set[str]):
        def _add(batch: list[dict]) -> None:
            nonlocal covers_filtered
            # Decade re-rank, applied WITHIN each tier's batch before the
            # filter loop. Tracks that match the user's preferred decade
            # surface first within this tier's slice of the batch; tracks
            # from other decades still flow through (with a 0.05 floor)
            # so the feed never goes empty when the preferred pool is thin.
            # Tier order is preserved — tier 1 still adds before tier 2 etc.
            # — so a strong-80s-leaning user gets tier 1 personalized 80s
            # at the top of the batch and tier 2 chart hits below, in
            # decade-preferred order within each. Stable-sort so the
            # _flatten_shuffle_add randomness is preserved on ties.
            local = batch
            if decade_pref:
                local = sorted(
                    batch,
                    key=lambda t: _decade_score(
                        t.get("release_date"), decade_pref, negative_decade_pref
                    ),
                    reverse=True,
                )
            for t in local:
                artist_id = (t.get("artist_ids") or [None])[0]
                if active_language != "all":
                    title_ok = _passes_language_filter(t.get("name", ""), active_language)
                    artist_ok = _passes_language_filter((t.get("artists") or [""])[0], active_language)
                    if not (title_ok and artist_ok):
                        continue
                    # Album-name language tag check. Catches the case where
                    # track title + primary artist are romanized ASCII (so
                    # _is_likely_english passes) but the album metadata
                    # explicitly says it's a non-English release — e.g.
                    # "Jetlee (Dialogues) [TELUGU]" by an artist named
                    # "Satya". Without this check, Spotify's wider hip-hop
                    # text search (which I bumped to k=6/limit=20 in the
                    # genre-locked branch) surfaces Tollywood/Bollywood
                    # hip-hop tracks in english-mode US feeds.
                    album_text = t.get("album_name") or ""
                    if album_text and _NON_ENGLISH_ALBUM_TAG_PATTERNS.search(album_text):
                        continue
                # Workout / karaoke / tribute filter. Applied here (per-track
                # in the response path) rather than upstream so it catches
                # spam from EVERY tier — Spotify genre search AND Deezer
                # chart AND Deezer keyword fallbacks. The artist-genre
                # verification filter in services/spotify.py runs only on
                # Spotify genre pools and let "Get Low - Running Mix 140
                # BPM" by "Workout Music" through because the artist is
                # genuinely tagged with "hip hop running workout".
                if _is_low_quality_cover(t):
                    covers_filtered += 1
                    continue
                if (
                    t.get("id")
                    and t["id"] not in exclude_ids
                    and t["id"] not in seen
                    and artist_id not in excluded
                ):
                    seen.add(t["id"])
                    tracks.append(t)
        return _add

    add_personalized = _make_adder(soft_excluded)
    add_baseline = _make_adder(disliked_set)

    # ── Tier 1: Weighted-genre pivot ─────────────────────────────────────────
    # Sample 3 genres from profile.genres weighted by position. Position 0
    # is the most-recent prepend; the list is dedup'd on every 4–5★ rating
    # so a genre that's been rated repeatedly keeps getting re-prepended →
    # stays near the front. Position is therefore a recency × frequency
    # proxy — exactly the signal "preferred genres" wants.
    #
    # Decay 0.85: position-0 genre has weight 1.0, position-19 ≈ 0.046.
    # At k=3, simulation shows:
    #   position 0 → in ~43% of batches
    #   position 5 → in ~21%
    #   position 10 → in ~10%
    #   position 19 → in ~2%
    # Top genres dominate but tail genres still surface — a user who's
    # rated mostly hip-hop with occasional jazz still gets jazz queries
    # in some batches instead of jazz being functionally invisible.
    #
    # Replaces the previous two-tier setup:
    #   - Tier 1 was a seed-artist pivot (random 3 of top-8 most-recent
    #     liked artists, then their Spotify genres). Recency-of-artist
    #     only, no frequency weighting, cost 3 cached artist lookups.
    #   - Tier 2 was profile.genres[:3], deterministic top-3 every batch.
    # Both treated all liked genres as equal once they entered the
    # profile. The new tier 1 unifies them into one probabilistic pick.
    # Tier 1 multi-genre diversity:
    #   - k bumped 3 → 4 so users with multiple liked genres see breadth
    #     across them in every batch (rather than the top-weighted one
    #     dominating). User reported wanting "diverse set of music I like,
    #     not just one genre at a time."
    #   - decay flattened 0.85 → 0.90 so secondary genres aren't as starved.
    #     At k=4, simulation:
    #       position 0 → in ~50% of batches (was ~43% at k=3, decay=0.85)
    #       position 5 → in ~28%             (was ~21%)
    #       position 10 → in ~16%            (was ~10%)
    #       position 19 → in ~6%             (was ~2%)
    #     Top genre still dominates but the tail surfaces meaningfully more.
    #   - When negative_genre_pref reports the user has consistently
    #     down-rated a particular genre (proportion ≥ 0.30 of their
    #     down-weighted artists' genres), drop it from the candidate
    #     genre list before sampling. Fallback: if the filter would leave
    #     fewer than 2 genres, ignore it — better stale picks than empty.
    tier1_added_before = len(tracks)
    eligible_genres = genre_list
    if negative_genre_pref and len(genre_list) >= 2:
        filtered = [g for g in genre_list if negative_genre_pref.get(g, 0.0) < 0.30]
        if len(filtered) >= 2:
            eligible_genres = filtered

    # Genre-locked mode: user has explicit POSITIVE genre preferences. When
    # set, the ladder skips the genre-agnostic Deezer chart baseline and
    # routes tier 2 through Spotify too, so a hip-hop user never gets
    # country chart hits in their feed just because Deezer's chart happens
    # to be country-heavy this week.
    # year_range (vintage decade preference) wins over genre_locked because
    # its existing Spotify year-locked branch already handles the same
    # "don't fall back to Deezer" intent.
    #
    # IMPORTANT: gate on `eligible_genres` only, NOT `excluded_genre_set`.
    # A user with only NEGATIVE signal (excluded genres, no liked genres —
    # e.g. brand-new user who picked "Country" in the picker only to mark
    # it as a no-go) has no genre to anchor tier 1's search on. Every tier
    # inside the genre-locked branch gates on eligible_genres, so if we
    # entered the branch with eligible_genres=[] all three tiers would
    # skip and the function would return zero tracks ("Warming up the
    # feed" UI state, reported 2026-05-18). Falling back to cold-start
    # in this case at least serves Deezer-chart variety; excluded_genres
    # are imperfectly honored on the chart path (we don't have genre tags
    # for Deezer artists) but a working feed beats an empty one.
    genre_locked = bool(eligible_genres) and not year_range

    sampled_genres: list[str] = []
    if eligible_genres and len(tracks) < limit:
        # Tier 1 widens when genre_locked: k 4→6 (sample more user genres
        # per batch) and per-genre limit 15→20 (draw a larger fraction of
        # each genre's pool). Pool fetch cost is unchanged — search_tracks_
        # by_genre caches the pool per (genre, market, year) and just
        # samples differently per call. Higher k spends one extra cache
        # hit per genre slot; higher limit is free.
        if genre_locked:
            n_pick = min(6, len(eligible_genres))
            per_genre_limit = 20
        else:
            n_pick = min(4, len(eligible_genres))
            per_genre_limit = 15
        position_weights = [0.90 ** i for i in range(len(eligible_genres))]
        sampled_genres = _weighted_sample(eligible_genres, position_weights, k=n_pick)
        genre_results = await asyncio.gather(*[
            spotify.search_tracks_by_genre(
                g,
                limit=per_genre_limit,
                target_popularity=target_popularity,
                market=spotify_market,
                year_range=year_range,
            )
            for g in sampled_genres
        ], return_exceptions=True)
        _flatten_shuffle_add(genre_results, add_personalized)
        logger.info(
            "discover: tier1 (weighted-genre) → %d tracks (sampled=%s, target_pop=%s, profile_size=%d, year_range=%s, neg_genres_filtered=%d, genre_locked=%s)",
            len(tracks) - tier1_added_before, sampled_genres,
            f"{target_popularity:.1f}" if target_popularity is not None else "default",
            len(genre_list),
            year_range or "none",
            len(genre_list) - len(eligible_genres),
            genre_locked,
        )

    if year_range:
        # ── Tier 2 (vintage mode): Spotify year-locked baseline ──────────
        # Deezer doesn't support year-filtered queries — its /chart and
        # /search both return current-era tracks. For a user with a
        # concentrated decade preference, that meant tier 2-4 contributed
        # candidates that could only be re-ranked downward, never
        # filtered out at the source.
        # Substitution: query Spotify with the year_range across a few
        # high-coverage baseline genres. Tier 1 already picks the user's
        # preferred genres with year_range applied; tier 2 here uses
        # genre-agnostic baselines so the user gets era-appropriate
        # popular tracks even when their tier 1 genre choices come up
        # thin. The shared 7-day Redis pool cache absorbs the quota
        # impact — distinct year/genre combos cache independently and
        # are reused across users.
        if len(tracks) < limit:
            baseline_genres = ["pop", "rock", "hip-hop"]
            baseline_results = await asyncio.gather(*[
                spotify.search_tracks_by_genre(
                    g,
                    limit=15,
                    target_popularity=target_popularity,
                    market=spotify_market,
                    year_range=year_range,
                )
                for g in baseline_genres
            ], return_exceptions=True)
            _flatten_shuffle_add(baseline_results, add_baseline)
            logger.info(
                "discover: tier2 (vintage spotify baseline) → %d tracks (year_range=%s, baseline_genres=%s)",
                len(tracks), year_range, baseline_genres,
            )
    elif genre_locked:
        # ── Genre-locked ladder (Spotify-only, no Deezer chart) ──────────
        # User has explicit genre preferences (positive picks or exclusions).
        # The original Deezer chart baseline was the source of "country in
        # my hip-hop feed" leakage: Deezer's /chart/0/tracks is genre-
        # agnostic and returns whatever's mainstream right now (currently
        # country-heavy in the US market). That conflicted with the user
        # explicitly saying they want a specific genre.
        #
        # Replacement: when tier 1 underfills, fall back to MORE Spotify
        # searches in the user's own genre family — not to a different
        # source. Same pool-cache pays for itself within minutes when the
        # site has any concurrent users on the same genres.

        # Tier 2: Spotify search on user genres tier 1 didn't sample.
        # No-op when tier 1 already covered every eligible genre (e.g. user
        # picked just 1-2 genres). When useful, this gives the user breadth
        # across THEIR genre list rather than randomness across charts.
        if len(tracks) < limit:
            unsampled = [g for g in eligible_genres if g not in sampled_genres]
            if unsampled:
                tier2_genres = unsampled[:4]
                tier2_before = len(tracks)
                tier2_results = await asyncio.gather(*[
                    spotify.search_tracks_by_genre(
                        g,
                        limit=20,
                        target_popularity=target_popularity,
                        market=spotify_market,
                    )
                    for g in tier2_genres
                ], return_exceptions=True)
                _flatten_shuffle_add(tier2_results, add_baseline)
                logger.info(
                    "discover: tier2 (genre-locked, unsampled prefs) → %d tracks (genres=%s)",
                    len(tracks) - tier2_before, tier2_genres,
                )

        # (Tier 3 — Spotify year:2020-2024 — was removed after first deploy.
        # It forked the genre pool cache key onto a small year-restricted
        # candidate set, where the existing keyword-stuffing filter's
        # ≥3-non-stuffed safety floor often didn't activate. Result: feeds
        # flooded with tracks literally titled "Hip-Hop" because the
        # filtered pool was <3. Tier 1's widened k=6/limit=20 supplies
        # enough variety alone; for the rare niche-genre case where it
        # doesn't, tier 4 below is the safety net.)

        # Tier 4: Deezer keyword fallback restricted to the user's genre
        # words. Rare — only fires when all Spotify tiers above came up
        # short (niche genres with thin Spotify catalogs). Without this
        # the genre-locked feed could go empty for very-niche prefs.
        #
        # Deezer search is a literal text match, so a query like "hip hop"
        # returns tracks LITERALLY titled "Hip-Hop" / "Hip Hop" / etc.
        # That floods the feed with monotonous-looking results (10 of 18
        # tracks titled the genre word, observed in prod after the first
        # genre-locked deploy). Drop tracks whose title or artist name
        # contains any of the user's genre slugs — mirrors the keyword-
        # stuffing filter that search_tracks_by_genre already applies to
        # Spotify pools internally.
        if len(tracks) < limit and eligible_genres:
            tier4_before = len(tracks)
            fallback_queries = [g.replace("-", " ") for g in eligible_genres[:3]]
            fallback_results = await asyncio.gather(*[
                deezer_svc.search_tracks(q, limit=10)
                for q in fallback_queries
            ], return_exceptions=True)

            # Build the keyword-variant set across ALL of the user's
            # eligible genres (not just the queried ones). A "hip-hop"
            # user with R&B in their list also doesn't want a track
            # titled "R&B" surfaced from Deezer.
            genre_keywords: set[str] = set()
            for g in eligible_genres:
                gl = g.lower().strip()
                genre_keywords.update({gl, gl.replace("-", " "), gl.replace("-", "")})

            def _is_keyword_stuffed(t: dict) -> bool:
                fields = [
                    (t.get("name") or "").lower(),
                    " ".join(t.get("artists") or []).lower(),
                ]
                return any(
                    kw and any(kw in f for f in fields)
                    for kw in genre_keywords
                )

            # Filter EACH per-query result list individually so
                # _flatten_shuffle_add still pools them; an empty list
                # is harmless to the flatten step.
            filtered_fallback = [
                [t for t in res if not _is_keyword_stuffed(t)]
                if isinstance(res, list) else res
                for res in fallback_results
            ]
            _flatten_shuffle_add(filtered_fallback, add_baseline)
            logger.info(
                "discover: tier4 (genre-locked, deezer keyword fallback) → %d tracks (queries=%s)",
                len(tracks) - tier4_before, fallback_queries,
            )
    else:
        # ── Cold-start ladder (no genre prefs set) ──────────────────────
        # User hasn't told us what they like; serve mainstream variety from
        # Deezer while their taste profile builds via ratings.

        # ── Tier 2: Deezer chart baseline ────────────────────────────────────────
        # Uses Deezer's /chart/0/tracks endpoint (actual chart data) instead of
        # searching text like "top hits" which was matching a karaoke artist of
        # the same name and flooding the feed with cover tracks.
        #
        # Bumped from 50 → 100 to give cold-start users a wider pool. With 50 a
        # user could exhaust the chart in ~5 batches and then start seeing the
        # same tracks recur (or fall through to weaker tier-3 results). 100 is
        # the practical max Deezer's chart endpoint serves; doubling the pool
        # doubles the time until exhaustion. Same Akamai-signed-URL TTL applies.
        if len(tracks) < limit:
            chart_tracks = await deezer_svc.get_chart_tracks(limit=100)
            if isinstance(chart_tracks, list):
                random.shuffle(chart_tracks)
                add_baseline(chart_tracks)
            logger.info("discover: tier2 (deezer chart) → %d tracks", len(tracks))

        # ── Tier 3: Deezer new music ──────────────────────────────────────────────
        if len(tracks) < limit:
            new_results = await asyncio.gather(*[
                deezer_svc.search_tracks(q, limit=15)
                for q in _DEEZER_NEW_QUERIES
            ], return_exceptions=True)
            _flatten_shuffle_add(new_results, add_baseline)

        # ── Tier 4: Deezer keyword fallbacks — always produces results ────────────
        if len(tracks) < limit:
            fallback_results = await asyncio.gather(*[
                deezer_svc.search_tracks(q, limit=10)
                for q in _DEEZER_FALLBACK_QUERIES
            ], return_exceptions=True)
            _flatten_shuffle_add(fallback_results, add_baseline)

    # ── Tier 4.5: Nuclear fallback — ignore even hard dislikes ───────────────
    # Only triggers when every tier above produced zero. Keeps the feed alive
    # if upstreams are down rather than showing an empty page.
    if not tracks and disliked_set:
        logger.info("discover: nuclear fallback — ignoring disliked filter (%d artists)", len(disliked_set))
        nuclear = await deezer_svc.get_chart_tracks(limit=50)
        for t in nuclear:
            if t.get("id") and t["id"] not in exclude_ids and t["id"] not in seen:
                seen.add(t["id"])
                tracks.append(t)
            if len(tracks) >= limit:
                break

    # Compact preference summary for the log: "1980s:65%,1990s:20%" etc.
    # Only the top three contribute; "none" when no preference signal.
    def _pref_summary(pref: Optional[dict[str, float]]) -> str:
        if not pref:
            return "none"
        return ",".join(
            f"{k}:{int(v * 100)}%"
            for k, v in sorted(pref.items(), key=lambda kv: kv[1], reverse=True)[:3]
        )

    logger.info(
        "discover: returning %d tracks (rated_excluded=%d, seeds=%d, dislikes=%d, down_weighted=%d, excluded_genres=%d, covers_filtered=%d, target_pop=%s, decade_pref=%s, neg_decade=%s, neg_genres=%s, year_range=%s, genres=%s)",
        len(tracks), len(exclude_ids), len(seed_artist_ids),
        len(disliked_set), len(down_weighted_set), len(excluded_genre_set),
        covers_filtered,
        f"{target_popularity:.1f}" if target_popularity is not None else "default",
        _pref_summary(decade_pref),
        _pref_summary(negative_decade_pref),
        _pref_summary(negative_genre_pref),
        year_range or "none",
        genre_list[:2],
    )

    if not tracks:
        logger.error("discover: all tiers failed — returning empty feed")
        return []

    # Preserve tier order — tier 1 (personalized weighted-genre) first,
    # tier 2 (Deezer chart baseline) and beyond last. Within each tier
    # _flatten_shuffle_add has already shuffled to keep genres/queries
    # from clustering.
    # An earlier random.shuffle(result) here was clobbering this and
    # routinely surfacing generic chart hits above tier-1 personalized
    # results — i.e. the user got the algorithm's worst guesses first.
    result = tracks[:limit]

    # ── Deezer preview enrichment (Spotify tracks only) ───────────────────────
    # Deezer-sourced tracks already carry preview_url from the search response.
    # Only enrich Spotify tracks that are still missing a preview clip.
    no_preview = [t for t in result if not t.get("preview_url") and t.get("_source") != "deezer"]
    if no_preview:
        import logging as _logging
        _log = _logging.getLogger(__name__)
        deezer_tasks = [
            deezer_svc.get_preview(t.get("name", ""), (t.get("artists") or [""])[0])
            for t in no_preview
        ]
        deezer_urls = await asyncio.gather(*deezer_tasks, return_exceptions=True)
        url_iter = iter(deezer_urls)
        filled = 0
        for t in result:
            if not t.get("preview_url") and t.get("_source") != "deezer":
                url = next(url_iter)
                if isinstance(url, str) and url:
                    t["preview_url"] = url
                    filled += 1
        _log.info(
            "[discover] Deezer preview enrichment: %d/%d Spotify tracks filled",
            filled, len(no_preview),
        )

    # Visibility: log the final preview coverage so we can see at a glance how
    # many cards in this batch will get the custom HTML5 audio player vs the
    # Spotify iframe fallback (the latter is buggier in WKWebView).
    if result:
        import logging as _logging
        _log = _logging.getLogger(__name__)
        with_preview = sum(1 for t in result if t.get("preview_url"))
        _log.info(
            "[discover] /feed served %d tracks, %d with preview_url (%d will use iframe fallback)",
            len(result), with_preview, len(result) - with_preview,
        )

    return result


@router.get("/debug")
async def discover_debug():
    """
    Diagnostic endpoint — tests each feed tier independently and reports
    how many tracks each produced.  Use this to diagnose empty feed issues
    without having to read through logs.
    """
    import time
    import httpx
    from services import spotify as spotify_svc

    results: dict[str, dict] = {}

    # ── Spotify token ─────────────────────────────────────────────────────────
    try:
        t0 = time.monotonic()
        async with httpx.AsyncClient() as client:
            await spotify_svc._get_token(client)
        results["spotify_auth"] = {"ok": True, "latency_ms": round((time.monotonic() - t0) * 1000)}
    except Exception as exc:
        results["spotify_auth"] = {"ok": False, "error": str(exc)}

    # ── Tier 1: seed-artist genre pivot probe ────────────────────────────────
    # Tests the live tier-1 path: fetch a known artist's genres, then verify
    # a genre search returns tracks. /related-artists is no longer in the
    # ladder (Spotify deprecated it).
    try:
        t0 = time.monotonic()
        meta = await spotify_svc.get_artist("06HL4z0CvFAxyc27GXpf02")  # Taylor Swift
        genres = meta.get("genres") or []
        sample_tracks = await spotify.search_tracks_by_genre(genres[0], limit=5) if genres else []
        results["tier1_seed_genre"] = {
            "ok": True,
            "artist_genres": genres[:3],
            "sample_track_count": len(sample_tracks),
            "latency_ms": round((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:
        results["tier1_seed_genre"] = {"ok": False, "error": str(exc)}

    # ── Tier 3: Deezer popular search ────────────────────────────────────────
    try:
        t0 = time.monotonic()
        deezer_pop = await deezer_svc.search_tracks("top hits", limit=10)
        results["tier3_deezer_popular"] = {
            "ok": True,
            "track_count": len(deezer_pop),
            "with_preview": sum(1 for t in deezer_pop if t.get("preview_url")),
            "latency_ms": round((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:
        results["tier3_deezer_popular"] = {"ok": False, "error": str(exc)}

    # ── Tier 4: Deezer new music ──────────────────────────────────────────────
    try:
        t0 = time.monotonic()
        deezer_new = await deezer_svc.search_tracks("new music 2025", limit=10)
        results["tier4_deezer_new"] = {
            "ok": True,
            "track_count": len(deezer_new),
            "latency_ms": round((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:
        results["tier4_deezer_new"] = {"ok": False, "error": str(exc)}

    # ── Tier 2: Genre search (sample) ────────────────────────────────────────
    try:
        t0 = time.monotonic()
        genre_tracks = await spotify.search_tracks_by_genre("pop", limit=10)
        results["tier2_genre_search"] = {
            "ok": True,
            "track_count": len(genre_tracks),
            "latency_ms": round((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:
        results["tier2_genre_search"] = {"ok": False, "error": str(exc)}

    # ── Redis cache ───────────────────────────────────────────────────────────
    try:
        from services import redis_cache
        r = await redis_cache._client()
        if r is not None:
            t0 = time.monotonic()
            await r.ping()
            results["redis"] = {"ok": True, "latency_ms": round((time.monotonic() - t0) * 1000)}
        else:
            results["redis"] = {"ok": False, "note": "not configured — every feed request hits Spotify directly"}
    except Exception as exc:
        results["redis"] = {"ok": False, "error": str(exc)}

    all_ok = all(v.get("ok", False) for v in results.values() if "note" not in v)
    return {"status": "ok" if all_ok else "degraded", "tiers": results}


@router.get("/catalog-stats")
async def catalog_stats(db: AsyncSession = Depends(get_db)):
    """
    Snapshot of what's in our local catalog (TrackCache + ArtistCache + AlbumCache).

    Read-only audit endpoint — the foundation for the catalog-pivot work. The
    long-term goal is to serve the For You feed from local SQL queries against
    these tables rather than text-searching Spotify on every request; this
    endpoint tells us how far we are from that being viable. A catalog with
    ~10k tracks across diverse genres + popularity levels is roughly the
    threshold where DB-served feed batches start matching the variety of
    live-search batches.

    The popularity distribution is the most-watched number — the For You
    weighted-sampling curve needs candidates across the full 0–100 range to
    have anything to sample from. A catalog that's all popularity-80+ would
    serve every niche-leaning user (target_pop=25) zero good matches.

    Genre frequency comes from ArtistCache.genres. We don't have track-level
    genre tags (Spotify doesn't expose them on tracks; we infer from artist),
    so "the catalog has 200 hip-hop tracks" is really "the catalog has tracks
    by 50 artists tagged hip-hop." That's the same logic the For You feed uses.

    Caveat: top_genres scans up to 5000 ArtistCache rows and aggregates in
    Python. Plenty for the current catalog size; if ArtistCache ever grows
    past low-thousands, switch to DB-native JSON aggregation.
    """
    # ── TrackCache ────────────────────────────────────────────────────────────
    total_tracks = await db.scalar(select(func.count()).select_from(TrackCache)) or 0
    tracks_with_popularity = await db.scalar(
        select(func.count()).select_from(TrackCache).where(TrackCache.popularity.is_not(None))
    ) or 0
    tracks_with_artist_ids = await db.scalar(
        select(func.count()).select_from(TrackCache).where(TrackCache.artist_ids_json.is_not(None))
    ) or 0
    tracks_with_image = await db.scalar(
        select(func.count()).select_from(TrackCache).where(TrackCache.image_url.is_not(None))
    ) or 0

    # Popularity buckets — same edges as the algorithm uses to reason about
    # "mainstream vs niche" so the stats line up with the weighting code.
    popularity_buckets: dict[str, int] = {}
    for lo, hi in [(0, 19), (20, 39), (40, 59), (60, 79), (80, 100)]:
        n = await db.scalar(
            select(func.count()).select_from(TrackCache).where(
                TrackCache.popularity >= lo,
                TrackCache.popularity <= hi,
            )
        )
        popularity_buckets[f"{lo}-{hi}"] = n or 0

    # Percentiles via sorted scan — fine at current catalog size, may need
    # a DB-native percentile_cont() switch if TrackCache passes ~100k rows.
    pops = (await db.execute(
        select(TrackCache.popularity)
        .where(TrackCache.popularity.is_not(None))
        .order_by(TrackCache.popularity)
    )).scalars().all()

    def _pct(p: float):
        if not pops:
            return None
        idx = max(0, min(len(pops) - 1, int(len(pops) * p)))
        return pops[idx]

    # ── ArtistCache ───────────────────────────────────────────────────────────
    total_artists = await db.scalar(select(func.count()).select_from(ArtistCache)) or 0
    artists_with_genres = await db.scalar(
        select(func.count()).select_from(ArtistCache).where(ArtistCache.genres.is_not(None))
    ) or 0

    # Top-genres aggregation — parse JSON in Python rather than DB-native
    # because we run on SQLite locally and Postgres in prod, and json_each /
    # jsonb_array_elements_text differ between them.
    from collections import Counter
    genres_rows = (await db.execute(
        select(ArtistCache.genres).where(ArtistCache.genres.is_not(None)).limit(5000)
    )).scalars().all()
    genre_counter: Counter[str] = Counter()
    for g_json in genres_rows:
        try:
            for g in json.loads(g_json or "[]"):
                if g:
                    genre_counter[g] += 1
        except Exception:
            continue
    top_genres = [{"genre": g, "count": c} for g, c in genre_counter.most_common(20)]

    # ── AlbumCache (context) ──────────────────────────────────────────────────
    total_albums = await db.scalar(select(func.count()).select_from(AlbumCache)) or 0

    # ── Ratings (context — drives the target_popularity per-user signal) ──────
    total_track_ratings = await db.scalar(
        select(func.count()).select_from(Rating).where(Rating.entity_type == "track")
    ) or 0
    high_track_ratings = await db.scalar(
        select(func.count()).select_from(Rating).where(
            Rating.entity_type == "track",
            Rating.value >= 4.0,
        )
    ) or 0

    return {
        "tracks": {
            "total": total_tracks,
            "with_popularity": tracks_with_popularity,
            "with_artist_ids": tracks_with_artist_ids,
            "with_image": tracks_with_image,
            "popularity_buckets": popularity_buckets,
            "popularity_percentiles": {
                "p10": _pct(0.10),
                "p25": _pct(0.25),
                "p50": _pct(0.50),
                "p75": _pct(0.75),
                "p90": _pct(0.90),
            },
        },
        "artists": {
            "total": total_artists,
            "with_genres": artists_with_genres,
            "top_genres": top_genres,
            "unique_genres_seen": len(genre_counter),
        },
        "albums": {
            "total": total_albums,
        },
        "ratings_context": {
            "total_track_ratings": total_track_ratings,
            "high_rated_4_plus": high_track_ratings,
        },
    }
