# Contour — Claude Code Context

Read this before doing any work. It covers the full architecture, conventions,
and rules that apply to every task.

---

## What this app is

Contour is a music ratings, reviews, and streaming analytics platform.
Tagline: **"Rate. Review. Discover."**

Core features:
- **Rate & review** albums, tracks, and artists (half-star, 0.5–5.0) — think Letterboxd for music
- **Era-adjusted streaming**: a 2012 album's streams are normalized against Spotify's MAU
  at release time, so old and new releases can be compared fairly
- **Charts**: albums ranked by Era Score (era-adjusted stream count)
- **For You feed**: TikTok-style personalized track discovery that learns from ratings —
  rate ~10 tracks and the feed adapts to your taste in real time
- **Comparison**: side-by-side streaming trajectory charts for any two albums/tracks
- **Social**: follow users, see their ratings and reviews in a feed

Live at: https://contour-rosy.vercel.app  
Backend: https://contour-production.up.railway.app  
Health check: https://contour-production.up.railway.app/health

Service inventory, monthly monitoring checklist, and the runbook for changing
domains: see [OPERATIONS.md](OPERATIONS.md).

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite, React Router v7, Recharts |
| Backend | Python 3.12 / FastAPI, SQLAlchemy async |
| Database | PostgreSQL on Railway (SQLite locally) |
| Cache | Redis on Railway (optional — app degrades gracefully without it) |
| Auth | Google OAuth 2.0 + JWT |
| Data sources | Spotify Web API, Last.fm API, Kworb.net (artist pages only), Wayback Machine, Deezer |
| Hosting | Vercel (frontend) · Railway (backend + DB + Redis) |

---

## Repo layout

```
backend/
  main.py                  FastAPI app entry point, startup tasks, /health endpoint
  models.py                SQLAlchemy ORM models
  database.py              Async engine (SQLite locally, Postgres in prod)
  routers/
    auth.py                Google OAuth + JWT
    albums.py              Album metadata, stream trajectory, enrichment
    tracks.py              Track metadata, stream trajectory
    artists.py             Artist pages — discography with stream counts
    ratings.py             Ratings, reviews, votes, replies
    reviews.py             Global reviews feed
    feed.py                Following activity feed
    featured.py            Trending + new releases
    users.py               Public profiles, follow/unfollow, ratings/reviews tab
    comparison.py          Side-by-side trajectory comparison
    saved_comparisons.py   Shareable comparison links
    lists.py               User-created ranked/unranked lists
    leaderboard.py         Era-adjusted charts + /leaderboard/debug
    notifications.py       Follow/review notifications
    discover.py            Personalized For You feed + /discover/debug
    search.py              Unified search — users, albums, tracks in one request
    taste.py               Server-side taste profile
  services/
    spotify.py             Spotify API client — all hot calls Redis-cached 24h
    lastfm.py              Last.fm API — lifetime scrobbles for enrichment
    kworb.py               Kworb scraper — ARTIST PAGES ONLY (entity pages blocked on Railway)
    stream_anchors.py      Wayback anchor store for trajectory calibration
    wayback.py             Wayback Machine client
    normalization.py       MAU table, era-adjustment, trajectory decay model
    album_cache.py         DB-backed enrichment state machine
    redis_cache.py         Async Redis helper (no-op when REDIS_URL absent)
    deezer.py              Deezer — chart tracks, track search, preview fallback
    limiter.py             slowapi rate limiter

frontend/
  src/
    pages/                 One file per route
    components/            Shared UI components
      OnboardingModal.jsx  New-user onboarding (value prop → genre picker)
    services/api.js        ALL API calls — single source of truth, always edit this for new endpoints
    contexts/AuthContext.jsx  JWT auth state
```

---

## Debugging mindset

When something's broken, **default to diagnosis over guessing.** Your first
instinct on a bug report should be to make the state visible, not to write
a fix.

This rule exists because the 2026-05-13/14 swipe-deck session burned ~4
hours and 6+ Vercel pushes on a one-line fix. The first 3 hours were
"add another fix, push, hope it works." It didn't, every time. The actual
breakthrough came in the last 30 minutes when we added an on-screen debug
overlay and read the live state — which immediately showed the state
machine was fine and the bug was render-side. That overlay should have
been the first thing built, not the last.

