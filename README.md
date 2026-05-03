# Normalized Album Comparison Tool — Music IMDb MVP

Compare any two albums' streaming trajectories on a normalized, apples-to-apples chart. Stream counts are divided by Spotify's total monthly active users at the time, so a 2015 album and a 2025 album can be meaningfully compared despite the platform growing ~10× in between.

## Live Demo Default

JID — *The Forever Story* (2022) vs. *God Does Like Ugly* (2024, all editions aggregated)

---

## Features

- **Search** any two albums by artist + album name
- **Overlaid line chart** with both trajectories anchored to day 0 (release date)
- **Toggle** between raw stream count and normalized view (streams per MAU)
- **RIAA certification milestones** annotated on the chart
- **Album summary cards**: release date, label, total streams, peak chart position, RIAA certification

---

## Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Frontend   | React + Vite                        |
| Charting   | Recharts                            |
| Backend    | Python 3.11+ / FastAPI              |
| Storage    | SQLite (dev) — schema-ready for Postgres |
| Data       | Spotify Web API, MusicBrainz, Kworb.net (scrape), RIAA public database |

---

## Data Strategy

Exact day-by-day historical stream counts are not publicly available without a Luminate license. This tool approximates trajectories using:

1. **Release date** (day 0) from Spotify / MusicBrainz
2. **Current total stream count** scraped from Kworb.net as the known endpoint
3. **Modeled curve**: a streaming decay curve (high early velocity tapering to catalog tail) interpolated from day 0 → today

A disclaimer is displayed on the chart whenever modeled data is shown.

---

## Normalization Baseline

Spotify MAU by year (from public annual reports):

| Year | MAU  |
|------|------|
| 2015 | 75M  |
| 2016 | 100M |
| 2017 | 140M |
| 2018 | 191M |
| 2019 | 232M |
| 2020 | 345M |
| 2021 | 406M |
| 2022 | 456M |
| 2023 | 602M |
| 2024 | 678M |
| 2025 | 750M (estimate) |

Monthly values are linearly interpolated between annual figures.

---

## Setup

### Prerequisites
- Node.js 18+
- Python 3.11+
- A Spotify Developer account ([create app here](https://developer.spotify.com/dashboard))

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example .env    # fill in SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`, proxies API calls to `http://localhost:8000`.

---

## Environment Variables

See [.env.example](.env.example). Required:

| Variable                 | Description                          |
|--------------------------|--------------------------------------|
| `SPOTIFY_CLIENT_ID`      | From Spotify Developer Dashboard     |
| `SPOTIFY_CLIENT_SECRET`  | From Spotify Developer Dashboard     |

---

## Known Limitations

- **Stream trajectory is modeled, not actual historical data.** True day-by-day counts require Luminate licensing (v2 roadmap item).
- **Pre-2015 albums are not supported in v1.** The streaming era begins in earnest at 2015; earlier releases lack reliable MAU baselines. Future support planned using sales and radio data as a proxy index.
- **Normalization is Spotify-only.** Apple Music, Tidal, Amazon Music, and YouTube are not factored in.
- **GDLU version fragmentation.** *God Does Like Ugly* has standard, alternate, and preluxe editions on Spotify. The tool aggregates all into one combined stream count, with a toggle to view editions individually.
- **Kworb scraping is best-effort.** Kworb.net may change structure; a scrape failure falls back to Spotify popularity signal with a UI warning.

---

## Roadmap

### v2
- True historical stream data via Luminate API integration
- Multi-album comparison (beyond two)
- Cross-platform normalization (Apple Music, YouTube)

### v3
- Pre-2015 era support using sales + radio proxy index
- User accounts and saved comparisons

---

## Architecture

```
frontend/          React + Vite SPA
backend/
  main.py          FastAPI app entry point
  database.py      SQLite connection + schema
  models.py        SQLAlchemy ORM models
  routers/
    albums.py      Album search, metadata endpoints
    comparison.py  Trajectory modeling + normalization
  services/
    spotify.py     Spotify Web API client
    musicbrainz.py MusicBrainz lookup
    kworb.py       Kworb.net scraper
    normalization.py  MAU interpolation + curve modeling
  data/
    spotify_mau.py Hardcoded MAU table
```
