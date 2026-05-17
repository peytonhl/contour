# App Store Release Guide — Contour for iOS

Sister doc to [PLAY_STORE.md](PLAY_STORE.md). Covers everything from the
code on `master` to a build in TestFlight (and eventually the App Store).

**Important context before reading:**

- iOS builds are produced by **Codemagic CI** (cloud-hosted Mac builders),
  not by a local Xcode install. You do not need a Mac.
- Native shells use **Capacitor 8 in live-update mode** — they load the
  React app from `https://contour-rosy.vercel.app` on every launch. Web
  deploys (Vercel) reach iOS users instantly; native IPA rebuilds are only
  required when adding plugins, entitlements, the icon, or splash screen.
- Background reading on the architecture: [CLAUDE.md](CLAUDE.md) →
  "iOS & Android: live-update shell model".

App identifier: `com.peytonhl.contour`
App Store record name: **Contour Music** (`Contour` was already taken)
Apple ID: `6768775634`
Bundle ID: `com.peytonhl.contour`
Team ID: `NUBAA7ZY2X`

---

## 🎯 Beta strategy — internal first, external second, full App Store later

Don't try to ship all three at once. The order matters:

### Tier 1 — Internal TestFlight (this is where you live during beta)

- **Audience:** Up to 100 testers, each added by Apple ID email in App
  Store Connect → Users and Access → Internal Group.
- **Apple review required:** **None.** Builds become available to internal
  testers within minutes of upload.
- **Use this for:** the entire beta period. Friends, family, design
  feedback, dogfooding, anyone whose Apple ID you can collect. Iterate as
  fast as you want — web/backend changes reach testers in seconds (live
  update), native rebuilds reach them in ~10 minutes (Codemagic build time,
  no Apple wait).
- **No blockers** beyond filling in the Test Information form (already
  done) and having a working build.

### Tier 2 — External TestFlight (when you're ready to scale)

- **Audience:** Up to 10,000 testers via email invite OR public link.
- **Apple review required:** ~24 hours for the FIRST build of a given
  version (1.0). Subsequent builds within the same version usually go
  through in minutes with no re-review.
- **Use this for:** the r/musicboard launch post, broader public beta,
  collecting structured feedback before App Store submission.
- **Additional blockers vs. internal:**
  - Beta App Description (done)
  - App Review demo account credentials (still TODO)
  - App icon — Apple's beta reviewers reject builds with default/placeholder
    icons (still TODO)
  - Optional but recommended: 3–4 screenshots so reviewers can see what
    the app does at a glance

### Tier 3 — Full App Store

- **Audience:** Everyone, via the App Store.
- **Apple review required:** ~24–72 hours, per release.
- **Additional blockers vs. external:**
  - Screenshots (required, ≥3 per device size class)
  - Privacy Policy content (route exists, content is still TODO)
  - Terms of Service page
  - App Privacy form filled in
  - Age rating questionnaire
  - Potentially: native Sign in with Apple plugin (Guideline 4.8 risk —
    see below)

**Recommended sequence:** spend 1–2 weeks in Tier 1 (internal). Once the
build feels stable and you have the icon + a demo account, flip to Tier 2.
Spend another week or two collecting external feedback. Then submit to
Tier 3.

---

## ⚠️ Known compliance risks — read before submitting to Tier 3

### Guideline 4.8 — Sign in with Apple

Required if you offer any other third-party sign-in (we offer Google).
Historically Apple has wanted the **native** flow
(`ASAuthorizationAppleIDProvider`) rather than the web JS popup that
`AppleSignInButton.jsx` currently uses.

**Current status:** With the `contour://` URL scheme + Google OAuth via
external Safari working as of `ios-v0.1.11`, Apple sign-in via the web JS
lib MIGHT also work cleanly through the external-Safari + URL-scheme path.
We'll know on first beta review.

**If Apple rejects on this:** add `@capacitor-community/apple-sign-in`,
branch on `Capacitor.isNativePlatform()`. ~30 min of work; included in
TODO_PEYTON.md as a known follow-up. Not a hard blocker for Tier 1
(internal) — only matters for Tier 2 and Tier 3.

### Guideline 1.2 — User-Generated Content (UGC)

Apple requires:
- A way to **report objectionable content** (reviews + replies)
- A way to **block abusive users**
- Active moderation by a human

**Status:** ✅ All shipped. Report and Block buttons live; admin queue at
`/admin/reports`; Peyton has `is_admin=true`. See `routers/moderation.py`
and the "UGC moderation" section in STATUS.md.

### Guideline 4.2 — Minimum Functionality (live-update wrapper risk)

Apps that are "just a website in a webview" get rejected. Our app reads
remote HTML but has substantial native integration (Sign in with Apple
button, audio playback, share sheet, Capacitor splash + status bar
control, MusicKit deep links). Bar is met. Risk is low but real.

**Defense:** when Apple asks, point to:
- Sign in with Apple integration (web flow at minimum, native plugin if
  required)
