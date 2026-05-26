---
name: deploy-verify
description: Verify a Contour deploy is actually live and healthy in production after a push to master. Use after any merge/push to master, when the user asks "did that ship", "is it live", "is it deployed", or when wrapping up a backend change. Hits the standard observability endpoints + a representative OG endpoint header check.
allowed-tools: Bash(curl:*), Bash(gh:*)
---

A deploy verification has been requested. Run the standard battery and report what's healthy / what isn't. Do not declare success on "build passed + deploy green" alone — those are infrastructure checks, not behavior checks (see `feedback_test_what_you_push`).

## Run these (in parallel where possible)

```
curl -sS https://contour-production.up.railway.app/health
curl -sS https://contour-production.up.railway.app/leaderboard/debug
curl -sS https://contour-production.up.railway.app/discover/debug
curl -sS https://contour-production.up.railway.app/discover/cache-stats
curl -sS "https://contour-production.up.railway.app/discover/feed?limit=2"
curl -I https://contour-rosy.vercel.app/api/og/review?score=4.5
```

Pretty-print the JSON responses. Flag anything that looks off:
- `/health` should be 200 with all dependency checks passing
- `/leaderboard/debug` should show non-zero album counts and a working Last.fm probe
- `/discover/debug` should show all tiers healthy
- `/discover/cache-stats` — check the `circuit_breaker` key. If `spotify:circuit_open_until` has a non-zero TTL, Spotify is in a rate-limit cooldown. **Do not redeploy to "reset" it** — the deadline is Redis-persistent and survives restarts. Just report the remaining time.
- **`/discover/feed?limit=2` MUST be hit, not just `/discover/debug`.** `/discover/debug` probes the underlying tier components in isolation, so it stays green even when the `/feed` handler itself is broken. The 2026-05-25 NameError incident (commit 132be7d) is the canary: `/health` and `/discover/debug` were both 200 while every actual `/feed` call returned 500 for ~30 minutes because a new variable reference was placed before its assignment. **`/feed` is the real behavior check** — verify a 200 + a non-empty JSON list before declaring `discover.py` changes verified. See `feedback_test_what_you_push`.
- The OG endpoint should return `200` + `Content-Type: image/png`. A `404` + `X-Vercel-Error: NOT_FOUND` means the function didn't register (likely a `.jsx` typo or missing tsconfig).

## Backend test discipline

When any file under `backend/` changed (any handler, any model, any service),
**run pytest before declaring the deploy verified**. The 2026-05-26 incident:
the pagination shape change in `routers/reviews.py` (commit 7145cf2) broke
`tests/test_moderation.py` for five consecutive commits because I kept
trusting "frontend build passed + curl returns 200" instead of running the
backend test suite.

```
cd backend && python -m pytest -q
```

If pytest isn't runnable locally (Python version drift, etc.), the CI run
on the push is the authoritative signal — but treat it as a blocker, not
a "should be fine" assumption.

## Per-change-area extra checks

When the touched files include a particular handler, also exercise its
public surface — debug probes aren't enough.

| If you touched | Also curl |
|---|---|
| `backend/routers/discover.py` | `/discover/feed?limit=2` AND `/discover/feed?genres=hip-hop&limit=2` AND `/discover/feed?genre_browse=jazz&limit=2` (covers cold-start, personalized fallback, and browse-mode code paths) |
| `backend/routers/reviews.py` | `/reviews/global?limit=2` (confirms paginated `{items, has_more}` shape) |
| `backend/routers/featured.py` | `/featured` (confirms 200 + non-empty `new_releases` / `top_tracks`) |
| `frontend/api/og/*.tsx` | `curl -I` the specific endpoint AND fetch the PNG (`curl -o /tmp/card.png` + Read it) per `og-iterate` skill |
| `backend/routers/ratings.py` | rate a known track (requires auth — skip if not feasible) OR at minimum `/ratings/global/recent?limit=1` |

## Vercel deploy status (if frontend changed)

```
gh run list --limit 3
```
Also worth checking `git log origin/master -1 --oneline` matches what's expected to be live, and confirming Vercel didn't dedupe the deploy by SHA (see `feedback_vercel_dedup`).

## If anything's not green

Diagnose root cause. Do not auto-redeploy as a "shake it out" attempt — see the circuit-breaker note above. If Spotify is in cooldown, the right answer is to wait, not to restart.
