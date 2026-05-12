# Things Peyton Needs To Do

Self-contained checklist of every external dependency, account, asset, or
credential I (Claude) can't produce. Grouped by what's blocking what.

Last updated: 2026-05-12

---

## ✅ Recently done / no action needed

- [x] PostHog account created, project provisioned with Product Analytics +
      Web Analytics + Session Replay (Session Replay enabled at project level
      but not wired client-side — see "Optional follow-ups" below).
- [x] `VITE_POSTHOG_KEY` set in Vercel, events confirmed flowing (saw own
      usage in PostHog).
- [x] Vercel Web Analytics framework toggled to "Other".
- [x] `is_admin` flag flipped on Peyton's user — Admin link in nav, moderation
      queue accessible at `/admin/reports`.
- [x] Apple Developer Program membership purchased (awaiting Apple's approval
      — usually 24–48 hours).
- [x] UGC reporting + user-blocking flows shipped.
- [x] Compare gained an optional Side C (overlay up to 3 trajectories);
      "Try these" suggestions removed.
- [x] Profile pages use the unified StatTabs design.
- [x] /feed page retired; For You is home with three tabs (For You / Friends / Community).
- [x] Era-adjustment contextualized everywhere.
- [x] Tagline updated to "Rate. Review. Discover."
- [x] Android Studio + JDK installed locally; `npx cap add android` ran cleanly.
- [x] Release signing keystore generated at
      `C:/Users/peytonhl/Secrets/contour-release.keystore`.
- [x] `frontend/android/keystore.properties` created (gitignored) so
      `./gradlew bundleRelease` can sign automatically.

---

## 🟠 Blocking Sign in with Apple activation

Required for iOS App Store (Guideline 4.8). Not blocking Play Store.

- [x] **Apple Developer Program membership** purchased — awaiting approval.
- [ ] Once approved, in Apple Developer portal → Certificates, Identifiers & Profiles → Identifiers → "+"
  - [ ] Create an **App ID** with bundle ID `com.peytonhl.contour`. Capability:
        Sign in with Apple. (Push Notifications can stay off for v1.)
  - [ ] Create a **Services ID** (e.g. `com.peytonhl.contour.signin`). Configure
        domain `contour-rosy.vercel.app` and redirect URL
        `https://contour-rosy.vercel.app/auth/success`.
  - [ ] Create a **Sign in with Apple key** under Keys → "+". Download the .p8
        file (it can only be downloaded once — save it). Note the Key ID.
- [ ] **Railway env var:** `APPLE_CLIENT_ID=com.peytonhl.contour.signin`
- [ ] **Vercel env var:** `VITE_APPLE_CLIENT_ID=com.peytonhl.contour.signin`

Once both env vars are set, the Apple button appears on desktop and mobile,
and `POST /auth/apple` accepts requests. 10 backend tests already cover the
linking + token-validation edge cases.

**⚠ Note for iOS submission:** the current button uses Apple's *web* JS lib
inside a WebView. Apple reviewers may demand the *native* flow
(`ASAuthorizationAppleIDProvider`) under Guideline 4.8. See APP_STORE.md
top-of-doc — when you're ready to ship to TestFlight, ask me to add
`@capacitor-community/apple-sign-in` (~30 min of work).

---

## 🟠 Blocking Apple Music deep links activation

Same Apple Developer account as above.

- [ ] In Apple Developer portal → Keys → "+":
  - [ ] Create a **MusicKit key**. Download the .p8 file (one-time download).
        Note the Key ID and your Team ID.
- [ ] **Railway env vars:**
  - `APPLE_MUSIC_TEAM_ID=...` (10-char alphanumeric, found on Membership page)
  - `APPLE_MUSIC_KEY_ID=...` (10-char alphanumeric from the MusicKit key)
  - `APPLE_MUSIC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"`
    (paste the .p8 contents; literal `\n` newlines are fine)

Once those are set, album/track pages start showing "Apple Music ↗" pills
next to "Spotify ↗" whenever a match exists.

---

## 🟠 Blocking Play Store launch

- [x] **Android Studio + JDK 17** installed locally.
- [x] Ran `npx cap add android`; `frontend/android/` project scaffold lives in master.
- [x] **Signing keystore generated** at `C:/Users/peytonhl/Secrets/contour-release.keystore`,
      wired to Gradle via `frontend/android/keystore.properties` (gitignored).
