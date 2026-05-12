# Operations — Service Inventory + Runbooks

Single place to find:
1. **Every external service Contour depends on** — what it costs, what to monitor, when it renews.
2. **Runbooks for things that span systems** — domain migration, key rotation, credential loss recovery.

Last updated: 2026-05-12. Keep this file current whenever you sign up for, cancel, or upgrade a service.

---

## Service inventory

Format: **Service** — what it does | cost | renewal | what to watch | where the config lives.

### Hosting / infrastructure

| Service | What it does | Cost | Renewal | Watch | Config |
|---|---|---|---|---|---|
| **Vercel** — Hobby plan | Hosts the React frontend at `contour-rosy.vercel.app`. Auto-deploys every push to `master`. | $0 | N/A | Build minutes (100/day free), bandwidth (100 GB/mo free), Web Analytics events (2,500/day free). Upgrade at 80% of any. | vercel.com dashboard → Contour project → Settings + Environment Variables. |
| **Railway** — Pay-as-you-go | Hosts the FastAPI backend + Postgres + Redis at `contour-production.up.railway.app`. Auto-deploys on `master` push. Migrations run automatically. | $5 trial credit, then ~$5–20/month at launch traffic | Monthly billing | Monthly usage in Railway → Usage tab. Postgres disk growth (250 MB free tier; not currently a concern). Spotify circuit breaker open time (via `/health`). | railway.app dashboard → Contour project → Variables tab. |
| **Codemagic** — Free tier | macOS build farm for iOS Capacitor builds. Triggered by git push, outputs `.ipa` for TestFlight upload. | $0 | N/A | Build minutes used per month (500 free, ~10 min per iOS build → ~50 builds free). | codemagic.io dashboard → Contour app → Workflows + Environment Variables. |
| **GitHub** — Public repo | Source of truth. Triggers Vercel + Railway + Codemagic deploys. | $0 | N/A | Nothing specific. | github.com/peytonhl/contour |

### Auth / identity