### Concretely

- **Before writing a fix, instrument.** Build an on-screen debug overlay,
  add a `<pre>{JSON.stringify(state)}</pre>` somewhere visible, render a
  color-coded marker, or otherwise externalize the runtime state. Mobile
  users can't see your `console.log` — assume devtools aren't an option.
- **Treat hypotheses as hypotheses.** "I think it's the body-fixed CSS"
  is a starting point for a diagnostic, not a license to change code.
  Verify the hypothesis with a measurement first, then act on the result.
- **Read the diff before assuming what's different.**
  `git diff origin/master -- frontend/src/pages/X.jsx` will tell you what
  actually changed between your branch and the working baseline. Don't
  describe the difference from memory.
- **Confirm scope before acting.** Is the bug on `master` / prod too, or
  only on your branch? Same surface the user is reporting from (Safari
  vs Firefox vs Capacitor app vs desktop)? Same commit they're testing?
  If you don't know, you're guessing.
- **When iterating on a fix, bisect by removing.** Each new "fix" you
  layer on can introduce its own regression and make it harder to tell
  which change was the actual culprit. Smaller diff vs. master = easier
  to reason about.
- **One concept per commit.** "Try a thing" + "revert that thing" should
  each be one commit. That way `git log --oneline` reads as the actual
  reasoning trail.

### When the user reports a UI bug on mobile

The full runbook (on-screen debug overlay templates, the 4-reading gesture
walkthrough, CSS containment + transform pitfalls, iOS Safari URL-bar
quirks, local-tunnel testing setup, etc.) lives in
[DEBUGGING.md](DEBUGGING.md). Open that before any code edit on a mobile
gesture / layout / iOS-specific report. There's a 10-step diagnostic
checklist at the bottom — start there.

---

## Critical rules

### Never touch
- `database.py` — engine config is correct for both local SQLite and Railway Postgres
- `alembic.ini` / `migrations/` — never hand-edit migrations; create new ones with `alembic revision`
- `.env` files — never commit secrets

### Always do
- **New backend endpoint** → add it to `api.js` in the frontend before considering the work done
- **New DB column/table** → create an Alembic migration: `alembic revision --autogenerate -m "description"`
- **New environment variable** → document it in the PR body under "new env vars required"

### Data source rules
- Kworb artist pages (`get_artist_albums_by_id`) → OK, works from Railway
- Kworb entity pages (`get_entity_daily_data`) → BLOCKED on Railway, do not use
- Last.fm → two responsibilities:
  - primary fallback for album stream counts when Kworb is blocked
  - **primary source for artist genres** (community-applied "top tags").
    Spotify's `/v1/artists/{id}` strips genres + popularity to `[]` / `null`
    for non-Extended-Access apps as of late 2024. Last.fm fills the gap
    via `artist.getTopTags` (with vote counts → weighted confidence; see
    "Artist-genre data flow" section)
- Wayback Machine → trajectory anchor points (one-time fetch per entity)
- Deezer → For You feed baseline tiers (no API key, always has preview URLs);
  use `get_chart_tracks()` for popular tracks, NOT `search_tracks("top hits")`
- **Deezer preview URLs are Akamai-signed and short-lived** — they carry an
  `hdnea=exp=<unix_ts>` query parameter with a ~15-min lifetime. The CDN
  returns `403 + text/html` for expired URLs, which browsers surface as
  `MEDIA_ERR_SRC_NOT_SUPPORTED` ("media resource not suitable"). Any Redis
  cache holding preview URLs MUST cap its TTL at the signed-URL expiry —
  use `services/deezer.py:_signed_url_ttl()` (parses `exp=`, returns
  `exp − now − 60s` floor 60s). All three Deezer cache writes
  (`get_preview`, `search_tracks`, `get_chart_tracks`) already do this;
  any new cache write storing a preview URL must follow the same pattern.

### Spotify API rules — read carefully
Spotify rate limits are the #1 source of production incidents. Follow these:

- **Never call the startup seeder** — `_run_artist_seeder()` in `main.py` is disabled.
  Do not re-enable it. It caused credential-wide rate limit blocks on every deploy
  because it fires 1,000+ requests in a burst. The DB populates organically as users browse.