- Native splash screen, status bar styling
- Plans for native push notifications (v1.1)
- Plans for native sharing / haptics

---

## How the build pipeline works

### Tagging triggers a build

```bash
git tag ios-vX.Y.Z
git push origin ios-vX.Y.Z
```

Codemagic watches the `ios-v*` tag pattern and runs the `ios-release`
workflow defined in `codemagic.yaml`. End-to-end build time is ~10–15 min:

1. Install npm deps (`npm ci` with `npm install` fallback)
2. `vite build` produces `frontend/dist/`
3. `npx cap add ios` scaffolds the iOS project fresh (gitignored)
4. `npx cap sync ios` copies dist/ in + links Capacitor plugins
5. `plutil` writes Info.plist values (encryption flag, `contour://` URL
   scheme registration)
6. `agvtool` bumps `CFBundleVersion` to one above the latest in App Store
   Connect — guarantees monotonicity even across manual + CI uploads
7. `app-store-connect fetch-signing-files --create` ensures Distribution
   cert + profile exist (creates on first build, reuses thereafter). Uses
   `CERTIFICATE_PRIVATE_KEY` env var from the `contour-prod` Codemagic group
8. `xcode-project build-ipa` archives + exports the IPA
9. Upload to App Store Connect via the integrated API key
10. Auto-submit to TestFlight for external review (currently fails on
    missing Beta App Description fields — internal testing works regardless)

### Configuration sources

| What | Where it lives | Notes |
|---|---|---|
| Bundle ID, app name, web URL | `frontend/capacitor.config.json` | `server.url` is what enables live-update mode |
| Info.plist values | `codemagic.yaml` plutil steps | iOS project is regenerated every build, so any custom Info.plist values must go through plutil |
| Build number bump | `codemagic.yaml` `agvtool` step | Reads latest from App Store Connect via `app-store-connect get-latest-build-number` |
| Signing | App Store Connect API key + RSA private key in `CERTIFICATE_PRIVATE_KEY` env var | One-time key generation, then reused forever; back it up |
| External testing submission gate | App Store Connect → TestFlight → Test Information page | Manual UI, persists across builds |

### When you actually need to rebuild

- ✅ **Don't rebuild for:** any React / CSS / page layout change. Backend
  API changes. New features that don't require new Capacitor plugins.
  Bug fixes. Copy edits. Theme tweaks.
- ✅ **Do rebuild for:** new Capacitor plugin (`@capacitor/push-notifications`,
  native Sign in with Apple, haptics, camera). App icon / splash screen
  update. New entitlement on the App ID. iOS SDK / target bump
  (Apple-mandated, ~annual).

Rule of thumb during active beta: maybe 1–3 native rebuilds per month.
Web deploys: every day, often multiple times.

### Currently bundled native plugins

Reflects the latest `ios-v*` tag (`ios-v0.1.15` as of 2026-05-17).
Anything you add to `frontend/package.json` here lands in the next tag.

