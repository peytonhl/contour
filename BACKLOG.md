# Contour — Product Backlog

Captures the product roadmap from the 2026-05-14 product review pass.
Living doc — close items as they ship, add new ones as decisions land.
Big picture: ship retention / activation hooks the existing rate-and-review
loop is missing.

---

## In flight (this session)

| # | Feature | Notes |
|---|---|---|
| 1 | Edit / delete your own review, with `(edited)` marker | Edit-text already works via POST upsert. Missing: DELETE endpoint, `updated_at` in API response, edited marker in UI, explicit "Delete review" button. |
| 2 | Bottom nav restructure: add **Friends** tab, fold **Charts** into Search as tabs | Friends tab initially routes to the existing For You "Friends" sub-tab content (recommended-users list is a follow-up). Search page becomes tabbed: Search / Trending / Charts. Remove `/charts` from desktop top nav. |
| 3 | `/settings` page consolidating scattered settings | Moves the gear-menu items + `/blocks`, `/import`, `/methodology` into one settings page. See "Settings contents" below. |

---

## Queued — agreed, not yet started

### Onboarding rebuild
- Drop the genre picker step from `OnboardingModal.jsx`
- Replace with a "Rate 5 songs to calibrate your taste" progress bar that
  appears at the top of the For You feed for new accounts until they hit 5
  rated tracks. Disappears at 5.
- Backend already auto-populates `UserTasteProfile.genres` from
  artist Spotify genres on every 4–5★ rating, so the calibration bar maps
  directly to actual signal collection (no extra plumbing).

### Continuous taste re-calibration
- Today: taste profile updates immediately on each 4–5★ / 1–2★ rating.
- Add: every 5 ratings, also re-fetch the user's For You feed cache so the
  next batch reflects the latest taste (vs. waiting for natural scroll-off).
  Probably an "invalidate feed cache" trigger inside `_update_taste_from_rating`
  in `routers/ratings.py`.

### Recommended users (Friends tab population)
- New backend endpoint: `GET /users/recommended`
- Ranking: taste similarity (Jaccard or cosine on `liked_artist_ids` +
  `genres`) × recent activity (ratings in last 30 days)
- Excludes: users already followed, blocked users, self
- Frontend: empty-state for the Friends tab when the user follows 0 people —
  show 5–10 recommended users with one-tap follow.

### Push notifications (mobile-first, web push later)
- Trigger types:
  - Reply to your review (top-level or nested)
  - New follower
  - Your review hits 5 total upvotes (gross)
  - Your review hits 5 total downvotes (gross)
- Threshold notifications fire once per threshold, tracked via a new
  `NotificationMilestone` table or by querying live counts at write time.
- Requires Capacitor `@capacitor/push-notifications` plugin → IPA rebuild.
- See "Peyton todos" below for the credentials/store work that goes with this.

### Shareable cards (v1: three card types) — **shipped**

**Design direction (Peyton, 2026-05-15):** treat each card like a famous-
quote postcard (think the John Quincy Adams meme template) — editorial,
serif-heavy, the user's review reads as a quote with attribution. The
visual anchor is the album cover (the subject of the quote), not the
user's face. Same dark `#08080a` background and Instrument Serif type
as the app — no gradients, no busy backgrounds.

**Renderer + cover preference (decided 2026-05-15):** Vercel OG Edge
Function at `frontend/api/og/review.jsx`. Cover URL preference: Apple
Music's 1200×1200 art (`AppleMusicLink.artwork_url` when cached) over
Spotify's 640 cap, falling back to a dark placeholder block when neither
is available. The endpoint hits a backend `card-data` route that wraps
the lookup so the renderer needs exactly one network round-trip.

**Cross-platform rollout — Android is not left behind:** The OG endpoint
is just an HTTP route returning a PNG; iOS, Android, web, and Capacitor
WebViews on both platforms all consume it identically. The share button
uses `navigator.share({ files: [...] })` (Web Share Level 2), supported
on:
- iOS Safari + WKWebView (14.3+)
- Android Chrome (89+) + Capacitor Android WebView
- Older Android falls back to URL share via the same handler — graceful
  degradation, no broken-feature state.

No native plugin or Capacitor capability change is required, so this
feature ships to Android users via the same Vercel deploy that ships
it to iOS users (and to the web). **No Codemagic rebuild, no APK
rebuild, no app-store review wait** — both shells pick up the new
share behavior on next launch because they load the live web app
from Vercel.

