# Contour — Observability Guide

## Health & Debug Endpoints

### `/health` — overall system status
**Monitor this one.** Returns `200 OK` when all critical dependencies are up,
`503 Degraded` if anything critical is down.

```
GET https://contour-production.up.railway.app/health
```

```json
{
  "status": "ok",
  "checks": {
    "database":    { "ok": true,  "latency_ms": 4 },
    "spotify":     { "ok": true,  "latency_ms": 180 },
    "lastfm":      { "ok": true,  "key_set": true },
    "redis":       { "ok": false, "note": "not configured — caching disabled" },
    "leaderboard": { "ok": true,  "eligible_albums": 50 }
  }
}
```

| Check | Critical? | What breaks if it fails |
|---|---|---|
| `database` | ✅ Yes | Everything — ratings, reviews, feed |
| `spotify` | ✅ Yes | Search, For You feed, album pages |
| `lastfm` | No | Leaderboard won't seed new data |
| `redis` | No | Feed is slower (live Spotify calls every request) |
| `leaderboard` | No | Charts page shows empty |

**Railway monitoring:** Railway → your backend service → Settings → Health Check Path → set to `/health`. Railway will alert you if it returns non-200.

---

### `/leaderboard/debug` — charts data status
```
GET https://contour-production.up.railway.app/leaderboard/debug
```

```json
{
  "album_cache_counts": { "done": 50, "failed": 4, "pending": 0 },
  "leaderboard_eligible": 50,
  "lastfm_api_key_set": true,
  "lastfm_test": {
    "query": "Taylor Swift / 1989",
    "playcount": 62182913,
    "working": true
  }
}
```

**What to look for:**
- `pending > 0` for a long time → seeder is stuck mid-run, check Deploy Logs
- `leaderboard_eligible == 0` → enrichment is failing entirely; check `lastfm_test.working`
- `lastfm_test.working == false` → API key is wrong or Last.fm is down
- `failed` count growing → albums the seeder can't match on Last.fm (normal for very new/obscure releases)

---

### `/discover/debug` — For You feed health
```
GET https://contour-production.up.railway.app/discover/debug
```

```json
{
  "status": "ok",
  "tiers": {
    "spotify_auth":       { "ok": true,  "latency_ms": 45 },
    "tier3_global_top50": { "ok": true,  "track_count": 50, "with_preview": 12, "latency_ms": 310 },
    "tier4_new_releases": { "ok": true,  "album_count": 10, "latency_ms": 280 },
    "tier2_genre_search": { "ok": true,  "track_count": 10, "latency_ms": 220 },
    "redis":              { "ok": false, "note": "not configured — every feed request hits Spotify directly" }
  }
}
```

**What to look for:**
- `spotify_auth.ok == false` → Spotify credentials are invalid or expired; the entire feed is broken
- Any tier `ok == false` → that tier is returning nothing; feed degrades to lower tiers
- `with_preview` low on tier3 → Spotify has deprecated preview URLs for most tracks (known issue; Deezer fills in)
- `redis.ok == false` + high `latency_ms` on tiers → no cache, every user triggers live API calls

---

## Deploy Logs (Railway)

Railway → your backend service → **Deploy Logs** tab.

All Python `logger.*` calls appear here. Filter by keyword to find relevant lines.

### Key log patterns

#### Startup & migrations
```
INFO  alembic.runtime.migration: Running upgrade ...
INFO  root: Alembic migrations applied successfully.
```

#### Leaderboard seeder (runs 60s after boot, then every 24h)
```
INFO  root: Seed phase1: 28 album IDs from Global Top 50
INFO  root: Seed phase1: 38 album IDs after new releases
INFO  root: Seed/hits: ✓ After Hours — 45,123,456 plays
INFO  root: Seed phase1: complete — 18/38 with play data
INFO  root: Seed phase2: searching catalog (57 entries)…
INFO  root: Seed/catalog: ✓ folklore — 89,234,567 plays
INFO  root: Seed phase2: complete — 52/57 with play data
INFO  root: Seed: next refresh in 24 h
```

**Abnormal patterns:**
```
WARNING  root: Seed phase1: top tracks failed — ...   ← Spotify API down
WARNING  root: Seed: skipped 3T4tU... — ...           ← single album failed (usually fine)
```

#### For You feed (every user request)
```
INFO  routers.discover: discover: returning 10 tracks (rated_excluded=5, genres=['pop'], artists=['1Xyo...'])
```

**Abnormal:**
```
ERROR  routers.discover: discover: all tiers failed — returning empty feed
```
→ Spotify API is completely unreachable.

#### Album page enrichment (triggered by user visits)
```
INFO  routers.albums: enrichment: lastfm  folklore — 89,234,567
INFO  routers.albums: enrichment: kworb   folklore — 91,000,000
```

#### Redis cache
```
INFO  services.redis_cache: Redis cache connected.
WARNING  services.redis_cache: Redis unavailable — caching disabled: ...
```

---

## Alerting Setup (Railway)

1. Railway → your backend service → **Settings** → **Health Check**
   - Path: `/health`
   - Timeout: 10s

2. Railway → **Notifications** → connect Slack or email
   - You'll get alerted when `/health` returns non-200 or the service crashes

This catches: DB down, Spotify credentials expired, service crash.

---

## What Isn't Instrumented Yet

| Area | Gap | Impact |
|---|---|---|
| Taste profile saves | Silent failure on high-star ratings | Personalization degrades without user knowing |
| Deezer preview enrichment | No success rate logged | Can't tell what % of tracks have no preview |
| Rate limit hits | slowapi blocks requests but doesn't log which users/IPs | Hard to detect abuse |
| Feed tier hit rates | Per-request logs exist but no aggregate stats | Can't see which tiers are being relied on most |
