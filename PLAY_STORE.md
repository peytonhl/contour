# Play Store Release Guide — Contour for Android

This document walks through everything between "the code is on `master`" and
"the AAB is uploaded to the Play Console." It does **not** submit the app.
Final submission stays a manual step.

App identifier: `com.peytonhl.contour`
App name: Contour
Build tool: Capacitor 8 (wrapping the Vite-built React frontend in a WebView)

---

## One-time setup

### 1. Local environment

You need:

- **Android Studio** (Hedgehog or later). The SDK Manager inside it should
  install Android SDK Platform 34+ and Build-Tools 34+.
- **JDK 17** (Android Gradle Plugin 8.x requires it). Android Studio bundles
  a compatible JDK and exposes it via `Settings → Build, Execution, Deployment
  → Build Tools → Gradle → Gradle JDK`. Verify with:

  ```powershell
  java -version   # should print "17.x.x"
  ```

- **Node.js 18+** and the project's npm deps installed (`cd frontend && npm install`).

### 2. Scaffold the Android project

The repo intentionally does not check in `frontend/android/`. Generate it once
per machine:

```powershell
cd frontend
npm run build          # produces dist/ that Capacitor wraps
npx cap add android
npx cap sync android   # also runs automatically by `npm run android:sync` below
```

Capacitor reads `capacitor.config.json` and writes a complete Android Studio
project under `frontend/android/`. The `appId` and `appName` come from that
config; do not edit `android/app/src/main/AndroidManifest.xml` by hand for
those values.

After scaffolding, open `frontend/android/app/src/main/AndroidManifest.xml`
and confirm the only permission is `INTERNET`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

That's the only permission we should ship. No location, contacts, microphone,
camera, file storage, or notifications — we don't use any of them.

### 3. Generate a signing keystore

This key signs every release; **do not lose it**. Losing it means the only
recovery is to publish under a new app identifier, losing all reviews and
installs.

```powershell
keytool -genkey -v `
  -keystore contour-release.keystore `
  -alias contour-release `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

When prompted:

- **Key password & store password:** generate a long random one. Save both in a
  password manager (1Password / Bitwarden); they are needed for every
  subsequent release.
- **First and last name:** Peyton Lindogan
- **Organizational unit / Organization:** Contour
- **City / State / Country:** your actual values.

Move the keystore somewhere safe (NOT the repo). Recommended: `~/secure/contour-release.keystore`.

### 4. Wire the keystore into Gradle

Inside `frontend/android/`, create `keystore.properties` (gitignored by the
Capacitor template — verify before committing):

```properties
storeFile=/absolute/path/to/contour-release.keystore
storePassword=...
keyAlias=contour-release
keyPassword=...
```

Then in `android/app/build.gradle`, in the `android { … }` block, add:

```gradle
signingConfigs {
    release {
        def keystorePropertiesFile = rootProject.file("keystore.properties")
        def keystoreProperties = new Properties()
        keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
        storeFile file(keystoreProperties['storeFile'])
        storePassword keystoreProperties['storePassword']
        keyAlias keystoreProperties['keyAlias']
        keyPassword keystoreProperties['keyPassword']
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
    }
}
```

### 5. Asset preparation

Place these in `frontend/android/app/src/main/res/` once you have the final art
(Section A item 6):

- App icon: `mipmap-*/ic_launcher.png` and `ic_launcher_round.png` at every
  density (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi). Easiest tool: Android Studio's
  "Image Asset" wizard — point it at the 512×512 master and it generates every
  size + an adaptive-icon foreground.
- Splash screen: handled by Capacitor's SplashScreen plugin (already configured
  in `capacitor.config.json` with `backgroundColor: #0d0d0f`).

---

## Building the release AAB

Every release:

```powershell
cd frontend
npm run android:sync           # vite build + cap sync android
cd android
.\gradlew.bat bundleRelease    # or ./gradlew bundleRelease on Linux/Mac
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`. This is
what Play Console accepts.

To smoke-test the release build locally before upload:

```powershell
cd android
.\gradlew.bat installRelease   # installs the signed APK on a connected device
```

(The Play Console wants the AAB, not the APK; the APK is just for local QA.)

---

## Play Console upload checklist

1. **Create the app** at https://play.google.com/console.
   - Default language: English (US)
   - App type: App (not Game)
   - Free / paid: Free
   - Confirm developer policies and tax info.

