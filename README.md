# Contour

**Music ratings, reviews, and era-adjusted streaming analytics.**

> [**contour-rosy.vercel.app**](https://contour-rosy.vercel.app) — try it live

---

## What is Contour?

Spotify launched in 2008 with a few million users. Today it has 800M+. A song that hit 500M streams in 2016 did so on a platform a fraction of today's size — it would be a *billion-stream* song if it released now.

Contour adjusts for this. Every stream count is normalized against Spotify's monthly active users at the time of release, so you can finally compare a 2012 classic and a 2024 hit on equal footing.

On top of the analytics, Contour is a place to rate albums and tracks, write reviews, see what the community thinks, discover new music, and follow people with good taste.

---

## Features

**Music Data**
- Era-adjusted stream trajectories for any album or track
- Era Score leaderboard — seeded from Global Top 50 + curated catalog, refreshed every 24 hours
- RIAA milestone markers (Gold, Platinum, Diamond) on trajectory charts
- Artist pages with "Known For" (top hits by popularity), top tracks, full discography
- Early streaming era banners for releases before 2013 with context about sparse data
- Clear "no data" placeholder when Kworb stream data is unavailable (instead of a blank chart)
- Album tracklists with per-track navigation

**Community**
- ★ Half-star ratings (0.5–5.0) on albums, tracks, and artists
- Written reviews with upvote ▲ / downvote ▼ voting
- Reddit-style controversial sort: surfaces divisive takes, not just popular ones
- Inline reply threads on reviews
- Follow other users and see their activity in your feed
- Notifications for new followers and review interactions
- Share any review as a direct deep link

**Profiles & Taste**
- Public user profiles with rating history, reviews, and follower counts
- Taste profile: rating distribution chart, top genres, and pinned albums
- Server-side taste profile synced across devices — preferences follow you when you sign in
- User-created lists (ranked or unranked) — build your top albums, hidden gems, whatever

**Discovery**
- For You feed: TikTok-style track preview scroll, personalized by your ratings and genre picks
  - Tier 1: related-artist tracks from artists you've rated 4–5 stars
  - Tier 2: genre-filtered search from your learned genre profile
  - Tier 3: Deezer chart tracks baseline (real chart data, no API key required)
  - Tier 4: Deezer new music search
  - Tier 5: genre keyword fallbacks — always returns something
  - Rate ~10 tracks and the feed actively adapts — genre, era, vibe
- Onboarding for new users: value prop explanation → genre picker → taste profile seeded immediately
- Global reviews feed sorted by Recent / Top / Controversial — no account needed
- Charts page: era-adjusted leaderboard ranked by Era Score or raw streams
- Trending tracks and new releases on the home screen
- Search across albums, tracks, artists, and users in one bar

**Compare**
- Side-by-side trajectory comparison for any two albums or tracks
- Edition picker: compare standard vs. deluxe editions separately or combined
- Save and share comparison links

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, React Router v7 |
| Charts | Recharts |
| Mobile | Capacitor (iOS/Android — in progress) |
| Backend | Python 3.12 / FastAPI |
| Database | PostgreSQL (Railway) + SQLAlchemy async |
| Cache | Redis (Railway) — 24h TTL on hot Spotify API calls |
| Rate limiting | slowapi — per-IP, Railway proxy-aware via `X-Forwarded-For` |
| Auth | Google OAuth 2.0 + JWT |
| Data | Spotify Web API, Last.fm, Kworb.net (artist pages), Wayback Machine, Deezer (preview fallback) |
| Hosting | Vercel (frontend) · Railway (backend + Redis) |

---

## Normalization Methodology

Stream counts are adjusted using Spotify's reported monthly active users:

| Year | MAU |
|------|-----|
| 2008 | 0.1M |
| 2012 | 20M |
| 2015 | 75M |
| 2018 | 191M |
| 2020 | 345M |
| 2022 | 456M |
| 2024 | 678M |
| 2025 | 750M (est.) |
| 2026 | 800M (est.) |

Values between years are linearly interpolated. The Era Score formula:

```
era_adjusted = total_streams × (current_mau / release_era_mau)
```

Day-by-day trajectory is modeled (high early velocity tapering to catalog tail) calibrated to the known total stream count. When real historical data points exist (Wayback Machine snapshots), the curve is interpolated through them. A disclaimer is always shown to make clear when modeled data is used.

---

## Running Locally

### Prerequisites
- Node.js 18+
- Python 3.12+
- A Spotify Developer app ([create one here](https://developer.spotify.com/dashboard))
- A Google Cloud project with OAuth 2.0 credentials ([create one here](https://console.cloud.google.com/))
- Redis is optional locally — the app degrades gracefully without it

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Copy the example env file and fill in your values
cp .env.example .env
# Edit backend/.env (see Environment Variables below)

# Database — SQLite is used automatically for local dev, no setup needed.
# Alembic runs migrations on startup; tables are created automatically.
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
# VITE_API_URL can stay empty for local dev (Vite proxies to localhost:8000)
npm run dev
```

Runs at `http://localhost:5173`. API calls proxy to `http://localhost:8000`.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | ✅ | — | Google Cloud OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | — | Google Cloud OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | ✅ | `http://localhost:8000/auth/callback` | Must match an authorized redirect URI in Google Cloud Console |
| `JWT_SECRET` | ✅ | — | Long random string for signing session tokens. Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `SPOTIFY_CLIENT_ID` | ✅ | — | Spotify Developer Dashboard |
| `SPOTIFY_CLIENT_SECRET` | ✅ | — | Spotify Developer Dashboard |
| `FRONTEND_URL` | ✅ | `http://localhost:5173` | Used in OAuth redirect to return the token to the correct origin |
| `DATABASE_URL` | prod only | SQLite | PostgreSQL connection string. Railway sets this automatically. Format: `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | optional | — | Redis connection string. Railway sets this automatically when you add the Redis plugin. Without it, caching is silently skipped. |
| `JWT_EXPIRE_DAYS` | ❌ | `30` | How long session tokens stay valid |

### Frontend (`frontend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_API_URL` | prod only | `""` | Your Railway backend URL, e.g. `https://your-app.up.railway.app`. Leave empty locally — Vite proxies automatically. |

See `backend/.env.example` and `frontend/.env.example` for ready-to-copy templates.

---

## Project Structure

```
backend/
  main.py                  FastAPI app, CORS, rate limiter, router registration, leaderboard seed task
  models.py                SQLAlchemy ORM models (User, Rating, Review, AlbumCache, UserTasteProfile, …)
  database.py              Async engine — SQLite locally, Postgres in prod
  routers/
    auth.py                Google OAuth 2.0 flow, JWT issuance, optional/required user deps
    albums.py              Album search, metadata, stream trajectory
    tracks.py              Track search, metadata, stream trajectory
    artists.py             Artist metadata, discography, top tracks, favorites
    ratings.py             Ratings, reviews, upvote/downvote votes, replies; auto-updates taste profile
    reviews.py             Global public reviews feed
    feed.py                Following activity feed
    featured.py            Trending tracks + new releases (home screen)
    users.py               Public profiles, follow/unfollow, lists preview
    comparison.py          Side-by-side trajectory comparison
    saved_comparisons.py   Save and retrieve comparison links
    lists.py               User-created lists (CRUD + item management)
    leaderboard.py         Era-adjusted charts
    notifications.py       Follow and review interaction notifications
    discover.py            Personalized For You feed (rate-limited 60/min per IP)
    search.py              Unified search — users, albums, tracks in one request with DB-first triage
    taste.py               Server-side taste profile (GET + POST)
  services/
    spotify.py             Spotify Web API client; hot calls Redis-cached for 24h
    normalization.py       MAU table, era-adjustment, trajectory modeling
    album_cache.py         DB-backed cache + Kworb stream enrichment state machine
    kworb.py               Kworb.net scraper — artist album/track stream totals (artist pages only; entity pages blocked from Railway)
    lastfm.py              Last.fm API client — lifetime scrobble counts used for leaderboard seeding
    stream_anchors.py      Anchor point store — loads/saves Wayback historical snapshots used to calibrate trajectory curves
    wayback.py             Wayback Machine client — fetches archived stream count snapshots for real trajectory anchors
    redis_cache.py         Async Redis helper (get/set with graceful no-op when REDIS_URL absent)
    limiter.py             slowapi Limiter using X-Forwarded-For for real IP behind Railway proxy
    deezer.py              Deezer — chart tracks (get_chart_tracks), track search, preview fallback
  migrations/
    versions/              Alembic migration chain

frontend/
  src/
    pages/
      ForYouPage.jsx        Home — personalized track discovery feed (TikTok-style)
      SearchPage.jsx         Albums, tracks, artists, users in one bar
      AlbumPage.jsx          Album detail — streams, ratings, reviews, tracklist
      TrackPage.jsx          Track detail — streams, ratings, reviews
      ArtistPage.jsx         Artist — Known For, top tracks, discography, favorites
      ComparePage.jsx        Side-by-side trajectory comparison
      FeedPage.jsx           Activity feed from followed users
      LeaderboardPage.jsx    Era Score + Raw Streams charts
      ProfilePage.jsx        Your profile — ratings, reviews, lists, taste
      UserPage.jsx           Public profile — same tabs, with follow button
      ListDetailPage.jsx     View/edit a user-created list
      NotificationsPage.jsx  Notification inbox
      SavedComparisonPage.jsx Shared comparison permalink
    components/
      Layout.jsx             Nav, search bar, auth button, bottom bar (mobile)
      ReviewSection.jsx      Ratings, reviews, votes, replies (shared widget)
      TrajectoryChart.jsx    Line chart with RIAA milestone markers
      ComparisonChart.jsx    Dual-series comparison chart
      ComparisonWidget.jsx   Inline album-vs-album widget (used on album pages)
      EditionPicker.jsx      Standard vs. deluxe edition selector
      EraCallout.jsx         Era-adjustment callout banner
      PreStreamingBanner.jsx Pre-streaming / early streaming era context banner
      Methodology.jsx        How It Works page content
      TasteSection.jsx       Rating distribution + top genres + pinned albums
      OnboardingModal.jsx    New-user onboarding: value prop → genre picker → taste profile saved
      UnifiedSearch.jsx      Shared search dropdown (albums + tracks)
      StarRating.jsx         Interactive half-star rating widget
      ShareButton.jsx        Copy/share link helper
      AlbumCard.jsx          Compact album card used in feeds
    services/api.js          All API calls — single source of truth
    contexts/AuthContext.jsx JWT auth state (login, logout, current user)
  public/
    manifest.json            PWA manifest
  capacitor.config.json      iOS/Android app config
```

---

## Deployment

### Railway (backend)

1. Create a new Railway project and connect this repo.
2. Add a **PostgreSQL** plugin — Railway sets `DATABASE_URL` automatically.
3. Add a **Redis** plugin — Railway sets `REDIS_URL` automatically. Without it the app still works; hot Spotify calls just won't be cached.
4. Set the environment variables listed above under **Backend**.
5. Railway runs `uvicorn main:app --host 0.0.0.0 --port $PORT` via `Procfile` or start command.
6. On startup: Alembic migrations run, then `create_all` as a safety net. The DB populates organically as users browse — the bulk artist seeder is disabled to prevent Spotify credential-wide rate limit blocks.

### Vercel (frontend)

1. Import the repo in Vercel, set **Root Directory** to `frontend`.
2. Set `VITE_API_URL` to your Railway backend URL in Vercel's Environment Variables.
3. Vercel builds with `npm run build` and serves `dist/`.

---

## Roadmap

- [ ] App Store launch (iOS via Codemagic + Capacitor)
- [ ] Google Play launch (Android via Capacitor)
- [ ] Push notifications (new follower, review reply)
- [ ] Cross-platform normalization (Apple Music, YouTube, Tidal)
- [ ] True historical stream data via Luminate API

---

## Analytics

Two telemetry layers, both opt-in via env vars and both no-op when unconfigured:

- **PostHog** (`VITE_POSTHOG_KEY`) — autocapture is enabled, plus the named events
  listed below. Identity is set on login (`posthog.identify` with `user_id` + `email`)
  and cleared on logout (`posthog.reset`). All wiring lives in
  `frontend/src/services/analytics.js`.
- **Vercel Web Analytics** (`@vercel/analytics`) — wraps `<App />` in
  `frontend/src/main.jsx`. Enable the toggle in the Vercel dashboard; no key needed.

### Named events (PostHog)

| Event | Properties | Fires when |
|---|---|---|
| `signup_completed` | `auth_provider` (`google` / `apple`) | First identification of a user on a given device |
| `rating_submitted` | `rating_value`, `entity_type`, `entity_id` | Any star rating saved (album, track, artist, or For You feed) |
| `review_submitted` | `entity_type`, `review_length` | Written review saved |
| `review_voted` | `vote_type` (`up` / `down`) | Upvote or downvote on a review |
| `follow_user` | — | A follow toggles from off → on |
| `era_adjustment_viewed` | `entity_type` (`album` / `track`) | The era-adjustment "?" popover is opened (validates the contextual pivot) |
| `comparison_created` | — | A trajectory comparison successfully runs |
| `list_created` | — | A user-created list is created |
| `for_you_track_played` | `tier_source` (`spotify` / `deezer`) | A track preview begins playing in the For You feed |
| `for_you_rated` | `tier_source`, `rating_value` | A track is rated from within the For You feed |
| `apple_music_link_clicked` | `entity_type` | A "Play on Apple Music" button is clicked |
| `spotify_link_clicked` | `entity_type` (`album` / `track` / `artist`) | An open-in-Spotify link is clicked |

To add a new event, define a helper on the `analytics` object in
`frontend/src/services/analytics.js` and call it from the relevant component.

---

## Data Notes

- Stream trajectory is **modeled**, not actual historical data. True day-by-day counts require Luminate licensing. When Wayback Machine snapshots exist for an album, the curve is interpolated through them; otherwise the decay model runs solo.
- Normalization is **Spotify-only**. Apple Music, Tidal, YouTube are not factored in.
- **Leaderboard stream counts** come from Last.fm's `album.getInfo` API (lifetime scrobbles), seeded on startup and refreshed every 24 hours. Kworb artist pages are used as a secondary source when an album is first opened; enrichment failures set `enrichment_status = "failed"` and exclude the album from the leaderboard.
- **Kworb entity pages** (`kworb.net/spotify/track/{id}.html`) are blocked from Railway's IP range. Trajectory anchors from Kworb daily chart data are not available; Wayback Machine is the only live anchor source.
- The For You feed rate limit is **60 requests/minute per real client IP**. Railway's reverse proxy is handled via `X-Forwarded-For`.
