# Operations — Service Inventory + Runbooks

Single place to find:
1. **Every external service Contour depends on** — what it costs, what to monitor, when it renews.
2. **Runbooks for things that span systems** — domain migration, key rotation, credential loss recovery.

Last updated: 2026-05-14. Keep this file current whenever you sign up for, cancel, or upgrade a service.

---

## Service inventory

Format: **Service** — what it does | cost | renewal | what to watch | where the config lives.

### Hosting / infrastructure

| Service | What it does | Cost | Renewal | Watch | Config |
|---|---|---|---|---|---|
| **Vercel** — Pro plan | Hosts the React frontend at `contour-rosy.vercel.app`. Auto-deploys every push to `master`. Upgraded from Hobby on **2026-05-14** after a debugging session burned through the Hobby build-minute quota in one evening. | **$20 / month** | Monthly billing | Build minutes (6000/mo Pro), bandwidth (1 TB/mo Pro), Web Analytics events. Pro removes the daily rate-limit hard cap that was the breaking issue. | vercel.com dashboard → Contour project → Settings + Environment Variables. |
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

## Push notifications

The backend ships an APNs HTTP/2 sender (`backend/services/push_sender.py`)
that fans every in-app Notification out to every device the recipient has
registered, gated by per-type user preferences. **Until the four env vars
below are set on Railway, push is silently disabled** — the in-app feed
(`/notifications`) keeps working, but no iOS device receives anything.

### One-time setup (Apple Developer Console)

1. Open developer.apple.com → Certificates, Identifiers & Profiles → **Keys**.
2. **+** → name it "Contour APNs", check **Apple Push Notifications service**
   → **Continue → Register**.
3. Download the `.p8` file. **You can only download it ONCE** — save to
   `C:\Users\peytonhl\Secrets\AuthKey_<KEY_ID>.p8` alongside the existing
   Sign in with Apple key.
4. Note the **Key ID** (10 chars, shown after registration) and your
   **Team ID** (top right of the developer portal).
5. Open the Contour App ID (com.peytonhl.contour) → Capabilities →
   confirm **Push Notifications** is checked. (Already enabled per the
   service inventory; this is just verifying.)

### Railway env vars

Paste into Railway → Contour → Variables. The private key is multi-line
— use Railway's "Raw Editor" if the regular form mangles newlines.

```
APNS_TEAM_ID       = <10-char Team ID>
APNS_KEY_ID        = <10-char Key ID from step 4 above>
APNS_BUNDLE_ID     = com.peytonhl.contour
APNS_PRIVATE_KEY   = -----BEGIN PRIVATE KEY-----
                     <contents of the .p8 file, preserving line breaks>
                     -----END PRIVATE KEY-----
APNS_USE_SANDBOX   = true   # while testing via TestFlight
                            # flip to false on App Store release
```

After saving, Railway redeploys. The startup log should NO LONGER print
`Push notifications DISABLED — missing env vars: …` — that warning is
emitted by `services/push_sender.warn_if_disabled()` on every cold boot,
so if it's still there one of the vars is wrong.

### iOS rebuild (Codemagic)

`@capacitor/push-notifications` is a new Capacitor plugin — the web JS
ships instantly via Vercel, but the native iOS shell needs to be rebuilt
so the plugin is compiled into the IPA. **Until that rebuild lands on
TestFlight, no iOS device can register a push token** (the JS-side
`PushNotifications.register()` will throw "plugin not implemented").

To trigger the rebuild:

```bash
# After the master push that adds the plugin has landed:
git tag ios-v$(date +%Y%m%d%H%M)
git push origin --tags
```

Codemagic picks up the `ios-v*` tag, builds the IPA against the current
master, and uploads to TestFlight. Watch the build at
codemagic.io → Apps → Contour. The webhook is occasionally flaky — if
no build appears within ~30s, kick it off manually from the dashboard.

