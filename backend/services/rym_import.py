"""RYM (Rate Your Music) CSV import — parse rows, match albums on Spotify.

RYM's user-data export ("Export your data" in the account settings) is a CSV
with the columns below (header row always present, comma-delimited, UTF-8):

    RYM Album, First Name, Last Name, First Name localized, Last Name localized,
    Title, Release_Date, Rating, Ownership, Purchase Date, Media, Review,
    Catalog#, Last Modified

`Rating` is a 0–10 integer where 0 means unrated and 1–10 maps to half-star
increments (1 = ½★, 2 = 1★ … 10 = 5★). We divide by 2 to get Contour's
0.5–5.0 scale and skip rows with rating == 0.

`First Name` may be empty for one-name acts (Beyoncé, Madonna) — those go
under `Last Name`. We concatenate both with a space to form the artist query.
"""

from __future__ import annotations

import csv
import io
import logging
import re
from typing import Optional

from services import spotify

logger = logging.getLogger(__name__)

# Hard cap on rows per import to keep Spotify quota predictable and to avoid
# blocking the request handler for minutes. RYM exports are typically <1000
# rows; users with bigger libraries can split the file.
MAX_ROWS = 2000

VALID_RATINGS = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10}


def _norm(s: str) -> str:
    """Lowercase + strip punctuation for fuzzy artist/title matching."""
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def parse_rym_csv(raw: bytes) -> list[dict]:
    """Decode raw bytes → list of {title, artist, rating, review, release_year}.

    Only includes rows with a non-zero rating; other rows are silently skipped.
    Returns at most MAX_ROWS rows.
    """
    # RYM exports as UTF-8. Some browsers re-save as latin-1 — accept either.
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict] = []
    for raw_row in reader:
        if len(rows) >= MAX_ROWS:
            break
        # Header names are case-sensitive in RYM exports. Skip rows missing fields.
        title = (raw_row.get("Title") or "").strip()
        first = (raw_row.get("First Name") or "").strip()
        last = (raw_row.get("Last Name") or "").strip()
        rating_raw = (raw_row.get("Rating") or "").strip()
        if not title or not (first or last) or not rating_raw:
            continue
        try:
            rating_int = int(rating_raw)
        except ValueError:
            continue
        if rating_int not in VALID_RATINGS:
            continue  # 0 = unrated, anything else outside 1..10 is malformed

        artist = (first + " " + last).strip()
        release_year: Optional[str] = None
        rel_raw = (raw_row.get("Release_Date") or "").strip()
        # RYM format examples: "2012-08-21", "2012", "May 2012"
        m = re.search(r"\b(19|20)\d{2}\b", rel_raw)
        if m:
            release_year = m.group(0)

        rows.append({
            "title": title,
            "artist": artist,
            "rating": rating_int / 2.0,  # 1..10 → 0.5..5.0
            "review": (raw_row.get("Review") or "").strip() or None,
            "release_year": release_year,
        })
    return rows


def _score_match(row: dict, candidate: dict) -> float:
    """Higher = better match. Returns 0 if it's clearly not the same album."""
    row_title = _norm(row["title"])
    row_artist = _norm(row["artist"])
    cand_title = _norm(candidate.get("name", ""))
    cand_artists = [_norm(a) for a in candidate.get("artists", [])]

    if not row_title or not cand_title:
        return 0.0

    # Title must overlap substantially. Exact match → 1.0, prefix match → 0.7,
    # substring → 0.5, otherwise 0.
    if row_title == cand_title:
        title_score = 1.0
    elif cand_title.startswith(row_title) or row_title.startswith(cand_title):
        title_score = 0.7
    elif row_title in cand_title or cand_title in row_title:
        title_score = 0.5
    else:
        return 0.0

    # Artist match (any of the credited artists is enough — collabs are common).
    artist_score = 0.0
    for ca in cand_artists:
        if ca == row_artist:
            artist_score = 1.0; break
        if ca and (ca in row_artist or row_artist in ca):
            artist_score = max(artist_score, 0.6)
    if artist_score == 0.0:
        return 0.0

    # Tiny bonus if release year lines up — disambiguates re-releases.
    year_bonus = 0.0
    if row.get("release_year"):
        cand_year = (candidate.get("release_date") or "")[:4]
        if cand_year == row["release_year"]:
            year_bonus = 0.1

    return title_score + artist_score + year_bonus


async def match_album(row: dict) -> Optional[dict]:
    """Search Spotify for the album described by a parsed CSV row.

    Returns the best-scoring candidate dict (`_parse_album` shape) or None if
    no candidate clears a minimum confidence threshold.
    """
    query = f"{row['title']} {row['artist']}"
    try:
        candidates = await spotify.search_albums(query, limit=5)
    except Exception as exc:
        logger.warning("RYM match: spotify search failed for %r — %s", query, exc)
        return None

    best = None
    best_score = 0.0
    for c in candidates:
        s = _score_match(row, c)
        if s > best_score:
            best = c
            best_score = s

    # Require both a title hit and an artist hit (sum ≥ 1.2 implies at least
    # title 0.5 + artist 0.6, or a stronger combination). Empirically this
    # rejects most cross-artist false positives while accepting deluxe / remasters.
    return best if best_score >= 1.2 else None
