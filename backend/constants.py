"""Shared backend constants — values referenced from multiple modules.

Keep this file small and dependency-free. It must NOT import anything
from the app itself (routers/, services/, models, database) — that's an
import-cycle trap. Stdlib only.

Adding a constant here is appropriate when: (a) the same literal exists
in two or more files, AND (b) changing it ought to be a single-place
edit. Per-module thresholds that are unique to one file should stay
local to that file — moving them here would just add indirection.
"""

# ── Rating scale ──────────────────────────────────────────────────────────────
# User ratings are half-stars on a 0.5..5.0 scale. Pydantic validators in
# routers/ratings.py (RatingIn, ReviewIn) and routers/backlog.py
# (PromoteIn) all reject anything outside VALID_RATING_VALUES. The
# floats here MUST match what Pydantic sees from incoming JSON — JSON
# numbers parse as floats in Python, so the set of acceptable values is
# the float values 0.5, 1.0, ..., 5.0 (not the Decimals or ints).
MIN_RATING = 0.5
MAX_RATING = 5.0
RATING_STEP = 0.5
VALID_RATING_VALUES = frozenset({0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0})

# ── Rating-signal thresholds (personalization engine) ─────────────────────────
# Map a user's individual rating to a preference signal:
#
#   value >= HIGH_RATING_THRESHOLD  →  "liked"
#       - routers/ratings.py: append artist to liked_artist_ids on track rate
#       - routers/discover.py: count toward high_track_ratings in /me-state,
#         used for cold-start genre inference, popularity-bucket calibration,
#         and the top-rated catalog Tier 0 query
#       - routers/users.py: top-rated items feed the user's top-genres list
#       - routers/admin.py: powers the admin top-rated query
#
#   value <= LOW_RATING_THRESHOLD   →  "disliked"
#       - routers/ratings.py: append artist to down_weighted_artist_ids
#       - routers/discover.py: count toward low_track_ratings in /me-state,
#         used for negative-genre inference (three-state demote-not-block
#         model — see PERSONALIZATION_ARCHITECTURE.md)
#
# Tied to the half-star UX: 4★ reads as "I liked this", 2★ as "I didn't".
# Bumping either threshold is a personalization-tuning decision with
# cross-cutting effects across the call graph — sweep both
# routers/discover.py and routers/ratings.py before changing.
#
# Comparison style note: some legacy callsites wrote `>= 4` (int) instead
# of `>= 4.0` (float). Python coerces fine for Rating.value (which is
# float), but using the named constant unifies the style.
HIGH_RATING_THRESHOLD = 4.0
LOW_RATING_THRESHOLD = 2.0