After TestFlight processing finishes (~5–15 min), the new build will be
available to your testers; first-launch on it will prompt for push
permission.

### Sandbox vs production APNs

- **`APNS_USE_SANDBOX=true`** routes to `api.sandbox.push.apple.com` —
  the right environment for ANY build that came out of Xcode locally
  OR Codemagic CI builds before App Store release. TestFlight builds
  use the sandbox until the app is on the App Store.
- **`APNS_USE_SANDBOX=false`** routes to `api.push.apple.com` — flip
  this to false **simultaneously** with the App Store release. Wrong
  environment = APNs returns 400 BadDeviceToken (the token from a
  TestFlight install isn't a production token, and vice versa).

### Health probe

There's no dedicated `/notifications/health` endpoint yet (TODO). For now:

```bash
# Confirm the env vars made it onto Railway:
curl https://contour-production.up.railway.app/health
# (push status not yet exposed; check Railway logs for the
#  "Push notifications DISABLED" line at boot — its absence = good.)

# End-to-end smoke test:
#  1. Open the iOS app, grant push permission. Confirm the device_tokens
#     table has a row for your user (one-off DB query in Railway → DB tab).
#  2. From a second account, follow your account.
#  3. Within ~2s your phone should buzz with "<them> started following you".
```

### Stale-token cleanup

The push sender drops a `device_tokens` row whenever APNs returns
**410 Gone** for that token (user uninstalled the app, Apple rotated
the token, etc.). No manual cleanup needed — it's lazy / on-demand.

If you ever need to wipe all tokens (e.g. you've revoked the APNs key
and rolled to a new one):

```sql
DELETE FROM device_tokens;
```

The next app launch will re-register every active install.

---

## Deploy & update workflow

How code changes reach users. Most updates don't need a single click of human
action — push to `master` and you're done. A small minority of changes
require tagging a build. None of this is captured intuitively from the
codebase, so it lives here.

### The decision tree

```
Made a change. What deploy path applies?
│
├── Frontend code (React, CSS, page layout, new web feature)
│     → Push to master. Vercel auto-builds + deploys (~2 min).
│       Reaches web users on next page refresh.
│       Reaches iOS/Android users on next app open (live-update mode).
│       NO Codemagic involvement. NO IPA rebuild. NO Apple review.
│
├── Backend code (Python, API endpoint, DB schema)
│     → Push to master. Railway auto-builds + deploys (~3 min).
│       Migrations run automatically on startup.
│       Reaches all clients (web + iOS + Android) on next request.
│
├── Native config (Capacitor plugin added, app icon, splash screen,
│   Info.plist key, entitlement, iOS SDK / target bump)
│     → Push to master AND git tag ios-vX.Y.Z + push the tag.
│       Codemagic auto-builds (~10 min), uploads to TestFlight.
│       Reaches internal testers in minutes after upload.
│       Reaches external testers in ~24h (first build of version) or
│       minutes (subsequent builds within same version).
│
└── Documentation / non-shipped files (TODO_PEYTON.md, this file, etc.)
      → Push to master. Done — no deploy needed.
```

### What each deploy target watches

| Target | Watches | Triggered by | Build time | Reaches users when |
|---|---|---|---|---|
| **Vercel** (frontend) | `master` branch push | Any commit to master | ~1–2 min | Next page refresh / app open (live-update reaches mobile too) |
| **Railway** (backend) | `master` branch push | Any commit to master | ~2–3 min | Next API request |
| **Codemagic** (iOS IPA) | Git tags matching `ios-v*` | Tag push to GitHub | ~5–10 min | After App Store Connect upload + processing + TestFlight propagation |
| **Android local build** | Manual | You running `./gradlew bundleRelease` | ~3–5 min | After manual upload to Play Console |

### Where to verify each deploy landed

Don't just assume the deploy worked. Quick verification steps per target:

| Target | How to check |
|---|---|
| Vercel | vercel.com → Contour → Deployments tab. The latest commit should show a green "Ready" status within ~2 min. Production URL `contour-rosy.vercel.app` immediately serves the new build. |
| Railway | railway.app → Contour → Deployments tab. Latest should show "Active." Then `curl https://contour-production.up.railway.app/health` returns ok. |
| Codemagic | codemagic.io → Apps → Contour → Builds. A new entry for your tag should appear within ~30s of the tag push (sometimes the webhook is flaky; see fallback below). |
| App Store Connect (after Codemagic) | appstoreconnect.apple.com → Contour Music → TestFlight → iOS Builds. New build appears as "Processing" then "Ready to Test" within ~10 min of Codemagic finishing. |

### The Codemagic webhook fallback (intermittent)

Codemagic's GitHub webhook **usually** fires within ~30 seconds of a tag
push. Occasionally it silently drops the event — no error anywhere, just no
new build. If after ~2 minutes you don't see a new build in the Codemagic
dashboard:

1. Codemagic dashboard → Apps → Contour → click **"Start new build"**.
2. Select workflow `ios-release`, branch `master` (or tag `ios-vX.Y.Z` if
   the dropdown shows it), then click **Start**.
3. Same result as if the webhook had fired — Codemagic builds against
   whatever commit the branch / tag points at.

This is a rare-but-real Codemagic quirk, not a config issue on our side.
The `triggering.tag_patterns: ios-v*` rule in `codemagic.yaml` is correct.
Don't bother debugging unless it happens repeatedly within a week.

### When you actually need a new IPA rebuild

You'll find yourself NOT tagging most of the time. The architecture is
designed so that the iOS/Android binaries are effectively frozen and the
web app (which they load on every launch) carries all the iteration.

Triggers for a fresh `ios-v*` tag:

- New Capacitor plugin (e.g. adding `@capacitor/push-notifications`,
  `@capacitor-community/apple-sign-in`, `@capacitor/haptics`).
- App icon, launch / splash screen, app name.
- New entitlement (Push Notifications capability flipped on, Associated
  Domains added for Universal Links, etc.).
- New `Info.plist` key (e.g. URL scheme registration — exactly what
  prompted `ios-v0.1.11`).
- Capacitor or iOS SDK / target version bump (annual-ish).
- Native-only bug fix.

Realistic cadence during beta: **1–3 native rebuilds per month** with
near-daily web/backend deploys in between. Once production-launched and
the native shell is stable, this drops to roughly quarterly.

### When a build version actually changes

`CFBundleVersion` (the App Store build number, distinct from the
user-visible app version like "1.0") is auto-bumped by Codemagic's
`agvtool` step. It reads the latest from App Store Connect and adds 1.
You never touch this manually. Two implications:

- You can tag the same git commit multiple times (e.g. retry-build) and
  every successful upload gets a fresh, monotonic bundle version.
- The user-visible version string (`CFBundleShortVersionString` — the
  "1.0" part) only bumps when you explicitly want to communicate a
  meaningful release ("1.1 has push notifications!"). Changed via
  `agvtool new-marketing-version 1.1` if/when needed; not currently
  automated.

### Mistakes that won't happen and don't need worrying about

- **Pushing only to `develop`.** Develop never deploys anywhere. Only
  `master` triggers Vercel / Railway / (via tag) Codemagic.
- **Web change accidentally needs an iOS rebuild.** No, web changes ship
  via Vercel only. You can't accidentally trigger an iOS build by editing
  a React file.
- **Vercel deploy reaches mobile users before iOS shell catches up.** No,
  this is the entire point of live-update mode — the shell *always* loads
  the latest Vercel deploy on every launch. There's no version mismatch.
- **Tag pushed but Codemagic builds the wrong commit.** Codemagic builds
  exactly whatever the tag points at. As long as the tag exists at the
  intended commit (verify with `git ls-remote --tags origin`), the build
  is correct.

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
