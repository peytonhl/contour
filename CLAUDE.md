# Contour — Claude Code Context

Read this before doing any work. It covers the full architecture, conventions,
and rules that apply to every task.

---

## What this app is

Contour is a music ratings and streaming analytics platform. Core ideas:
- Users rate albums/tracks (half-star, 0.5–5.0), write reviews, follow each other
- Era-adjusted streaming: a 2012 album's streams are normalized against Spotify's
  MAU at the time, so old and new releases can be compared fairly
- Charts page: albums ranked by Era Score (era-adjusted stream count)
- For You feed: TikTok-style personalized track discovery
- Comparison: side-by-side streaming trajectory charts for any two albums/tracks

Live at: https://contour-rosy.vercel.app

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
  main.py                  FastAPI app entry point, startup seeder, /health endpoint
  models.py                SQLAlchemy ORM models
  database.py              Async engine (SQLite locally, Postgres in prod)
  routers/
    auth.py                Google OAuth + JWT
    albums.py              Album metadata, stream trajectory, enrichment
    tracks.py              Track metadata, stream trajectory
    artists.py             Artist pages
    ratings.py             Ratings, reviews, votes, replies
    reviews.py             Global reviews feed
    feed.py                Following activity feed
    featured.py            Trending + new releases
    users.py               Public profiles, follow/unfollow
    comparison.py          Side-by-side trajectory comparison
    saved_comparisons.py   Shareable comparison links
    lists.py               User-created ranked/unranked lists
    leaderboard.py         Era-adjusted charts + /leaderboard/debug
    notifications.py       Follow/review notifications
    discover.py            Personalized For You feed + /discover/debug
    taste.py               Server-side taste profile
  services/
    spotify.py             Spotify API client (hot calls Redis-cached 24h)
    lastfm.py              Last.fm API — lifetime scrobbles for leaderboard seeding
    kworb.py               Kworb scraper — ARTIST PAGES ONLY (entity pages blocked on Railway)
    stream_anchors.py      Wayback anchor store for trajectory calibration
    wayback.py             Wayback Machine client
    normalization.py       MAU table, era-adjustment, trajectory decay model
    album_cache.py         DB-backed enrichment state machine
    redis_cache.py         Async Redis helper (no-op when REDIS_URL absent)
    deezer.py              Deezer preview fallback
    limiter.py             slowapi rate limiter

frontend/
  src/
    pages/                 One file per route
    components/            Shared UI components
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
- Last.fm → primary source for leaderboard stream counts
- Wayback Machine → trajectory anchor points (one-time fetch per entity)

### Frontend conventions
- React functional components only, no class components
- All API calls go through `services/api.js` — never call fetch/axios directly in a component
- Recharts for all charts
- No external UI libraries (no MUI, no Chakra) — plain CSS-in-JS style objects

### Branch rules
- Work on `develop` only
- Open PRs to `master` — never push directly to `master`
- Bugs: fix on `develop`, open PR immediately
- Features: build on `develop`, open PR when complete

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
