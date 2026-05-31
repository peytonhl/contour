# Auth / Guest Boundary — Diagnostic (Work Item 5)

**Status: report only. No auth behavior was changed by this work.**
Date: 2026-05-30. Author: onboarding-rework session.

This maps exactly what a guest (not signed in) can reach today, confirms how
close the spec's "guest seeds → previews a feed → signs up to act" flow is to
current behavior, and names what (if anything) blocks it.

---

## 1. How "guest" is determined

- **Auth state** lives in `frontend/src/contexts/AuthContext.jsx`. A user is
  signed in iff `localStorage["contour_token"]` is present and `/auth/me`
  resolves. No token → `user === null`.
- **Guest mode is an explicit opt-in.** `frontend/src/components/SigninGate.jsx`
  blocks the whole app UI until the visitor either signs in OR clicks
  **"Browse without signing in"**, which sets `localStorage["contour_guest_mode"]="1"`
  and fires a `contour:guest-mode-changed` event. Until one of those happens,
  the gate is up.
- **Backend auth dependencies** come in three flavors:
  - `optional_user_id` — endpoint works with or without a token; personalizes
    if present.
  - `require_user_id` — 401 without a token.
  - no dependency — fully public.

---

## 2. What a guest CAN reach today

| Surface | Guest access | Backend auth | Notes |
|---|---|---|---|
| **Discover / For You feed** | ✅ Full | `/discover/feed` = `optional_user_id` | Guest gets cold-start ladder; client params (`genres`, `disliked_artists`, now `seed_artists`) are honored. **This is the surface the rework's guest preview rides on.** |
| **Gear panel: browse-by-genre, language, reset feed, not-interested** | ✅ Full | client-side localStorage + `optional_user_id` | All feed-shaping controls already work for guests. |
| **Artist seed preview (NEW)** | ✅ Full | `optional_user_id` honors `seed_artists` | Shipped this session — verified live: guest picks Carti → feed returns Carti + Ken Carson / Don Toliver / Trippie Redd. |
| **User profiles** | ✅ Read | `/users/{id}` = `optional_user_id` | `is_following` only set when signed in. |
| **Community reviews / global feed** | ✅ Read | `optional_user_id` | Can read, cannot vote. |
| **Leaderboard / charts** | ✅ Read | no auth | Fully public. |
| **Search (users/albums/tracks)** | ✅ Read | `optional_user_id` | Public. |
| **Album / track / artist pages** | ✅ Read | `optional_user_id` | Metadata, trajectories, era stats all visible. |
| **Half-star rating selector** | ✅ Preview only | — | Guest sees + can hover the selector; first click triggers sign-in (commit `3ab9c60`). |

## 3. What a guest CANNOT do (forces signup)

| Action | Backend | Behavior |
|---|---|---|
| Submit a rating | `POST /ratings/{type}/{id}/rate` = `require_user_id` | 401 "Sign in to rate". Frontend intercepts the star click → clears guest mode → SigninGate re-appears. |
| Write a review | `require_user_id` | 401 "Sign in to leave a review". |
| Vote on a review | `require_user_id` | 401. |
| Follow a user | `require_user_id` | 401. |
| Backlog / save-to-listen | `require_user_id` | 401. |
| Notifications | `require_user_id` | 401. |
| Taste profile / settings / `/taste/profile` save | `require_user_id` | 401. |

---

## 4. Is the spec's guest-first preview flow far from current behavior?

**No — it is essentially already the behavior, and the rework completed the
missing piece.** The spec asks for: guest opens app → picks artists → sees a
seeded preview feed → signup prompt appears at the natural moment (when they
try to act).

- **"Guest sees a feed"** — already true. `/discover/feed` is `optional_user_id`
  and the guest can reach it the moment they pass the gate.
- **"Seeded by artists they love"** — this was the only genuinely missing
  capability, and it is now shipped: `seed_artists` is honored for guests, the
  onboarding artist step runs for guests, and picks persist to
  `contour_seed_artists_v1` (client-only, no account needed). Verified live.
- **"Signup at the natural moment (when they act)"** — already true and
  unchanged. The rating selector is the natural trip-wire: guest can preview
  the half-star UI, and the first real click routes to sign-in via
  `clearGuestMode()` → SigninGate. The rework deliberately added **no** new
  signup wall.
- **"No guest-data persistence/migration"** — satisfied by construction. The
  seed lives in localStorage and is read straight into the feed request; nothing
  is written server-side for a guest, so there is nothing to migrate when they
  later sign in. Their seed simply continues to apply (and then decays as they
  rate, post-signup).

## 5. What blocks it / friction points (for your decision — not changed here)

1. **The SigninGate still stands in front of everything on first launch.** A
   brand-new visitor must click "Browse without signing in" *before* they can
   see the onboarding or any feed. The rework's onboarding correctly waits for
   that flip (`contour:guest-mode-changed`), but the gate itself is the first
   thing a Reddit stranger hits — the very "ask before value" pattern the
   rework set out to reverse, just relocated one screen earlier. **If you want
   the artist picker to be the literal first screen, the gate's
   default-blocking posture is the thing to revisit.** Out of scope per WI5
   ("do not change auth behavior") — flagging for your call.
2. **Guest seed does not survive a hard cache wipe** (localStorage only). Fine
   for a single session; a guest who clears storage loses their preview seed.
   Acceptable given "no persistence" was an explicit spec choice.
3. **No guest analytics identity.** PostHog uses `person_profiles:
   "identified_only"`, so guest preview behavior is captured as anonymous
   events. The new `onboarding_seeded` event fires for guests but won't tie to
   a person until they sign in. Funnel analysis (artist-seeded vs genre-seeded
   conversion) works at the event level; per-person guest→signup stitching
   would need an `identify()` alias at signup time. Flagging, not changing.

**Recommendation for your decision:** the guest-first seeded-preview flow is
live and working. The single highest-leverage *auth* change you could consider
next is item (1) — making the gate non-blocking so the artist picker is truly
the first thing a stranger sees. That is a deliberate auth-behavior change and
is left entirely to you.
