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
- Last.fm → primary fallback for album stream counts when Kworb is blocked
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
1. Seed-artist genre pivot — Spotify, most personalized. Fetches the genres
   of the user's 3 most-recently 4–5★'d artists and searches those. (Replaced
   Spotify's `/related-artists` endpoint, which was deprecated for non-Extended-
   Access apps in late 2024 and now always returns 0.)
2. Profile-genre search — Spotify search across `UserTasteProfile.genres`.
   The genres list is seeded by onboarding AND auto-extended on every 4–5★
   rating (taking the rated artist's Spotify genres, prepending, deduping,
   cap 20). A user who skipped onboarding still gets tier 2 working after
   a few high ratings.
3. Deezer chart tracks — `get_chart_tracks()`, NOT text search
4. Deezer new music search
5. Deezer keyword fallbacks
6. Nuclear fallback — chart tracks ignoring disliked filter

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

### Frontend conventions
- React functional components only, no class components
- All API calls go through `services/api.js` — never call fetch/axios directly in a component
- Recharts for all charts
- No external UI libraries (no MUI, no Chakra) — plain CSS-in-JS style objects

### Branch rules

Two workflows depending on context:

**Active Claude session (Claude + Peyton working together)**
- Commit to `develop`, push, then merge `develop` → `master` directly and push
- No PR needed — merge to master is the deploy, do it immediately when work is complete
- Command: `git checkout master && git merge develop && git push && git checkout develop`

**Peyton submitting work via GitHub mobile**
- Work on `develop`, open a PR to `master`
- Peyton reviews and merges via the GitHub app on his own schedule
- Claude should open the PR but not merge it

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

Three debug endpoints — hit these to diagnose issues:
- `GET /health` — all dependency checks (DB, Spotify, Last.fm, Kworb, Redis, leaderboard)
- `GET /leaderboard/debug` — DB counts by enrichment status + Last.fm live test
- `GET /discover/debug` — For You feed tier health

Full documentation: `OBSERVABILITY.md`

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
| `429 Retry-After: 2921` | Credential-wide block from burst traffic | Wait it out; do not retry in a loop |
| All artists returning 400 after one 429 | Credential still blocked | Same — wait |
| Empty discography on artist page | Endpoint blocked AND artist not in DB yet | "Try again" button; resolves within hours |

The startup artist seeder was the primary cause of credential-wide blocks. It is
permanently disabled. Do not re-enable it without a dedicated rate-limit budget.