- **`limit=20` on `/artists/{id}/albums`** — Spotify selectively blocks higher limits
  and sometimes returns `400 "Invalid limit"` as a disguised rate limit. Do not use `limit=50`.
- **No `include_groups` param** — httpx URL-encodes commas in multi-value params, turning
  `album,single` into `album%2Csingle` which Spotify rejects. Omit the param entirely.
- **`_spotify_get` wrapper** — always use this instead of raw `client.get()` for Spotify
  calls. It handles 429 retry with `_MAX_RETRY_WAIT=15s` bailout.
- **`400 "Invalid limit"` = disguised 429** — Spotify returns this fake error when
  selectively rate-limiting `/artists/{id}/albums`. Treat it as a rate limit, not a bug.
- **All hot Spotify functions are Redis-cached 24h**: `get_artist`, `get_album`,
  `get_track`, `get_artist_top_tracks`, `get_artist_albums`, `get_artist_albums_limited`.
  If Redis is not configured, these degrade gracefully to live calls.
- **Artist `genres` + `popularity` are stripped at our tier** (confirmed
  2026-05-18). `GET /v1/artists/{id}` returns `genres: []` and
  `popularity: null` for non-Extended-Access apps. The batch
  `GET /v1/artists?ids=…` is gated even harder — returns `403 Forbidden`.
  Use the Spotify response ONLY for `name` / `image_url` / `external_url`.
  For genres, fall back to **`lastfm.get_artist_tags(name)`** (Last.fm
  TopTags). See "Artist-genre data flow" below.
- **Circuit breaker is Redis-persistent** (since 2026-05-18). When
  Spotify returns a long `Retry-After`, `_trip_circuit` writes the
  deadline to `spotify:circuit_open_until` in Redis with TTL matching
  the block duration. All workers + future deploys read the deadline
  via `_circuit_remaining_async()` before any Spotify call — no more
  deploy → reset → first-call-trips-fresh-deadline → repeat loop.
  Operationally: if you see Spotify failing, check
  `/discover/cache-stats` for the `circuit_breaker` key. Don't redeploy
  to try to "reset" it (the persistent deadline survives the restart).

### Artist discography fallback cascade
`GET /artists/{id}/albums` tries these in order:
1. `spotify.get_artist_albums()` — full paginated fetch, Redis-cached 7 days
2. `spotify.get_artist_albums_limited()` — single page, Redis-cached 7 days
3. `spotify.search_albums(artist_name)` — different endpoint, not subject to same blocks
4. AlbumCache in DB — queried by artist name (looked up from ArtistCache by spotify_id)

### Profile page entity lookup
`_fetch_entity_meta()` in `users.py` resolves name/image/artists for rated entities:
1. AlbumCache / TrackCache in DB — covers anything ever viewed or searched
2. Deezer API — for old numeric IDs (pre-validation For You feed ratings)
3. Spotify API — last resort

### For You feed tiers (discover.py)
Three mutually-exclusive modes, picked per request based on user state.
Source of truth is the docstring at the top of `routers/discover.py`.

**Cold-start (no eligible_genres):**
1. Deezer `/chart/0/tracks` baseline
2. Deezer new-music search
3. Deezer keyword fallback queries

**Vintage (year_range set; user has ≥60% decade pref in one decade):**
1. Tier 0 (catalog pivot) — TrackCache × ArtistCache, genre-family-matched
2. Tier 1 (Spotify) — weighted-genre pivot with `year_range` applied
3. Spotify genre-agnostic baselines (pop / rock / hip-hop, year-locked)

**Genre-locked (user has eligible_genres but no decade dominance):**
1. **Tier 0 — catalog pivot** (`_fetch_genre_tracks_from_catalog`).
   Pulls from TrackCache joined by primary-artist genre family.
   Zero Spotify calls; gated by the weighted-confidence matcher
   (`_GENRE_MATCH_CONFIDENCE_THRESHOLD = 0.25`). Free at runtime.
