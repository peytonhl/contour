# Things Peyton Needs To Do

Self-contained checklist of every external dependency, account, asset, or
credential I (Claude) can't produce. Grouped by what's blocking what.

For ongoing service monitoring (renewal dates, free-tier ceilings, etc.) and
multi-system runbooks (domain change, key rotation), see
[OPERATIONS.md](OPERATIONS.md). This file is one-time setup tasks; that one
is recurring operational work.

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
- [x] Apple Developer Program membership active.
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
- [x] **Codemagic CI iOS build pipeline working end-to-end.** Signing,
      archive, IPA build, App Store Connect upload, TestFlight processing
      — all green. First build (`401fb390-...`, build #1) reached
      TestFlight 2026-05-12. See [APP_STORE.md](APP_STORE.md).
- [x] **iOS App Store Connect record created.** Name "Contour Music"
      (since "Contour" was taken). Apple ID `6768775634`. Bundle ID
      `com.peytonhl.contour`.
- [x] **iOS distribution signing.** RSA private key at
      `C:\Users\peytonhl\Secrets\contour_signing_key`, mirrored into the
      `CERTIFICATE_PRIVATE_KEY` env var in the Codemagic `contour-prod`
      group. Distribution cert + provisioning profile auto-managed.
- [x] **Live-update Capacitor mode** — iOS/Android native shells load
      `contour-rosy.vercel.app` on every launch. Web/backend changes reach
      mobile users in seconds via Vercel/Railway without an IPA rebuild.
      See [CLAUDE.md](CLAUDE.md) → "iOS & Android: live-update shell model".
- [x] **SigninGate** — full-screen first-launch modal with sign-in CTAs +
      "Browse without signing in" guest mode (shipped 2026-05-12).
- [x] **OAuth return-to-app via `contour://` URL scheme** — Google sign-in
      from inside the native shell opens external Safari, then deep-links
      back into the app with the token (shipped in `ios-v0.1.11`).

---

## ✅ Apple Developer state — mostly done

All Apple Developer-portal work is complete. Reference for state-of-the-world:

- [x] **Apple Developer Program membership** active. Team ID `NUBAA7ZY2X`.
- [x] **App ID** `com.peytonhl.contour` registered with Sign in with Apple,
      MusicKit, and Push Notifications capabilities enabled.
- [x] **Services ID** `com.peytonhl.contour.signin` configured with
      `contour-rosy.vercel.app` as the domain and
      `https://contour-rosy.vercel.app/auth/success` as the redirect.
- [x] **Sign in with Apple key** (`N8XMJRY4GH`) — `.p8` at
      `C:\Users\peytonhl\Secrets\AuthKey_N8XMJRY4GH.p8`.
- [x] **MusicKit key** (`GGQAY4K9PC`) — `.p8` at
      `C:\Users\peytonhl\Secrets\AuthKey_GGQAY4K9PC.p8`.
- [x] **App Store Connect API key** (`D75T7XD5LM`) — `.p8` at
      `C:\Users\peytonhl\Secrets\AuthKey_D75T7XD5LM.p8`. Used by Codemagic
      for signing + uploads.

Verify these env vars are set in **Railway** (backend) and **Vercel**
(frontend) — if any are missing, the corresponding feature is dormant:

| Env var | Where | Used for | Test if active |
|---|---|---|---|
| `APPLE_CLIENT_ID` | Railway | Backend Sign in with Apple token verification | `POST /auth/apple` returns non-503 |
| `VITE_APPLE_CLIENT_ID` | Vercel | Frontend shows "Sign in with Apple" button | Apple button visible on Layout / SigninGate |
| `APPLE_MUSIC_TEAM_ID` | Railway | MusicKit JWT generation | Apple Music pill appears on album pages |
| `APPLE_MUSIC_KEY_ID` | Railway | Same | Same |
| `APPLE_MUSIC_PRIVATE_KEY` | Railway | Same — paste the full PEM including BEGIN/END | `/apple-music/debug` shows `key_loaded: true` |

Open issue: the iOS app currently uses Apple's **web** JS lib for Sign in
with Apple inside the WebView. Apple Guideline 4.8 may demand the native
flow (`ASAuthorizationAppleIDProvider`). Mitigation if rejected: add
`@capacitor-community/apple-sign-in` (~30 min). Decision deferred to first
external beta review feedback. See [APP_STORE.md](APP_STORE.md) →
"Guideline 4.8".

---

## 🟠 Blocking everything visual (icon + screenshots)

One 1024×1024 PNG master icon serves five destinations — produce once,
downsample everywhere. **Same goes for screenshots:** capture once at the
largest iOS phone size (6.7" / 1290×2796), and both Apple and Google
accept downsampled variants.

- [ ] **App icon master** — 1024 × 1024 PNG, no alpha channel for iOS
      (Apple rejects transparent PNGs). See the image-generation prompt
      Claude drafted in this conversation for the design brief; iterate
      with whichever AI image tool you prefer until happy.

      Downsamples needed (do once, automated):
      - 1024×1024 → App Store listing + Apple iOS app icon master
      - 512×512 → Play Store listing + Android adaptive icon master
      - 192×192 + 512×512 (PNG, with alpha OK) → PWA `manifest.json` icons
      - 180×180 → `apple-touch-icon.png` for iOS "Add to Home Screen"
      - 32×32 + 16×16 → favicon for the website

      Easiest one-stop tool: https://realfavicongenerator.net/ takes the
      1024 master and spits out every variant + the HTML snippet for
      `index.html`. Free, no signup.

- [ ] **Feature graphic** — 1024 × 500 PNG, Play Console banner shown
      atop the listing. Can be the icon enlarged with the wordmark
      "Contour" + tagline "Rate. Review. Discover." beside it.

- [ ] **Phone screenshots** — capture on a real iPhone (or simulator)
      at 6.7" (iPhone 15 Pro Max viewport, 1290 × 2796). Recommended set
      of 4–8 from these pages:
      1. **For You feed** (audio swipe — most visually striking shot)
      2. **Album page** with rating + review row (the core action)
      3. **Compare** with 3 sides (signature feature, looks unique)
      4. **Profile** showing rating distribution + recent activity
      5. **Friends timeline** (proves the social angle)

      iOS App Store accepts the 6.7" set and auto-downsamples for 6.5"
      and 5.5" displays — don't waste time taking three separate sets.
      Play Console accepts the same files (just relabel as "phone").

---

## 🟠 Blocking Play Store launch

- [x] **Android Studio + JDK 17** installed locally.
- [x] Ran `npx cap add android`; `frontend/android/` project scaffold lives in master.
- [x] **Signing keystore generated** at `C:/Users/peytonhl/Secrets/contour-release.keystore`,
      wired to Gradle via `frontend/android/keystore.properties` (gitignored).
- [ ] **Back up the keystore + password to 1Password — and delete
      `C:/Users/peytonhl/Secrets/keystore-password.txt` afterward.** If you
      lose this file, you can never update the published app.
- [ ] **Back up `C:/Users/peytonhl/Secrets/contour_signing_key`** (the RSA
      private key Codemagic uses to register iOS Distribution certs). Same
      "can never update the app again" stakes as the Android keystore.
      Should sit alongside the keystore + .p8 files in the hard-drive backup.

---

## ✳ Architecture note: iOS/Android are live-update shells

`frontend/capacitor.config.json` is set to `server.url:
https://contour-rosy.vercel.app`, so native iOS and Android binaries load
the live web app from Vercel on every launch. Implications:

- Web/React/CSS/backend changes reach mobile users the moment Vercel finishes
  deploying — usually 2 minutes. No app store involvement.
- IPA / AAB rebuilds are only required when adding native capabilities
  (Capacitor plugins, entitlements, icon, splash). Probably quarterly.
- The bundled `dist/` is included in the IPA but unused at runtime. It's
  effectively a 2MB dead weight; not worth optimizing away yet.

This is documented at length in `CLAUDE.md` → "iOS & Android: live-update
shell model". Do not switch back to bundled mode without thinking through
the upgrade-cadence implications.
- [ ] **Privacy Policy page** at https://contour-rosy.vercel.app/privacy
      (route exists — content needs writing). Required for Play Store, App
      Store, and Apple Music API ToS.
- [ ] **Terms of Service page.** Required for Play Store + App Store.
- [ ] **Graphics** — covered in the "Blocking everything visual" section
      above (one icon master serves Play Store + App Store + PWA).
- [ ] **Google Play Console account** ($25 one-time).
- [ ] Build the AAB and upload to internal testing track — full sequence in
      [PLAY_STORE.md](PLAY_STORE.md).

---

## 🍎 iOS — three-tier beta + launch sequence

Don't try to ship all three tiers at once. Live in Tier 1 (internal) for a
week or two, then promote to Tier 2 when stable, then Tier 3 once you're
ready for the App Store. Full architectural context in
[APP_STORE.md](APP_STORE.md).

Already done (no action needed):
- [x] ~~Xcode + Mac~~ — bypassed entirely via Codemagic CI.
- [x] ~~Run `npx cap add ios` on a Mac~~ — Codemagic does this in every build.
- [x] **Codemagic build pipeline working end-to-end** — sign, archive,
      upload, TestFlight processing all working.
- [x] **Live-update mode** — iOS shell loads `contour-rosy.vercel.app`
      on every launch. Web/backend changes reach iOS testers in seconds
      with no IPA rebuild needed.
- [x] **OAuth return-to-app** (`ios-v0.1.11+`) — `contour://` URL scheme
      registered, `@capacitor/app` plugin baked in. Google sign-in opens
      external Safari and returns to the app on completion.
- [x] **TestFlight Test Information** filled in (feedback email, reviewer
      contact, beta description).

### 🟢 Tier 1 — Internal TestFlight beta (this is where you live right now)

No Apple review needed. Up to 100 testers, each added by Apple ID email.

- [ ] **Install `ios-v0.1.11` on your iPhone** when Codemagic finishes,
      smoke-test the OAuth-return-to-app fix end-to-end.
- [ ] **Invite first round of internal testers** in App Store Connect →
      Users and Access. Friends, family, anyone with an Apple ID. They
      install via TestFlight on their phone within minutes of the invite
      email.
- [ ] **Iterate.** Every web/backend deploy reaches them instantly via
      Vercel/Railway. Tag a fresh `ios-vX.Y.Z` only when you change native
      config (new Capacitor plugin, icon, etc.). Apple does not gate any
      of this.

### 🟡 Tier 2 — External TestFlight (when build feels stable)

First build of a version (`1.0`) needs ~24h Apple beta review. Subsequent
builds within the same version usually pass through in minutes. Up to
10,000 testers via email or public link.

Additional blockers before submitting (none of these are needed for Tier 1):

- [ ] **App icon** — covered in the "Blocking everything visual" section
      above. Apple's beta reviewers reject builds with default/placeholder
      icons. This is the main thing gating Tier 2 right now.
- [ ] **App Review demo account.** Create a throwaway Gmail like
      `contour.appstorereview@gmail.com`. Sign into Contour with it once
      via Google OAuth (creates the user record on the backend). Paste
      the credentials into App Store Connect → TestFlight → Test
      Information → Sign-in Required → Yes → Demo Account.
- [ ] **Create the External Testing group** in App Store Connect →
      TestFlight → External Testing → `+`. Name it "Public Beta" or
      "Friends & Family." Enable public link in Settings.
- [ ] **Assign `ios-v0.1.11+` to the external group** and click
      "Submit for Beta App Review."
- [ ] **Wait ~24h.** Apple emails when approved. External testers can
      then install via the public link.

### 🟠 Tier 3 — Full App Store production launch

Apple reviews each release (~24–72h typical). The bar is higher than for
TestFlight.

Additional blockers (on top of everything in Tier 2):

- [ ] **Screenshots** — covered in "Blocking everything visual" section.
      Required, ≥3 per device size class. The 6.7" set covers 6.5" and
      5.5" via Apple's auto-downsampling.
- [ ] **Privacy Policy content** at https://contour-rosy.vercel.app/privacy.
      Route exists, content TBD. Required.
- [ ] **Terms of Service page.** Required.
- [ ] **Native Sign in with Apple plugin (optional / risk-dependent).**
      Guideline 4.8 may still demand the native flow even though
      OAuth-via-Safari + URL scheme works for Google. Decide based on
      Tier 2 reviewer feedback whether to add
      `@capacitor-community/apple-sign-in` (~30 min) before submitting
      for App Store review.
- [ ] **Review the App Privacy form answers** in [APP_STORE.md](APP_STORE.md)
      §"App Privacy form" — update if anything has changed (e.g. you
      don't end up using Session Replay).
- [ ] **Age rating questionnaire.** Expected outcome: 12+.
- [ ] **Subtitle + category metadata** — see APP_STORE.md → "App
      Information" checklist.
- [ ] **Submit for App Store review** via App Store Connect → Distribution.

---

## 🟡 PWA / installable web app

Make `contour-rosy.vercel.app` installable to the home screen on desktop
Chrome, Android, and iOS — gives users an "app" experience without going
through any store. Some of this is already started but needs finishing.

**Already done:**
- `frontend/public/manifest.json` exists and is linked from `index.html`.
- Theme color, background color, and standalone display mode are set.

**Outstanding (mostly gated on icon assets):**
- [ ] **Icons in real raster sizes** — produced as part of the
      "Blocking everything visual" section above. Drop the PNG outputs
      into `frontend/public/` once available.
- [ ] **Update the manifest description.** Currently reads "Era-adjusted
      music streaming data, community ratings, and reviews" — stale after
      the social-first pivot. Should match the new "Rate. Review. Discover."
      tagline / something like "Rate, review, and discover music with friends."
- [ ] **Service worker.** Without one, Chrome doesn't surface the "Install app"
      prompt in the address bar. Easiest path is dropping in `vite-plugin-pwa`
      (~5 lines of `vite.config.js` config, ~30 min). Auto-generates the SW
      and handles asset precaching. Side benefit: offline support for the
      shell so the app at least loads without network.
- [ ] **iOS meta tags in `index.html`.** Add `<link rel="apple-touch-icon">`,
      `<meta name="apple-mobile-web-app-capable" content="yes">`, and
      `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
      so iOS "Add to Home Screen" produces a proper full-screen app instead
      of a Safari-chrome shortcut.
- [ ] **Verify the install prompt.** Once the above is in place, open Chrome
      DevTools → Application → Manifest, click "Install app" — should produce
      a real-looking install dialog with the right icon and name.

Ask me to wire all of this once you have the icon PNGs in hand — it's
straightforward and the bulk of the work is just dropping files into
`frontend/public/`.

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

- [ ] **Push notifications (v1.1 — post-launch).** Push capability is enabled
      on the iOS App ID so we can ship without re-provisioning. Implementation
      scope: ~1-2 days. Wire `@capacitor/push-notifications` (works for both
      iOS via APNs and Android via FCM), add a `device_tokens` table, register
      tokens on app launch, extend `backend/routers/notifications.py` to fan
      out a push payload alongside the in-app row it already creates. Trigger
      events already exist: new follower, review reply, friend rates an album
      you care about. Keep all notifications event-driven and contextual —
      Apple Guideline 4.5.4 rejects generic "come back!" pings without
      explicit marketing consent, and event-driven pushes get 3-5× the open
      rate anyway.


- [ ] **Session Replay** — enabled at project level in PostHog but not
      capturing data yet. Ask me to wire `posthog.init({ session_recording: ... })`
      with masking for the OAuth `?token=` URL (~5 lines, big debugging upside
      especially during launch). Skip if privacy is a higher priority than
      observability.
- [ ] **Custom domain** — `contour-rosy.vercel.app` works but a real domain
      (e.g. `contour.app`, `contour.fm`) reads more legit on the App Store
      listing. The Vercel swap is one-click but several external services
      (Google OAuth, Apple Services ID, CORS, User-Agent strings) need to
      update in lockstep — full runbook is in
      [OPERATIONS.md](OPERATIONS.md#domain-migration-runbook).
- [ ] **Contact email on Privacy Policy / About page.** Apple expects a way
      for users to file data-rights requests.
- [ ] **Status / uptime monitor** (UptimeRobot free tier) pointed at the
      `/health` endpoint.
- [ ] **Heatmaps + Web Vitals capture** in PostHog (~1-line change each in
      `analytics.js`). Useful but not required.
- [ ] **Native Sign in with Apple plugin** — listed under App Store blockers
      but technically optional if you're willing to risk a rejection cycle.