- [ ] **Back up the keystore + password to 1Password — and delete
      `C:/Users/peytonhl/Secrets/keystore-password.txt` afterward.** If you
      lose this file, you can never update the published app.
- [ ] **Privacy Policy page** at https://contour-rosy.vercel.app/privacy
      (route exists — content needs writing). Required for Play Store, App
      Store, and Apple Music API ToS.
- [ ] **Terms of Service page.** Required for Play Store + App Store.
- [ ] **Graphics:**
  - [ ] App icon: 512 × 512 PNG (master). Android Studio's Image Asset
        wizard generates the per-density variants.
  - [ ] Feature graphic: 1024 × 500 PNG (Play Console banner).
  - [ ] Screenshots: ≥2 phone screenshots, recommend 4–8 (Friends timeline,
        For You audio swipe, Album page, Compare with 3 sides).
- [ ] **Google Play Console account** ($25 one-time).
- [ ] Build the AAB and upload to internal testing track — full sequence in
      [PLAY_STORE.md](PLAY_STORE.md).

---

## 🟠 Blocking App Store launch

- [ ] All Apple Developer items above (Sign in with Apple key + Apple Music key + Team ID).
- [ ] **Xcode 15+** on a Mac. CocoaPods (`sudo gem install cocoapods`).
- [ ] Run once on your Mac: `cd frontend && npx cap add ios`.
- [ ] **Graphics for iOS:**
  - [ ] App icon master at 1024 × 1024. Xcode auto-generates the rest.
  - [ ] Screenshots at three sizes: 6.7", 6.5", 5.5" (≥3 each).
- [ ] **Ask me to add the native Sign in with Apple plugin.** Hard blocker
      for App Store submission (~30 min work). See APP_STORE.md top-of-doc.
- [ ] **Review the App Privacy form answers** in [APP_STORE.md](APP_STORE.md)
      §"App Store Connect listing checklist" — update if anything has changed
      (e.g. you don't end up using Session Replay).

---

## 🟡 Manual testing on a real phone

Things I genuinely can't verify from here — please poke at them when you can:

- [ ] **For You audio swipe** scroll smoothness on iPhone Safari. Should
      feel like TikTok; no stutter or rubber-band weirdness.
- [ ] **Search keyboard interplay** — open `/search` on phone, type a query,
      confirm results don't get hidden behind the keyboard.
- [ ] **Banner padding on profile/album/track pages** — after the recent
      hero tightening, verify nothing feels cramped.
- [ ] **The new For You tabs** — does flipping between For You / Friends /
      Community feel snappy, and does the active tab indicator read well
      against the dark page chrome?
- [ ] **Compare with 3 sides on mobile** — slots stack vertically on small
      screens; check the chart isn't crushed.
- [ ] **Report + Block flows** — flag a test review on a throwaway account,
      verify it shows up in `/admin/reports`, action it, confirm the content
      gets deleted.

---

## 🟡 Marketing / GTM

- [ ] **Draft r/musicboard launch post.** Share with the main Claude
      conversation (not Claude Code) for review before posting.
- [ ] **Confirm Musicboard is still down** before posting — the window is
      time-sensitive. If they've restored service, the angle needs to shift
      from "alternative" to "compare-and-stay-or-switch."
- [ ] Decide on tone for the launch — "Musicboard alternative" vs. "social
      music app." Probably alternative since the window is real.

---

## 🟢 Optional follow-ups (none are launch-blocking)

- [ ] **Session Replay** — enabled at project level in PostHog but not
      capturing data yet. Ask me to wire `posthog.init({ session_recording: ... })`
      with masking for the OAuth `?token=` URL (~5 lines, big debugging upside
      especially during launch). Skip if privacy is a higher priority than
      observability.
- [ ] **Custom domain** — `contour-rosy.vercel.app` works but a real domain
      (e.g. `contour.app`, `contour.fm`) reads more legit on the App Store
      listing. Vercel makes the swap one-click once you own the domain.
- [ ] **Contact email on Privacy Policy / About page.** Apple expects a way
      for users to file data-rights requests.
- [ ] **Status / uptime monitor** (UptimeRobot free tier) pointed at the
      `/health` endpoint.
- [ ] **Heatmaps + Web Vitals capture** in PostHog (~1-line change each in
      `analytics.js`). Useful but not required.
- [ ] **Native Sign in with Apple plugin** — listed under App Store blockers
      but technically optional if you're willing to risk a rejection cycle.