2. **Tier 1 — Spotify weighted-genre pivot** (`search_tracks_by_genre`).
   Samples `k=6` genres from `eligible_genres` weighted by
   `position_weight × max(rating_count, 1)`. Pool depth from offset
   variants (cache key `spotify:genre_pool_v7:…`).
3. Nuclear fallback — Deezer `/chart` + Deezer genre search, shuffled.

**Artist-genre verification** runs on every tier 1 candidate via
`_filter_pool_by_artist_genre`. Reads ArtistCache, looks up missing
artists via Spotify (name only) + Last.fm (tags + counts), persists.
Drops tracks whose primary artist's tag-confidence in the requested
family falls below the 0.25 threshold.

**Catalog-pivot quality is a function of ArtistCache coverage.** The
`artist_reconciler` background worker (`services/artist_reconciler.py`)
keeps the cache filled by walking TrackCache every 5 minutes and
batch-fetching unmapped primary artists. Steady-state cost is one
Last.fm + one Spotify call per new artist, cached 30d each.

**Tier-ordering rule:** tier order is stable — tier 1 results land at the
top of every batch, tier 5 at the bottom. **Do not add a post-slice
`random.shuffle(result)`** — an earlier version did this and it routinely
buried tier-1 personalized results under generic chart hits. Within-tier
variety comes from `_flatten_shuffle_add()` which shuffles each tier's
gathered results as a single pool before adding to the batch.

**Cross-batch dedupe:** the `/feed` endpoint honors an `exclude` query
parameter (comma-separated track IDs). The frontend passes the last ~80
shown track IDs on prefetch (append-only — not on deliberate resets like
toggling `english_only`). Any new caller of `/feed` should pass this too,
or accept that successive batches may repeat tracks from the chart cache.

### Artist-genre data flow

**TL;DR:** Last.fm `artist.getTopTags` is our genre source. Stored in
`ArtistCache.genres` as a JSON list of `{name, count}` dicts. Matched
against picker slugs via the weighted-confidence threshold (0.25).

**Why Last.fm not Spotify:** see "Spotify API rules" above. Spotify
strips artist genres at our tier. Last.fm tags ALSO closely mirror
Spotify's genre vocabulary (substring matches in `_GENRE_MATCH_ALIASES`
still work), and the per-tag `count` field lets us distinguish real
signal from community-tag noise.

**Storage shape** (`ArtistCache.genres`):
```json
[
  {"name": "hip-hop", "count": 100},
  {"name": "rap", "count": 70},
  {"name": "west coast", "count": 19}
]
```
Legacy rows in `["hip hop", "rap"]` shape are still supported via the
`_normalize_genres_data` shim. Equal-weight assumed for legacy entries.
Backfill via `POST /discover/backfill-artists?force=true` to upgrade.

**Match formula** (`_artist_matches_genre_family`):
```
confidence = sum(weight for tag, weight in artist_tags if any(
    family_term in tag for family_term in _genre_match_terms(slug)
))
artist matches slug ⟺ confidence ≥ 0.25
```

**Threshold tuning reference** (2026-05-18 sweep):
- Kendrick hip-hop = 44% ✓ (strong)
- Skullface metal = 91% ✓ (very strong)
- Taylor country = 37% ✓ pop = 32% ✓ (sustained cross-genre)
- Bieber pop = 41% ✓ metal = 24% ✗ (the prank — dropped at 0.25)

**Threshold lives in one place** — `_GENRE_MATCH_CONFIDENCE_THRESHOLD`
in `services/spotify.py`. All consumers (tier 0 catalog filter, tier 1
Spotify filter, per-genre affinity, negative-genre filter) use the
same threshold via `_artist_matches_genre_family`.

**Background worker:** `services/artist_reconciler.py` runs forever
on startup (5 min interval, batch=50). Walks TrackCache for primary
artist IDs not yet mapped to genres in ArtistCache. Bulk-fetches via
Spotify (name) + Last.fm (tags), persists. Env knobs:
`ARTIST_RECONCILE_INTERVAL` / `ARTIST_RECONCILE_BATCH_SIZE` /
`ARTIST_RECONCILE_STARTUP_DELAY`. Same strong-ref task-GC pattern as
`enrichment_sweeper`.

### Genre pool cache key (don't bump!)

