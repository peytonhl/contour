# App Store Release Guide — Contour for iOS

Sister doc to [PLAY_STORE.md](PLAY_STORE.md). Walks through everything between
"the code is on `master`" and "the build is in TestFlight." Does **not** submit
the app — final submission stays manual.

App identifier: `com.peytonhl.contour`
App name: Contour
Build tool: Capacitor 8 → Xcode

---

## ⚠️ Known compliance risk — read first

**App Store Guideline 4.8 requires Sign in with Apple** if any other third-party
sign-in is offered, AND historically Apple's reviewers expect the **native**
flow (`ASAuthorizationAppleIDProvider`) rather than a WebView popup.

Today, `AppleSignInButton.jsx` uses Apple's **web** JS lib (`appleid.auth.js`)
inside the WebView. That works in browsers and is fine for the Play Store
build, but Apple may reject the iOS submission demanding the native flow.

**Mitigations (in order of preference):**

1. **Add the `@capacitor-community/apple-sign-in` plugin** to the iOS build
   and call it when `Capacitor.isNativePlatform()` is true; fall back to the
   web flow otherwise. ~30 min of work; this is the recommended fix before
   App Store submission.
2. Ship the web flow first to TestFlight, see what reviewer feedback we get,
   and add the native plugin only if forced. Higher risk of a rejection cycle.

Track this as a hard blocker for App Store submission. The Play Store does
not have this requirement.

---

## One-time setup

### 1. Local environment

You need:

- **macOS** with **Xcode 15+** installed. Open it once to accept the EULA and
  install Command Line Tools.
- **CocoaPods** — Capacitor uses it for native dependency management:
  ```bash
  sudo gem install cocoapods
  pod --version    # 1.14+
  ```
- **Apple Developer Program membership** (Section A item 7, $99/yr).
- The project's npm deps installed (`cd frontend && npm install`).

### 2. Scaffold the iOS project

The repo intentionally does not check in `frontend/ios/`. Generate it once
per machine:

```bash
cd frontend
npm run build          # produces dist/
npx cap add ios
npx cap sync ios       # runs automatically as part of `npm run ios:sync`
```

Capacitor reads `capacitor.config.json` and writes an Xcode project under
`frontend/ios/App/App.xcworkspace`. Open *that* in Xcode, not the `.xcodeproj`.

### 3. Configure signing in Xcode

In `App.xcworkspace` → `App` target → **Signing & Capabilities** tab:

- **Team:** select your Apple Developer account.
- **Bundle Identifier:** `com.peytonhl.contour` (already set via
  `capacitor.config.json`).
- Toggle **Automatically manage signing** on for the first build. Once a build
  is uploaded to App Store Connect, switch to manual signing with an
  explicitly-created App Store distribution provisioning profile if you want
  reproducible builds in CI.

### 4. Add required capabilities

Still on **Signing & Capabilities**, click **+ Capability** and add:

- **Sign in with Apple** — required for Guideline 4.8 since we offer Google
  OAuth. See the compliance risk note above; this capability + native plugin
  is the proper end-state.
- **Associated Domains** (optional, only if/when we add universal links so
  `contour-rosy.vercel.app/album/...` opens the app directly).
- **Push Notifications** — leave off for v1; we don't ship notifications.

### 5. Edit `Info.plist`

`frontend/ios/App/App/Info.plist`. Capacitor pre-populates most keys. Verify
or add:

| Key | Value | Why |
|---|---|---|
| `CFBundleDisplayName` | `Contour` | Home screen label |
| `NSAppTransportSecurity` → `NSAllowsArbitraryLoads` | `false` | We only talk HTTPS — keep ATS strict |
| `LSApplicationQueriesSchemes` | `["spotify", "music"]` | Lets the WebView open Spotify and Apple Music apps if installed |
| `ITSAppUsesNonExemptEncryption` | `false` | Avoids the export-compliance question on every TestFlight upload (we only use HTTPS, no proprietary crypto) |

We do **not** need any of these usage-description keys because we don't use
the corresponding hardware/data:

- `NSCameraUsageDescription`
- `NSMicrophoneUsageDescription`
- `NSPhotoLibraryUsageDescription`
- `NSContactsUsageDescription`
- `NSLocationWhenInUseUsageDescription` / `NSLocationAlwaysUsageDescription`
- `NSCalendarsUsageDescription`
- `NSAppleMusicUsageDescription` — only needed for native MusicKit user sign-in,
  which is in the explicit non-goals list.

### 6. Asset preparation

Once Section A item 6 produces the asset bundle:

- **App icon:** drop the 1024×1024 master into Xcode's `Assets.xcassets →
  AppIcon`. Xcode generates every size automatically.
- **Launch screen:** Capacitor provides a default; tweak background color in
  `LaunchScreen.storyboard` to `#0d0d0f` to match the app theme.
- **App Store screenshots:** required at the 6.7" (iPhone 15 Pro Max),
  6.5" (iPhone 11 Pro Max), and 5.5" (iPhone 8 Plus) sizes. Minimum 3
  screenshots per size. Easiest workflow: build for each simulator size and
  capture in-simulator screenshots.

---

## Building for TestFlight / App Store

Every release:

```bash
cd frontend
npm run ios:sync                   # vite build + cap sync ios
npx cap open ios                   # opens App.xcworkspace in Xcode
```