| Plugin | Purpose | Shipped in |
|---|---|---|
| `@capacitor/app` | `contour://` URL scheme + appUrlOpen handler | `ios-v0.1.11` |
| `@capacitor/splash-screen` | Boot splash control | included from day 1 |
| `@capacitor/share` | Native share sheet for card PNGs (workaround for WKWebView's `canShare({ files })` false-negative) | `ios-v0.1.15` |
| `@capacitor/filesystem` | Write card PNG to `Directory.Cache` so `@capacitor/share` can pass a `file://` URI to `UIActivityViewController` | `ios-v0.1.15` |

---

## App Store Connect setup checklist

Most of this is done. Listed here for completeness so future-Peyton or
future-Claude can audit state.

### App record

- ✅ Created at https://appstoreconnect.apple.com/apps/6768775634
- ✅ Name: **Contour Music**
- ✅ SKU: `contour-ios`
- ✅ Primary locale: English (US)
- ✅ Bundle ID: `com.peytonhl.contour`

### Pricing & Availability

- [ ] Set to **Free**, all territories — confirm before submission.

### App Information

- [ ] **Subtitle (30 chars):** suggestion: "Rate, review, discover music"
- [ ] **Category (primary):** Music
- [ ] **Category (secondary):** Social Networking
- [ ] **Content rights:** check the "third-party content with proper
      licensing" box — cover art is from Spotify under fair-use review
      context.

### TestFlight Test Information

- ✅ Beta App Description (done)
- ✅ Feedback Email (done — `peyton2117@gmail.com`)
- ✅ App Review Contact Info (done — Peyton Lindogan)
- [ ] **Sign-in credentials** (demo account) — TODO before Tier 2:
  - Create a throwaway Gmail (e.g. `contour.appstorereview@gmail.com`)
  - Sign into Contour with it once via Google OAuth so the user record exists
  - Paste the credentials in the demo account fields

### App Privacy form

Mirror the Play Store Data Safety answers. With Apple's labels:

| Data type | Linked to user? | Used for tracking? | Purpose |
|---|---|---|---|
| Email Address | Yes | No | App Functionality, Account Management |
| Name | Yes | No | App Functionality |
| User Content (reviews, ratings, lists) | Yes | No | App Functionality |
| Photos (profile picture URL from OAuth) | Yes | No | App Functionality |
| Product Interaction (PostHog events) | Yes | No | Analytics |

"Used for tracking" is **No** — PostHog data is first-party and not
shared with brokers or used for cross-app advertising.

### Age rating

Expected: **12+**. Reasons:
- User-generated review text may contain mild profanity → "Infrequent/Mild"
- Unrestricted web access? **No** — WebView is locked to our origin.
- All other categories: None.

### App Review Information (for Tier 3, App Store production review)

- Sign-in credentials: same demo account as TestFlight.
- Notes for reviewer: short paragraph explaining the For You audio feed
  + era-adjustment feature. Link to `https://contour-rosy.vercel.app/methodology`.

### Screenshots

For Tier 3 (App Store production), required:
- ≥3 screenshots at 6.7" (iPhone 15 Pro Max — 1290×2796) — Apple auto-
  downsamples for 6.5" and 5.5" device classes.

Recommended set of 4–8 from these pages:
1. For You feed mid-swipe (most visually distinctive)
2. Album page with a star rating visible
3. Compare page with 3 trajectories drawn (signature feature)
4. Friends timeline (proves social angle)
5. Profile showing rating distribution

For Tier 2 (external TestFlight), screenshots aren't required but Apple's
beta reviewers will glance at them. Strongly recommended.

---

## Setting up a new Apple Developer account / machine (reference)

Most of this is already done. Documented in case anything needs redoing:

### Apple Developer Program

- ✅ Membership purchased + active ($99/year)
- ✅ Team ID: `NUBAA7ZY2X`

### App ID (developer.apple.com → Identifiers)

- ✅ Created: `com.peytonhl.contour`
- ✅ Capabilities enabled: Sign in with Apple, Push Notifications, MusicKit

### Service ID (for Sign in with Apple OAuth from web)

- ✅ Created (`com.peytonhl.contour.signin`)
- ✅ Domain: `contour-rosy.vercel.app`
- ✅ Redirect URL: `https://contour-rosy.vercel.app/auth/success`

### Keys (developer.apple.com → Keys)

All `.p8` files stored locally at `C:\Users\peytonhl\Secrets\`. Back them
up (1Password / encrypted hard drive) — they can each only be downloaded
once.

| Key purpose | Key ID | Filename |
|---|---|---|
| Sign in with Apple | `N8XMJRY4GH` | `AuthKey_N8XMJRY4GH.p8` |
| MusicKit (catalog deep links) | `GGQAY4K9PC` | `AuthKey_GGQAY4K9PC.p8` |
| App Store Connect API (Codemagic) | `D75T7XD5LM` | `AuthKey_D75T7XD5LM.p8` |

### iOS Distribution certificate

Auto-managed by Codemagic via `CERTIFICATE_PRIVATE_KEY` env var. The RSA
private key Codemagic uses lives at
`C:\Users\peytonhl\Secrets\contour_signing_key`. Back it up — losing it
means you can never sign new IPA builds (Apple won't recover the cert
from the App Store Connect side).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Codemagic build fails on "App requires a provisioning profile" | First-build cert + profile not created yet | Workflow already runs `fetch-signing-files --create` — should auto-resolve. If it doesn't, check `CERTIFICATE_PRIVATE_KEY` is set in `contour-prod` env group |
| `ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE` on upload | Bundle version collision with existing build | `agvtool` step now reads max from App Store Connect; should auto-bump |
| TestFlight upload succeeds but no auto-submit | "Beta App Description" or other Test Information empty | Fill in App Store Connect → TestFlight → Test Information |
| External beta build doesn't show up for testers | Build still "Ready to Submit" (yellow) | Check Test Information has all fields filled, then click "Submit for Review" |
| Google sign-in opens Safari but doesn't return to the app | `contour://` URL scheme not registered in Info.plist | `ios-v0.1.11+` registers it via the plutil step. Check build log shows `CFBundleURLTypes` |
| Google says "embedded webview not allowed" | Trying to do OAuth inside WKWebView | Sign-in `<a>` tags use `target="_blank"` (`externalLinkProps()` from `utils/native.js`) — opens external Safari instead |

---

## What's intentionally not handled in this doc

- **Native Sign in with Apple plugin** — listed as a Tier 2/3 follow-up,
  not a Tier 1 blocker.
- **Apple Music user sign-in (MusicKit)** — explicit non-goal; catalog-only
  deep links via the developer token.
- **Universal Links** — could add via Associated Domains capability later.
  Not required for v1.
- **App Tracking Transparency** — not needed; we don't track users across
  other companies' apps.
- **Push notifications** — roadmap item for v1.1.