`services/spotify.py:search_tracks_by_genre` caches each genre's pool
under `spotify:genre_pool_v{N}:{genre}:{market}[:y{year}]`. Current N
is **7**. The key includes the version so we can invalidate when the
pool's structural shape changes — but **never bump it more than once
in a short window**. Each bump invalidates every cached pool, and the
first user to request each genre after that burns 5 fresh Spotify
calls. The 2026-05-18 incident saw v5→v6→v7 in one evening, tripping
the credential-wide circuit breaker repeatedly. If you must bump,
plan to absorb a ~30-min Spotify rate-limit window.

### Frontend conventions
- React functional components only, no class components
- All API calls go through `services/api.js` — never call fetch/axios directly in a component
- Recharts for all charts
- No external UI libraries (no MUI, no Chakra) — plain CSS-in-JS style objects

### Vercel Edge Functions in `frontend/api/`
The OG-image renderers (`frontend/api/og/*.tsx`) are Vercel Edge Functions,
not part of the Vite SPA build. Two rules:

- **Use `.tsx`, not `.jsx`.** Vercel autoregisters `/api/*` files by
  extension. `.jsx` files build but never register as functions (silent
  404 from the edge proxy). `.tsx` registers correctly.
- **`frontend/api/tsconfig.json` is required.** Vercel runs `tsc` over
  the `.tsx` files independently of Vite, and without a tsconfig you
  get `TS17004: Cannot use JSX unless the '--jsx' flag is provided`,
  the build fails, AND `@vercel/og` shows up as "unsupported module"
  in the deploy log. The scoped tsconfig has `"jsx": "react-jsx"` and
  `"include": ["./**/*.ts", "./**/*.tsx"]` so it doesn't affect Vite.

Verify a new function actually registered after deploy:

```bash
curl -I "https://contour-rosy.vercel.app/api/og/<name>"
# Expect: 200 with Content-Type: image/png, OR a 4xx from the handler
#         itself (Content-Type: text/plain). A 404 with X-Vercel-Error:
#         NOT_FOUND means the function didn't register — check the
#         Vercel deploy log for TS errors.
```

### Card share architecture
- `frontend/src/components/CardPreviewModal.jsx` — modal that fetches the
  PNG from the OG endpoint, displays it inline, and exposes Save / Share
  CTAs. Used by review rows (`ReviewSection.jsx`, `UserPage.jsx`), the
  comparison page, and the hot-take button on the profile.
- `frontend/src/utils/share.js` — dispatcher. On native it writes the PNG
  to `Directory.Cache` via `@capacitor/filesystem` and hands the `file://`
  URI to `@capacitor/share`. On web it uses Web Share Level 2
  (`navigator.share({ files })`) with an `<a download>` fallback.

Why not direct `navigator.share({ files })` everywhere: iOS Capacitor's
WKWebView has `navigator.canShare({ files })` returning `false` even
when share-with-file would succeed. That false-negative was silently
dropping every share back to URL-only — the iMessage just got a link
tile, no PNG. The modal + native plugin path bypasses that.

### Design system (shipped 2026-05-13)
The visual identity was deliberately rebuilt away from the default "AI app
template" look (violet→emerald gradients, system sans, UPPERCASE tracked
eyebrows). Do not reintroduce those patterns.

- **Type**: headings + wordmark use **Instrument Serif** (loaded via
  Google Fonts in `index.html`). Body type stays on the system stack.
  Reference via `var(--font-display)` from `index.css`. Apply to any new
  H1/H2 or signature stat. Don't use sans-serif for page titles.
- **Color palette**: pulled from the Contour logo.
  - `--accent` / `--accent-a` = `#d97a3b` (warm amber, primary brand)
  - `--accent-b` = `#6a90b5` (dusty cobalt, used only in Compare for
    "entity B" data semantics — not for general brand use)
  - `--gold` = `#f59e0b` (star ratings, RIAA milestones)
  - `--danger` = `#f87171` (errors)
  - **No emerald (`#34d399`)**, **no violet (`#a78bfa`)** as brand. Those
    were Tailwind defaults that read as templated. The genre-picker palette
    keeps its own varied colors; the badge palette keeps its own — those
    aren't brand application.