In Xcode:

1. Select **Any iOS Device (arm64)** in the device dropdown (top-left).
2. **Product → Archive**.
3. When the Organizer opens, click **Distribute App** → **App Store Connect**
   → **Upload**.
4. Choose **Automatically manage signing** (or your manual distribution
   profile), accept defaults, **Upload**.
5. Wait for App Store Connect to process the build (5–30 min) and email you.

To smoke-test before submitting:

- TestFlight → Internal Testing → add yourself and a couple of testers.
  Internal testing builds skip Apple review and are available within minutes.

---

## App Store Connect listing checklist

1. **Create the app** at https://appstoreconnect.apple.com.
   - Platform: iOS
   - Default language: English (US)
   - Bundle ID: `com.peytonhl.contour` (select the one you registered in the
     Developer portal)
   - SKU: `contour-ios` (any unique string)

2. **Pricing & Availability:** Free, all territories.

3. **App Information**
   - Subtitle (30 chars): "Rate, review, compare music"
   - Category (primary): Music
   - Category (secondary): Social Networking
   - Content rights: confirm we are using user-generated content from third
     parties (cover art via Spotify) only in fair-use review context.

4. **Privacy Policy URL** — same as Play Store, `https://contour-rosy.vercel.app/privacy`.

5. **App Privacy form** — declare what we collect. Mirrors the Play Store
   Data Safety answers, with Apple's labeling:

   | Data type | Linked to user? | Used for tracking? | Purpose |
   |---|---|---|---|
   | Email Address | Yes | No | App Functionality, Account Management |
   | Name | Yes | No | App Functionality |
   | User Content (reviews, ratings, lists) | Yes | No | App Functionality |
   | Photos (profile picture URL from OAuth provider) | Yes | No | App Functionality |
   | Product Interaction (PostHog events) | Yes | No | Analytics |

   "Used for tracking" is **No** because PostHog data is first-party — we
   don't share it with brokers or use it for cross-app advertising.

6. **Age rating questionnaire**
   - Cartoon or fantasy violence: None
   - Realistic violence: None
   - Sexual content or nudity: None
   - Profanity or crude humor: **Infrequent/Mild** — same reasoning as the
     Play Store: review text is user-supplied.
   - Mature/suggestive themes: None
   - Drug, alcohol, or tobacco reference: None
   - Gambling: None
   - Horror/fear themes: None
   - Unrestricted Web Access: **No** (the WebView is locked to our origin via
     `limitsNavigationsToAppBoundDomains: true` in `capacitor.config.json`).
   - Gambling/contests: No

   Expected age rating: **12+**. (iOS uses different bands than Android; this
   maps to Teen.)

7. **App Review Information**
   - Sign-in credentials: provide a test Google account if review uses login.
     Apple specifically asks for one when sign-in is required to demonstrate
     functionality. Create a low-stakes Google account for this and put the
     credentials in the review-notes field.
   - Notes for reviewer: short paragraph explaining the era-adjustment feature
     and pointing to https://contour-rosy.vercel.app/methodology for more
     detail.

8. **Screenshots and previews** — Section A item 6 delivers these.

9. **Pre-submission compliance pass against the Review Guidelines**:

   - **Guideline 4.8 — Sign in with Apple** → blocked until the native flow
     ships (see top of doc).
   - **Guideline 5.1.1 — Data Collection and Storage** → covered by the
     Privacy Policy + App Privacy form.
   - **Guideline 4.2 — Minimum Functionality** → covered; we have rate / review
     / discover / compare features, not just a website wrapper.
   - **Guideline 5.1.2 — Data Use and Sharing** → we do not share user data
     with third parties for advertising.
   - **Guideline 1.2 — User-Generated Content** → reviews are user-submitted.
     Apple requires a way to **report objectionable content** and **block
     abusive users**. Currently we have downvotes but no formal reporting or
     blocking flows. This is a likely review request. Decide pre-submission
     whether to add the missing flows or expect a rejection cycle.

10. **Submit to TestFlight first**, validate internally, then submit for App
    Store review.

---

## What's intentionally not handled here

- **Native Sign in with Apple plugin** — flagged at the top, deliberate follow-up.
- **Apple Music user sign-in (MusicKit)** — explicit non-goal; we only do
  catalog-only deep links.
- **Universal Links** — could add via Associated Domains capability later,
  not required for v1.
- **App Tracking Transparency** — not required because we don't track users
  across apps owned by other companies. The App Privacy form should reflect
  "Not used for tracking" for every data type.
- **Push notifications** — roadmap item.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Code signing failed: no provisioning profile` | Automatic signing not enabled or Team not selected | Signing & Capabilities → check both. |
| `Bundle Identifier in use` | Someone else registered `com.peytonhl.contour` | Pick a new identifier in the Apple Developer portal and update `capacitor.config.json` + Xcode. |
| Build succeeds but archives are missing in Organizer | Archive scheme set to Debug | Edit Scheme → Archive → Build Configuration: Release. |
| `ITSAppUsesNonExemptEncryption` prompt on every upload | Key not in Info.plist | Add `ITSAppUsesNonExemptEncryption = NO` to Info.plist. |
| Sign in with Apple popup blocked in WebView | This is the 4.8 compliance issue. | Implement the native plugin per the top-of-doc note. |
