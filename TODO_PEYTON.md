# Things Peyton Needs To Do

Self-contained checklist of every external dependency, account, asset, or
credential I (Claude) can't produce. Grouped by what's blocking what.

Date: 2026-05-11

---

## Blocking nothing — do whenever

### Accounts & analytics
- [ ] **PostHog account.** posthog.com → free tier → create a project →
      Settings → Project → copy "Project API key" (starts with `phc_`).
- [ ] **Vercel: add `VITE_POSTHOG_KEY=phc_...` env var** for all environments.
      Vercel auto-redeploys. Events start flowing.
- [ ] **Vercel Web Analytics:** dashboard → Analytics tab → enable. One toggle, free.

### Make yourself an admin (one-time, after the moderation deploy lands)
The new migration adds `users.is_admin` defaulting to `false`. Flip it on
your own row so you can see the Admin link in the top nav and access
`/admin/reports`:

```sql
-- Railway → your Postgres → Query tab
UPDATE users SET is_admin = TRUE WHERE email = 'peyton2117@gmail.com';
```

Verify by reloading the app — an "Admin" link appears in the desktop top
nav, and `/admin/reports` returns the moderation queue (empty for now).

---

## Blocking Sign in with Apple activation

- [ ] **Apple Developer Program membership** ($99/yr) — developer.apple.com.
- [ ] In Apple Developer portal → Certificates, Identifiers & Profiles → Identifiers → "+"
  - [ ] Create an **App ID** with bundle ID `com.peytonhl.contour`. Capability:
        Sign in with Apple. Capability: (later) Push Notifications, leave off for v1.
  - [ ] Create a **Services ID** (e.g. `com.peytonhl.contour.signin`). Configure
        domain `contour-rosy.vercel.app` and redirect URL `https://contour-rosy.vercel.app/auth/success`.
  - [ ] Create a **Sign in with Apple key** under Keys → "+". Download the .p8
        file (it can only be downloaded once — save it). Note the Key ID.
- [ ] **Railway env var:** `APPLE_CLIENT_ID=com.peytonhl.contour.signin`
- [ ] **Vercel env var:** `VITE_APPLE_CLIENT_ID=com.peytonhl.contour.signin`

Once both env vars are set, the Apple button appears on both desktop and
mobile, and `/auth/apple` accepts requests. 10 backend tests already cover
the linking + token-validation edge cases.

---

## Blocking Apple Music deep links activation

Same Apple Developer account as above.

- [ ] In Apple Developer portal → Keys → "+":
  - [ ] Create a **MusicKit key**. Download the .p8 file (one-time download).
        Note the Key ID and Team ID.
- [ ] **Railway env vars:**
  - `APPLE_MUSIC_TEAM_ID=...` (10-char alphanumeric — found in Membership page)
  - `APPLE_MUSIC_KEY_ID=...` (10-char alphanumeric from the MusicKit key)
  - `APPLE_MUSIC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"`
    (paste the .p8 contents; literal `\n` newlines are fine — the service
    decodes them)

Once those are set, album/track pages start showing "Apple Music ↗" pills
next to "Spotify ↗" whenever a match exists.

---

## Blocking Play Store launch

- [ ] **Android Studio + JDK 17** installed locally. Bundled JDK is fine.
- [ ] Run once on your machine to scaffold the Android project:
      `cd frontend && npx cap add android`. This creates `frontend/android/`.
- [ ] **Generate the signing keystore** — full `keytool` command in [PLAY_STORE.md](PLAY_STORE.md) §3.
      Store the keystore somewhere outside the repo (1Password recommended).
      **Do not lose it** — losing it means a new appId, losing all reviews.
- [ ] **Privacy Policy page** at https://contour-rosy.vercel.app/privacy
      (route exists — content needs writing). Required for Play Store, App
      Store, and Apple Music API ToS.
- [ ] **Terms of Service page.** Required for Play Store + App Store.
- [ ] **Graphics** — Section A item 6:
  - [ ] App icon: 512 × 512 PNG (master). Android Studio's Image Asset
        wizard generates the per-density variants.
  - [ ] Feature graphic: 1024 × 500 PNG (Play Console banner).
  - [ ] Screenshots: ≥2 phone screenshots, recommend 4–8 (Feed, For You,
        Album page, Compare).
- [ ] **Google Play Console account** ($25 one-time).
- [ ] Build the AAB and upload to internal testing track — full sequence in
      [PLAY_STORE.md](PLAY_STORE.md).

---

## Blocking App Store launch

- [ ] All Apple Developer items above (Sign in with Apple key + Apple Music key + Team ID).
- [ ] **Xcode 15+** installed on a Mac. CocoaPods (`sudo gem install cocoapods`).
- [ ] Run once on your Mac: `cd frontend && npx cap add ios`.
- [ ] **Graphics for iOS:**
  - [ ] App icon master at 1024 × 1024. Xcode auto-generates the rest.
  - [ ] Screenshots at three sizes: 6.7", 6.5", 5.5" (≥3 each).
- [ ] **Native Sign in with Apple plugin (hard blocker — see [APP_STORE.md](APP_STORE.md) top-of-doc).**
      Need to ask me to add `@capacitor-community/apple-sign-in` and branch
      on `Capacitor.isNativePlatform()`. ~30 min of work. Without this, Apple
      reviewers will likely reject the build under Guideline 4.8.
- [x] **UGC reporting + user blocking** — shipped. One less Guideline 1.2 risk.

---

## Required to test things I can't test from here

- [ ] **Verify mobile UX on a real iPhone:**
  - For You scroll smoothness (TikTok-style snap)
  - Search results vs. keyboard interplay (typing while keyboard is open)
  - Album/track page padding after the Task 3 tightening
- [ ] **Verify Railway migration logs** for the two recent migrations:
      `i9j0k1l2m3n4_add_apple_sub` (Task 5) and `j0k1l2m3n4o5_apple_music_links`
      (Task 4). Should be no-op after they ran once.
- [ ] After PostHog activation: confirm events appear in PostHog dashboard
      (try a rating, a review, opening the era-adjustment popover).

---

## Marketing / GTM

- [ ] **Draft r/musicboard launch post.** Share with the main Claude
      conversation (not Claude Code) for review before posting.
- [ ] Decide on tone for the launch — "Musicboard alternative" vs. "social
      music app." I'd lean alternative since the timing window is real.

---

## Optional, not blocking launch

- [ ] Add a contact email visible on the Privacy Policy / About page (required
      by Apple if users need to report data-rights requests).
- [ ] Set up a status page or uptime monitor (UptimeRobot free tier) pointed
      at the `/health` endpoint.
- [ ] Decide on a domain — `contour-rosy.vercel.app` works but a custom
      domain (e.g. `contour.app`) reads more legit on the App Store listing.