- **No gradient clip-text** on headlines. The previous wordmark and every
  page H1 used `background: linear-gradient(violet, emerald)` + `-webkit-
  background-clip: text`. All removed. Headings are solid `var(--text)` in
  Instrument Serif. If you find yourself reaching for `backgroundClip:
  "text"`, stop — it's almost never the right call for this app.
- **No trailing `→` on CTAs**. "Get started", "Continue", "Got it", "See all"
  — punctuation off. Was used in 8+ places, all removed.
- **Sentence-case section headers**, not UPPERCASE+tracked eyebrow labels.
  Compare "Tracklist" / "Listen on" / "Sort by" / "Era score" (current) vs.
  "TRACKLIST" / "LISTEN ON" (old AI-template look).
- **One tagline, one home**: "Rate. Review. Discover." lives only on the
  sign-in gate. Don't repeat it on the header or onboarding.
- **Era Score as signature stat**: `EraAdjustedStat` hero variant treats the
  era-adjusted number like a magazine stat — Instrument Serif at ~76px,
  `font-variant-numeric: tabular-nums`, with raw plays + ×multiplier as a
  sub-line. That stat is the brand's typographic identity.

If you're adding new pages: copy the H1 pattern from `LeaderboardPage.jsx` or
`TrendingPage.jsx` (serif, 40px, weight 400, solid text color, no gradient).

### Deck rendering — known landmines
The For You feed swipe deck (`ForYouPage.jsx` → `ForYouFeed` component) has
shipped multiple regressions. Two things to never reintroduce:

- **No `contain: layout paint` on the deck wrapper.** Per spec, paint
  containment clips descendants to the element's UN-transformed border box.
  Cards inside are positioned via `transform: translate3d(0, i*100%, 0)` so
  card[1] sits at +100% (outside the wrapper's static box). When the wrapper
  translates `-100%` on a forward swipe, card[1] visually enters the
  viewport — but paint containment kept clipping it against the static
  bounds, producing a black screen on iOS where the next song should be.
  Fixed in c41e7c9. The deck container parent already has `overflow:
  hidden` so paint isolation isn't lost.
- **No `position: fixed` on `body` to suppress rubber-band.** That was
  tried (8f6ec8e) and broke forward swipe — the layout shift confused
  iOS gesture dispatch. Use `overflow: hidden` on body+html instead, or
  accept the rubber-band as a lower-priority issue.
- **`touch-action: pan-y` on the deck container, not `none`.** Setting
  `touch-action: none` on iOS WebKit suppresses the touchend → JS-advance
  gesture sequence entirely. pan-y lets iOS interpret the gesture natively
  while our touchstart/move/end handlers still fire.
- **On tablet+ viewports (>640px), the Discover swipe overlay must
  anchor below the Layout header**, not over it. The bottom-nav is
  `display: none` above 640px so the desktop top nav (Friends / Search /
  Compare / Profile) is the only navigation on iPad — covering it with
  `top: 0; zIndex: 60` strands users on Discover with no exit. Use
  `top: var(--layout-header-h); zIndex: 40` on tablet+; keep the
  iPhone full-bleed (`top: 0; zIndex: 60`) below 640px. See
  `ForYouPage.jsx`'s `isTabletOrLarger` gate.

For debugging future deck issues: see [DEBUGGING.md](DEBUGGING.md) — there's
a methodology section specifically for mobile gestures since you can't see
the JS console on iPhone.

### Branch rules

**Active Claude session (Claude + Peyton working together)** — commit
directly to `master` and push. Merge to master is the deploy. No PR, no
`develop` intermediate. The `develop` branch exists in the remote but is
abandoned (far behind master, last meaningful work was reverted CORS
changes); do not commit there or attempt to revive it without an explicit
cleanup pass.

**Peyton submitting work via GitHub mobile** — Peyton opens a branch and
PR directly on GitHub; Claude is not in the loop for those.

---

## Local environment variables (backend/.env)

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/callback
JWT_SECRET=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
FRONTEND_URL=http://localhost:5173
LASTFM_API_KEY=
# DATABASE_URL and REDIS_URL are set automatically by Railway in prod
```

---

## Observability

**Always-on health endpoints:**
- `GET /health` — all dependency checks (DB, Spotify, Last.fm, Kworb, Redis, leaderboard)
- `GET /leaderboard/debug` — DB counts by enrichment status + Last.fm live test
- `GET /discover/debug` — For You feed tier health
- `GET /discover/catalog-stats` — TrackCache / ArtistCache / AlbumCache counts,
  popularity buckets, unique-genres-seen
- `GET /discover/cache-stats` — Redis state: counts + sizes per key prefix
  (genre pools v5/v6/v7, artist/track/album meta, deezer cache, circuit breaker)

**Auth-required user-state introspection:**
- `GET /discover/me-state` — dump the authenticated user's complete
  feed-decision state: eligible_genres, excluded_genres, decade_pref,
  year_range, target_popularity, per-genre rating affinity + tag mass,
  predicted tier-1 sampling weights, inferred mode. Backs the
  `/settings/taste-profile` transparency page (see below).

**Recovery / maintenance:**
- `POST /discover/backfill-artists` — one-shot catch-up that walks
  TrackCache, finds primary artists not yet in ArtistCache, batch-fetches
  via Spotify (name) + Last.fm (tags). Query params: `limit` (default 500,
  max 2000), `refresh_empty=true` (also re-fetch rows with `genres=[]`),
  `force=true` (re-fetch EVERY primary artist regardless — use after a
  data-shape migration). Steady-state coverage is maintained by the
  `artist_reconciler` background worker; this endpoint is for emergencies.
- `POST /taste/reset` — selective wipe of taste-profile fields
  (`genres` / `excluded_genres` / `liked_artist_ids` / `disliked_artist_ids`
  / `down_weighted_artist_ids`). Ratings are never touched. Each field
  opt-in via the request body. Backs the four reset affordances on the
  transparency page.

**Diagnostic / probe endpoints** (auth-less, but only return innocuous
metadata — useful when debugging Spotify-credential / Last.fm behaviour):
- `GET /discover/probe-artist-raw?id=…` — raw `/v1/artists/{id}` Spotify
  response (status + headers + body). Use to confirm whether Spotify is
  stripping data or our code is.
- `GET /discover/probe-artists?ids=…` — same for the batch endpoint
  (currently always 403 at our tier).
- `GET /discover/probe-artist-single?id=…` — our parsed `get_artist()`
  output.
- `GET /discover/probe-artist-cache-sample?limit=…` — sample N rows of
  ArtistCache with their stored genres + a count of how many have
  non-empty genres.
- `GET /discover/probe-lastfm-artist?name=…` — Last.fm `artist.getInfo`
  for an artist (no quota cost on our side).
- `GET /discover/probe-lastfm-toptags?name=…` — Last.fm `artist.getTopTags`
  with vote counts — confirms the count signal.
- `GET /discover/probe-genre-match?name=…` — runs the live weighted
  matcher against a stored artist. Shows the tag-weight distribution
  and which picker slugs pass/fail the threshold. Lets you tune
  `_GENRE_MATCH_CONFIDENCE_THRESHOLD` empirically.

These probes are kept in tree (rather than deleted after diagnosis)
because they cost nothing and shorten the next investigation cycle by
hours. None reveals PII; the worst they leak is artist tag popularity.

Full documentation: `OBSERVABILITY.md`

## Transparency view (user-facing)

`/settings/taste-profile` (`frontend/src/pages/TasteProfilePage.jsx`)
renders the same `/discover/me-state` data in a friendly UI: current
mode (cold-start / vintage / genre-locked), eligible vs excluded genres,
target popularity, decade preference, predicted tier-1 sampling weights,
rating totals, exclude-list size. Plus:

- **Reset affordances** — 4 buttons with a confirmation dialog:
  - "Re-derive from ratings" (wipes artist seed lists; keeps genre picks)
  - "Clear genre picks" (clears liked + excluded genres)
  - "Clear Not-Interested list"
  - "Full reset" (everything, ratings still preserved)
- **"Open fresh feed (no personalization)"** button — sets a
  `contour_fresh_feed_once` localStorage flag that the next
  `fetchBatch()` in `ForYouPage.jsx` consumes once and forwards to the
  server as `?fresh=true` on `/discover/feed`. Lets a user see what a
  cold-start user would get without nuking their profile.

---

## Deployment

Railway auto-deploys when `master` gets a new commit. Frontend (Vercel) auto-deploys
when `master` gets a new commit. Merging a PR to `master` = production deploy.

Alembic migrations run automatically on startup — no manual migration step needed.

**Full update-workflow runbook** — including the decision tree for which
changes need which deploy path (web / backend / iOS rebuild), the
Codemagic webhook-glitch fallback, build-version bumping, and verification
steps for each target — lives in
[OPERATIONS.md → "Deploy & update workflow"](OPERATIONS.md#deploy--update-workflow).
Consult that before assuming a change needs a rebuild that it doesn't.

### iOS & Android: live-update shell model

**Important architectural fact for mobile work.** The native iOS and Android
apps are **thin Capacitor shells that load the live web app from
`https://contour-rosy.vercel.app` on every launch.** Configured in
`frontend/capacitor.config.json` via `server.url`.

What this means for deploys:

| Change type | Where to ship | Reaches mobile users when |
|---|---|---|
| React / CSS / page layout | Push to `master` → Vercel | Next app launch (seconds) |
| Backend logic / API | Push to `master` → Railway | Next request |
| **Add a Capacitor plugin** (e.g. `@capacitor/push-notifications`, native SIWA) | Push, then tag `ios-v*` to trigger Codemagic rebuild | After TestFlight / App Store review |
| App icon, splash screen | Same as above — IPA rebuild | After TestFlight / App Store review |
| Native config (entitlements, `Info.plist`, deep-link schemes) | Same as above | After TestFlight / App Store review |

In practice: 90%+ of changes ship via web deploy and reach mobile instantly.
IPA rebuilds happen quarterly-ish, when bundling new native capabilities.

**Do NOT switch to bundled-mode** (removing `server.url`) without a discussion —
that locks iOS/Android users on whichever frontend was bundled into the IPA at
build time, which is the opposite of what we want for a mobile-first social app.

**Mobile-specific UI in React:** detect via `Capacitor.isNativePlatform()`
plus viewport size. Same component tree can render desktop-web, mobile-web,
and native-shell variants without conditional builds.

---

## Known Spotify rate limit behaviour

Spotify's basic (non-Extended Access) tier is aggressive about rate limiting.
Key patterns observed in production:

| Symptom | Cause | Fix |
|---|---|---|
| `400 "Invalid limit"` on `/artists/{id}/albums` | Disguised 429 — selective endpoint block | Fall back to `/search`, then DB |
| `429 Retry-After: 2921` | Credential-wide block from burst traffic | Wait it out; circuit breaker handles |
| All artists returning 400 after one 429 | Credential still blocked | Same — wait |
| Empty discography on artist page | Endpoint blocked AND artist not in DB yet | "Try again" button; resolves within hours |
| `genres: []` / `popularity: null` on artist endpoint | Spotify gated this data behind Extended Access in late 2024 | Use Last.fm `artist.getTopTags` — see "Artist-genre data flow" |
| `403 Forbidden` on `/v1/artists?ids=…` (batch) | Spotify gated the batch endpoint behind Extended Access | Use per-artist `/v1/artists/{id}` instead (still open) |

The startup artist seeder was the primary cause of credential-wide blocks. It is
permanently disabled. Do not re-enable it without a dedicated rate-limit budget.

**Circuit breaker (Redis-persistent, since 2026-05-18):** when Spotify
hands us a `Retry-After ≥ 10s`, `_trip_circuit` writes the deadline to
`spotify:circuit_open_until` in Redis with TTL matching the block.
Subsequent Spotify calls from ANY worker (and across deploys) short-
circuit via `_circuit_remaining_async` until the TTL expires. This
replaces the previous in-process-only breaker that was getting reset
on every deploy → causing a fresh credential trip → repeat. Operational
implication: **don't redeploy to "reset" a rate-limit incident** — the
persistent deadline survives. Just wait. The deadline is visible via
`/discover/cache-stats` under the `circuit_breaker` prefix.

**Extended Access is not an option for us** — requires ~250K MAU per
Spotify policy. See `project_spotify_extended_access_blocked.md` in
the project memory.