| Service | What it does | Cost | Renewal | Watch | Config |
|---|---|---|---|---|---|
| **Google Cloud OAuth 2.0** | Google sign-in. Validates ID tokens, redirects to `/auth/success`. | $0 | N/A | Google API quota (very high for OAuth, won't hit it at launch scale). Verify the OAuth consent screen stays "in production" status. | console.cloud.google.com → Contour project → APIs & Services → Credentials. |
| **Apple Developer Program** | iOS App Store distribution + Sign in with Apple + MusicKit + Push Notifications capability. | **$99/year** | ~mid-May 2027 (set calendar reminder for ~April 2027) | **Calendar reminder for renewal — auto-renew may already be on; verify in Membership Details.** Lapsed membership pulls every Apple-built app from the App Store. | developer.apple.com → Account → Membership Details. |
| **Apple Sign-in Services ID** (`com.peytonhl.contour.signin`) | Web Sign in with Apple flow. Validates Domains + Return URLs. | $0 (covered by Apple Dev Program) | N/A | Domain configured matches the live frontend URL — see Domain Migration runbook if you ever change it. | developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → Services IDs. |
| **Google Play Console** | Android distribution (Play Store). **Not yet paid.** | **$25 one-time** | One-time, no renewal | Pay before submitting. | play.google.com/console |

### Music data APIs

| Service | What it does | Cost | Renewal | Watch | Config |
|---|---|---|---|---|---|
| **Spotify Web API** | Album/track/artist metadata. Powers most page content. | $0 (free tier, no Extended Access) | N/A | **Rate limiting is the #1 production issue** — circuit breaker exposed at `/health.spotify.circuit_open`. Open = blocked. Long breaker durations (hours) mean Spotify has flagged your IP/credentials. | `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` on Railway. App registered at developer.spotify.com/dashboard. |
| **Apple Music Catalog API** | Apple Music deep links (album/track ID matching). | $0 (covered by Apple Dev Program) | N/A | `/apple-music/debug` returns token-minting status. If `token_minted: false` or `apple_test_status` ≠ 200, the .p8 / Team ID / Key ID is wrong on Railway. | `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY` on Railway. |
| **Last.fm API** | Lifetime scrobble counts (leaderboard data). | $0 with API key | N/A | Nothing usually — Last.fm is reliable. `/health.lastfm.key_set` confirms env var is set. | `LASTFM_API_KEY` on Railway. Key at last.fm/api/account/create. |
| **Deezer API** | Fallback For You preview tracks (no API key required). | $0 | N/A | `/discover/debug` shows tier health. | No config needed; public API. |
| **Kworb.net** | Scraped artist-page stream counts. | $0 (public scraping) | N/A | `/health.kworb_artist` returns success/count. `kworb_entity` is currently blocked from Railway IP — known and documented. | `backend/services/kworb.py`. |
| **Wayback Machine** | Historical stream-count snapshots for trajectory calibration. | $0 | N/A | Rarely fails. | `backend/services/wayback.py`. |

### Analytics / observability

| Service | What it does | Cost | Renewal | Watch | Config |
|---|---|---|---|---|---|
| **PostHog** — free tier | Product analytics: named events (`rating_submitted`, `era_adjustment_viewed`, etc.), autocapture, identity tracking. | $0 up to **1M events/month** | Monthly soft cap | Settings → Billing → "Events this month." At 80%, decide: cap autocapture or upgrade. Web traffic at launch shouldn't come close. | `VITE_POSTHOG_KEY` on Vercel. Project at app.posthog.com. |
| **Vercel Web Analytics** | Pageviews + visitor stats. | $0 (Hobby plan: ~2.5K events/day, 30-day retention) | N/A | Same console as Vercel hosting. If you ever blow through events, downgrade or upgrade. | Toggled on in vercel.com → Contour → Analytics. |

### Local-only secrets (no service, but inventory-critical)

| Item | Where it lives | If lost |
|---|---|---|
| **Android release keystore** (`contour-release.keystore`) | `C:\Users\peytonhl\Secrets\` + hard-drive backup + Gmail backup | **Cannot recover.** Must republish app at a new `applicationId`, losing all installs/reviews. |
| Keystore password | Same locations as the keystore file | Same — can't unlock keystore without it. |
| Sign-in-with-Apple .p8 | `C:\Users\peytonhl\Secrets\AuthKey_N8XMJRY4GH.p8` | Recoverable — revoke key in Apple portal, generate new one, update Railway env vars. App Store doesn't break. |
| MusicKit .p8 | `C:\Users\peytonhl\Secrets\AuthKey_GGQAY4K9PC.p8` | Same — revoke + regenerate + update env vars. Apple Music deep links break briefly during swap. |

---

## Monitoring checklist

Run through this monthly (or whenever something feels off). Most are 30-second checks.

### Health
- [ ] `curl https://contour-production.up.railway.app/health` returns `status: ok` and no `circuit_open: true` on Spotify.
- [ ] PostHog → Activity tab shows live events when you click around the site.
- [ ] Vercel dashboard shows recent deploys all green.
- [ ] Railway dashboard shows backend service "Active," no crash-loop.

### Subscriptions / billing
- [ ] **Apple Developer Program** — verify auto-renew status (Membership Details). Set a calendar reminder for **April 2027** if you haven't yet.
- [ ] **Railway** — Usage tab; if monthly cost is creeping up, check what's eating compute.
- [ ] **PostHog** — Settings → Billing — % of monthly event quota used.
- [ ] **Vercel** — Settings → Usage — % of bandwidth + build minutes used.
- [ ] **Codemagic** — Account → Usage — build minutes used.
- [ ] **Domain registrar** (if/when you have one) — auto-renew on, payment method current.

### Security
- [ ] Hard-drive backup ran successfully this month and includes `C:\Users\peytonhl\Secrets\`.
- [ ] Gmail backup of keystore + Apple .p8 files still accessible (open the labeled email, attempt to download the attachment).
- [ ] No alerts in Google Cloud Console (Security tab) — would catch OAuth credential misuse.

### App stores (when live)
- [ ] Play Console → Crashes & ANRs — no spike.
- [ ] App Store Connect → App Analytics — no review-rejection blocker pending.

---

## Domain migration runbook

If you replace `contour-rosy.vercel.app` with a custom domain (`contour.app`, `contour.fm`, etc.), here's the complete list of places it needs to be updated. Doing all of these in one focused session takes ~30 min — partial updates leave the app half-broken.

**Naming for this runbook:**
- `OLD_FRONTEND = contour-rosy.vercel.app`
- `NEW_FRONTEND = your-new-domain.com` (example)
- `OLD_BACKEND = contour-production.up.railway.app`
- `NEW_BACKEND = api.your-new-domain.com` (optional — backend can keep the Railway-default URL)

### Step 1 — DNS + cert provisioning (5 min)

- [ ] Buy the domain at any registrar (Cloudflare, Namecheap, Google Domains; Cloudflare is cheapest for `.com`).
- [ ] **Vercel** → Project → Settings → **Domains** → Add `NEW_FRONTEND`. Vercel gives you a CNAME / A record to point at it from your registrar.
- [ ] **Railway** (if also branding backend) → backend service → Settings → **Custom Domains** → add `NEW_BACKEND`. Railway gives you another CNAME.
- [ ] Set DNS records at your registrar. Wait ~5–30 min for DNS to propagate and Vercel/Railway to auto-provision TLS certs (Let's Encrypt).
- [ ] Confirm `https://NEW_FRONTEND` loads the app and `https://NEW_BACKEND/health` returns ok.

The old `*.vercel.app` and `*.up.railway.app` URLs **keep working** — they're aliases. You can swap CORS / OAuth configs without breaking the live site in the meantime.

### Step 2 — Backend env vars on Railway (2 min)

- [ ] Update `FRONTEND_URL` from `https://OLD_FRONTEND` → `https://NEW_FRONTEND`. Used by `/auth/callback` to build the redirect URL after Google sign-in.

### Step 3 — Frontend env var on Vercel (2 min — only if backend domain changes)

- [ ] If `NEW_BACKEND` is set, update `VITE_API_URL` from `https://OLD_BACKEND` → `https://NEW_BACKEND`.
- [ ] Trigger a Vercel redeploy (env var changes don't auto-rebuild Vite-baked vars).

### Step 4 — Code references (3 files, 5 min)

Search for `contour-rosy.vercel.app` across the repo. As of this writing it appears in:

- [ ] `backend/main.py` — CORS `allow_origins` list. Add the new domain (keep the old one for a transition window if you want, or replace).
- [ ] `backend/services/kworb.py` — `User-Agent` string. Replace.
- [ ] `backend/services/wayback.py` — `User-Agent` string. Replace.

Commit + push; Railway redeploys.

### Step 5 — External service configs (10 min)

These are clicks in third-party dashboards, not git changes.

- [ ] **Google Cloud OAuth 2.0** → APIs & Services → Credentials → Web client → **Authorized redirect URIs.** Add `https://NEW_BACKEND/auth/callback`. (Backend URL, not frontend, since Google redirects back to the backend.)
- [ ] **Apple Developer portal** → Identifiers → Services IDs → `com.peytonhl.contour.signin` → **Sign in with Apple → Configure:**
  - **Domains and Subdomains:** add `NEW_FRONTEND`. Remove the old one *after* the new is verified.
  - **Return URLs:** add `https://NEW_FRONTEND/auth/success`. Remove old.
  - May trigger Apple's "host a verification file" challenge — see Apple's prompts; usually they verify via DNS automatically.
- [ ] **PostHog** → Settings → Project → **Toolbar Authorized URLs / CORS** — add the new domain if you restricted CORS (default is unrestricted; you may not have touched this).
- [ ] **Vercel Web Analytics** — picks up the new domain automatically since it's the same project. No action needed.

### Step 6 — Documentation sweep (5 min)

Find/replace `contour-rosy.vercel.app` → `NEW_FRONTEND` across:

- [ ] `CLAUDE.md`
- [ ] `README.md`
- [ ] `APP_STORE.md`
- [ ] `PLAY_STORE.md`
- [ ] `TODO_PEYTON.md`
- [ ] `OBSERVABILITY.md`
- [ ] This file (`OPERATIONS.md`)

Same for `contour-production.up.railway.app` → `NEW_BACKEND` if backend also moved.

### Step 7 — App store metadata (only if already submitted)

- [ ] **Play Console** → App content → Website. Change to new domain.
- [ ] **App Store Connect** → App Information → Marketing URL / Support URL. Change to new domain.
- [ ] Re-submit listing for review if either store flagged a metadata change.

### Step 8 — Things you do NOT need to change

For clarity, what survives a domain change unchanged:

- **Bundle IDs / appIds:** `com.peytonhl.contour` is independent of the web domain. iOS + Android keep working.
- **Apple Music / MusicKit configuration:** Team ID, Key IDs, .p8 files, Media ID. All domain-agnostic.
- **Android signing keystore:** independent of any domain.
- **Spotify / Last.fm / Deezer API keys:** independent.
- **The Sign in with Apple .p8 key** — only the *Services ID* changes its associated domain. The key itself stays valid.
- **PostHog Project API key (`phc_...`):** project-scoped, not domain-scoped.

### Verification after migration

- [ ] Hard-refresh `https://NEW_FRONTEND/` in an incognito window. Page renders, no console errors.
- [ ] Sign in with Google. Round-trip lands you back at the new domain, logged in.
- [ ] Sign in with Apple (once Services ID re-config propagates — can take 5 min). Same expectation.
- [ ] Open an album page. Apple Music ↗ + Spotify ↗ links work, no CORS errors in console.
- [ ] PostHog → Activity tab shows events from the new domain (URLs in the event detail).

If anything fails, the old domain still works as an alias — fall back to it while you debug the misconfigured external service.

---

## Why this file exists

Two reasons. First, paid services have renewal dates and free tiers have ceilings, and forgetting either of them is the easiest way to wake up to an outage that's actually your bill. Second, when something spans multiple systems (a domain change touches Vercel + Railway + Apple + Google + 3 code files + 6 docs), having the full checklist in one place is the difference between "30-minute focused migration" and "half-week of half-broken stuff."

Add to this file as Contour grows. Anything you sign up for, anything that renews, anything that touches more than two systems when it changes — it belongs here.