If later we want a richer Android-specific path (download-to-photos
button via `@capacitor/share`, sharing to Instagram Story's open
graph endpoint, etc.) that's an incremental layer on top of this v1.

1. **Review card** — small Contour wordmark top, album/track cover on
   the left, the review body as a big Instrument Serif quote on the
   right with curly `"…"` smart quotes, ★ rating in the bottom corner,
   and `— [display name] [tiny avatar]` attribution beneath. Aspect
   ratio: 4:5 portrait (1080×1350) so it fits Instagram feed and IG
   Story cropping. Review text truncates ~220 chars with ellipsis so
   the typography stays generous.
2. **Comparison card** — side-by-side album covers + era-adjusted score
   + verdict. *Only card that markets the era-adjustment differentiator,
   strategically important to ship alongside the review card.* Same
   editorial-quote vocabulary applied to a "vs." layout.
3. **Hot take card** — one of your ratings that diverges most from the
   community average (e.g. you gave 1.5★ to a 4★ community-darling, or
   5★ to something under-rated). Needs a "divergence" query — cheap.
   The quote here is something programmatic like *"My 1.5★ on
   [Album]"* over the community's 4.2★ — leans into the contrarian
   identity-expression angle.
- Implementation: probably Vercel OG image-render endpoint, or a server-side
  Playwright/Satori render. Either way: shareable URL + downloadable PNG.

---

## Queued — lower priority

- **Weekly digest email** — "your week on Contour" + 5 picks based on taste.
  Needs email service (SendGrid / Resend). Reaches users not on iOS push.
- **Friends activity feed surface (real page, not sub-tab)** — once the
  Friends bottom-nav tab exists, upgrade it from "redirects to For You's
  Friends sub-tab" to a dedicated activity surface with rich rendering.
- **Settings: notification preferences** — per-type toggles (follow / reply
  / vote-milestone / push / email). Backend needs a `UserNotificationPrefs`
  table. Pair with the push notifications roll-out.

---

## Explicit cuts / out of scope

These came up in product review and were considered but **rejected** so we
don't pick them up again by accident:

- **Genre picker in onboarding** — being replaced with "rate 5 to calibrate"
- **Era-adjusted differentiator features** — including "modern equivalence",
  era classifier, era movers, etc. Parked. Re-open if the rate-and-share loop
  is solid and we need a new growth lever.
- **Personal stats dashboard** (`/stats` page with top artists, avg rating,
  etc.) — not now
- **Reviews with embedded images / rich media** — not now
- **Moving the notifications bell to the bottom nav** — bell already
  exists at the top of the mobile header (line 287 of Layout.jsx). Stays
  where it is.

---

## Settings page contents (decided 2026-05-14)

Most of this already exists in scattered places. The work is mostly
consolidation, not net-new.

| Section | Items |
|---|---|
| Account | Linked accounts (Google/Apple), delete account, sign out |
| Profile | Edit avatar, bio, display name (link out to profile inline editors) |
| Privacy | Blocked users (link to `/blocks`), disliked artists (link to `/disliked-artists`) |
| Feed | `english_only` toggle, Spanish-market toggle, hide explicit |
| Imports | RYM CSV (link to `/import`) |
| About | How it works (link to `/methodology`), Privacy Policy, app version |
| Notifications *(deferred)* | Per-type toggles — ships with push notifications |

---

## Peyton todos (things Claude can't do)

Required for the push notifications feature in particular. Until these
are done, the backend dispatcher can be built but no notifications will
actually deliver.

- [ ] **Apple Push Notifications**: create APNs key in Apple Developer
      console, capture `APNS_KEY_ID` + `APNS_TEAM_ID` + the `.p8` file
- [ ] **Firebase Cloud Messaging** (for Android + web push): create FCM
      project, capture `FCM_SERVER_KEY`
- [ ] **Railway env vars**: add `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`
      (base64-encoded contents of the .p8), `FCM_SERVER_KEY`
- [ ] **Capacitor**: after Claude installs `@capacitor/push-notifications`
      and adds the iOS push capability to `Info.plist`, tag `ios-v*` to
      trigger Codemagic rebuild
- [ ] **TestFlight**: submit the new build for TestFlight review
- [ ] *(deferred until email digests)* Pick email provider (Resend or
      SendGrid) + capture API key as `EMAIL_API_KEY` env var

---

## Source

Product review pass on 2026-05-14, captured in conversation between Peyton
and Claude. Original critique focused on retention (no reason to return
tomorrow, social loop built but invisible), identity expression (no
shareable artifact), and activation (hollow post-onboarding moment).