2. **App information**
   - App name: Contour
   - Short description (~80 chars): "Music ratings, reviews, and era-adjusted
     streaming analytics."
   - Full description: lift from `README.md` § "What is Contour?" — keep it
     under 4,000 chars. Mention the social side first, era-adjustment as a
     feature, given the pivot.
   - Category: Music & Audio
   - Tags: music, reviews, streaming, charts
   - Contact email + website: peyton2117@gmail.com + https://contour-rosy.vercel.app

3. **Privacy Policy URL** (REQUIRED before any release)
   - Section A item 5. Once Peyton drafts it, set the URL here — typically
     `https://contour-rosy.vercel.app/privacy` (route already exists).

4. **Graphic assets** (Section A item 6)
   - App icon: 512 × 512 PNG.
   - Feature graphic: 1024 × 500 PNG (banner shown at the top of the listing).
   - Screenshots: minimum 2 phone screenshots; recommend 4–8 covering Feed,
     For You, an Album page, and the Compare flow. Tablet screenshots optional
     but improve placement.

5. **Content rating questionnaire**
   - Category: Music & Audio
   - Violence: None
   - Sexuality: None
   - Profanity: **Mild** — user-submitted reviews can include explicit-lyric
     discussion; lyrics themselves are not displayed but song titles can be
     marked with the (E) explicit tag.
   - Controlled substances: None
   - Gambling: None
   - User-generated content: **Yes** — reviews and lists are user submissions
     and are publicly visible. Confirm we have a flagging/moderation pathway
     (review-vote downvotes serve as the lightweight signal today;
     formal reporting is a post-launch follow-up).
   - Expected rating: **Teen (13+)**. Confirm in the Play Console flow.

6. **Data Safety form** — answers based on what Contour actually collects:

   | Question | Answer |
   |---|---|
   | Does your app collect any user data? | Yes |
   | Is data encrypted in transit? | Yes (HTTPS to Railway + Vercel) |
   | Can users request deletion? | Yes — describe the manual email path until an in-app option exists. |

   Data types we collect:

   | Type | Collected? | Shared? | Required/Optional | Purpose |
   |---|---|---|---|---|
   | Email address | Yes | No | Required | Account management (Google/Apple OAuth) |
   | Name | Yes | No | Required | Account management (display name from OAuth) |
   | User-generated content (reviews, ratings, lists) | Yes | No | Optional | App functionality |
   | Photos (profile picture URL) | Yes | No | Optional | App functionality |
   | App interactions (PostHog events) | Yes | No | Optional | Analytics |
   | Crash logs / diagnostics | No | — | — | — |
   | Location, contacts, microphone, camera, audio files, calendar, SMS, payment info, precise identifiers | No | — | — | — |

   Note: PostHog autocapture is enabled in the project. Declare it under
   "App interactions" with purpose "Analytics."

7. **Target audience**
   - Target ages: 13–17 and 18+. Contour is not targeted at children under 13.
   - Confirm under "Target audience and content" → "Apps for everyone aged 13
     and over."

8. **Ads declaration**: No ads.

9. **Government apps**: No.

10. **News app**: No.

11. **COVID-19 app**: No.

12. **Health apps**: No.

13. **Financial features**: No.

14. **Submit the AAB to an internal testing track first**, not directly to
    production. Once everyone in the testing group has installed it from the
    Play Store link and verified login/rating/feed/compare/profile flows, then
    promote to closed beta → production.

---

## What's intentionally not handled here

- **Sign in with Apple on Android.** Required only for iOS App Store. Android
  users get Google sign-in only and the Apple button auto-hides when
  `VITE_APPLE_CLIENT_ID` is unset on the Android build (not needed there).
- **Push notifications.** Roadmap item; would require adding the
  `POST_NOTIFICATIONS` permission and a Firebase Cloud Messaging integration.
- **In-app purchases / subscriptions.** Not in scope for v1.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Gradle build failed: SDK location not found` | `local.properties` missing in `android/` | Open the project in Android Studio once — it writes the file automatically. Or set `ANDROID_HOME` env var. |
| `keystore.properties not found` | You ran the build before creating the file (step 4) | Create `frontend/android/keystore.properties` per step 4. |
| `appId is reserved` on Play Console | Someone else uploaded `com.peytonhl.contour` first | Pick a new appId (e.g. `com.peytonhl.contour.app`), update `capacitor.config.json`, regenerate the Android project. |
| Capacitor sync warns about unused plugins | Harmless — Capacitor lists optional plugins it noticed. | Ignore unless we add the plugin. |
