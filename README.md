# Contour

**Era-adjusted music streaming data, community ratings, and reviews.**

> [**contour-rosy.vercel.app**](https://contour-rosy.vercel.app) — try it live

---

## What is Contour?

Spotify launched in 2008 with a few million users. Today it has 750M+. A song that hit 500M streams in 2016 did so on a platform a fraction of today's size — it would be a *billion-stream* song if it released now.

Contour adjusts for this. Every stream count is normalized against Spotify's monthly active users at the time of release, so you can finally compare a 2012 classic and a 2024 hit on equal footing.

On top of that, Contour is a place to rate albums and tracks, write reviews, see what the community thinks, and follow people with good taste.

---

## Features

**Music Data**
- Era-adjusted stream trajectories for any album or track
- RIAA milestone markers (Gold, Platinum, Diamond) on trajectory charts
- Artist pages with top tracks, full discography, and catalog stream totals
- Album tracklists with per-track navigation

**Community**
- ★ Half-star ratings (0.5–5.0) on albums, tracks, and artists
- Written reviews with upvote ▲ / downvote ▼ voting
- Reddit-style controversial sort: surfaces divisive takes, not just popular ones
- Inline reply threads on reviews
- Follow other users and see their activity in your feed
- Share any review as a direct deep link

**Discovery**
- Discover tab: public global reviews feed sorted by Recent / Top / Controversial — no account needed
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
| Auth | Spotify OAuth 2.0 + JWT |
| Data | Spotify Web API, Kworb.net stream counts |
| Hosting | Vercel (frontend) · Railway (backend) |

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

Values between years are linearly interpolated. The era-adjusted equivalent is:

```
era_adjusted = total_streams × (current_mau / release_era_mau)
```

The callout appears on album and track pages whenever the multiplier is ≥ 1.5×.

Day-by-day trajectory is modeled (high early velocity tapering to catalog tail) calibrated to the known total. A disclaimer is shown when modeled data is used instead of Kworb actuals.

---

## Running Locally

### Prerequisites
- Node.js 18+
- Python 3.12+
- A Spotify Developer app ([create one here](https://developer.spotify.com/dashboard))

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Create backend/.env with:
# SPOTIFY_CLIENT_ID=...
# SPOTIFY_CLIENT_SECRET=...
# SPOTIFY_REDIRECT_URI=http://localhost:8000/auth/callback
# JWT_SECRET=any-random-string

alembic upgrade head
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`. API calls proxy to `http://localhost:8000`.

---

## Environment Variables

**Backend (`backend/.env`)**

| Variable | Description |
|---|---|
| `SPOTIFY_CLIENT_ID` | Spotify Developer Dashboard |
| `SPOTIFY_CLIENT_SECRET` | Spotify Developer Dashboard |
| `SPOTIFY_REDIRECT_URI` | `https://your-backend.railway.app/auth/callback` |
| `JWT_SECRET` | Any long random string — never commit this |
| `DATABASE_URL` | PostgreSQL connection string (Railway provides this) |

**Frontend (`frontend/.env` or Vercel env vars)**

| Variable | Description |
|---|---|
| `VITE_API_URL` | Your Railway backend URL, e.g. `https://contour-production.up.railway.app` |

---

## Project Structure

```
backend/
  main.py                  FastAPI app, CORS, router registration
  models.py                SQLAlchemy ORM models
  database.py              Async PostgreSQL connection
  routers/
    albums.py              Album search + stream trajectory
    tracks.py              Track search + stream trajectory
    artists.py             Artist metadata, discography, top tracks
    ratings.py             Ratings, reviews, votes, replies
    reviews.py             Global public reviews feed
    feed.py                Following activity feed
    featured.py            Trending + new releases (home screen)
    users.py               Public profiles, follow/unfollow
    auth.py                Spotify OAuth, JWT
    comparison.py          Side-by-side trajectory comparison
  services/
    spotify.py             Spotify Web API client
    normalization.py       MAU interpolation + era-adjustment
    album_cache.py         DB cache + Kworb stream enrichment

frontend/
  src/
    pages/                 SearchPage, AlbumPage, TrackPage, ArtistPage,
                           ComparePage, FeedPage, ProfilePage, UserPage,
                           PrivacyPage, ...
    components/            Layout, ReviewSection, TrajectoryChart,
                           ComparisonWidget, EraCallout, ShareButton, ...
    services/api.js        All API calls
    contexts/AuthContext   JWT auth state
  capacitor.config.json    iOS/Android app config
  public/manifest.json     PWA manifest
```

---

## Roadmap

- [ ] App Store launch (iOS via Codemagic + Capacitor)
- [ ] Google Play launch (Android via Capacitor)
- [ ] Push notifications (new follower, review liked)
- [ ] Onboarding flow for new users
- [ ] Charts / leaderboard page (top rated this week, most era-adjusted streams)
- [ ] User-created lists ("My Top 10 Albums")
- [ ] Pre-2015 era support

---

## Data Notes

- Stream trajectory is **modeled**, not actual historical data. True day-by-day counts require Luminate licensing.
- Normalization is **Spotify-only**. Apple Music, Tidal, YouTube are not factored in.
- Kworb stream counts are scraped on demand and cached. Scrape failures fall back to Spotify popularity signal with a UI warning.
