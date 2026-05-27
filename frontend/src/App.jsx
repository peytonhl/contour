import { useEffect, lazy, Suspense, useState, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout.jsx";
import { OnboardingModal } from "./components/OnboardingModal.jsx";
import { SigninGate } from "./components/SigninGate.jsx";
import { isNativePlatform } from "./utils/native.js";
import { ROUTES } from "./constants/routes.js";
import { api } from "./services/api.js";
import { prefetchIntoCache } from "./utils/useCachedFetch.js";
// ForYouPage is the landing route — keep it eager so the cold-start path
// has no async chunk fetch. Everything else lazy-loads on first navigation.
// Before this change, the initial bundle included Recharts (~150KB gzip
// pulled in via AlbumPage/TrackPage/ComparePage), Methodology, all admin
// + import surfaces, etc. — none of which the user sees on launch.
import { ForYouPage } from "./pages/ForYouPage.jsx";

// Helper: React.lazy expects a default export, but pages use named exports.
// This thunks the dynamic import to remap the named export to default.
const lazyNamed = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));

const SearchPage         = lazyNamed(() => import("./pages/SearchPage.jsx"),         "SearchPage");
const ComparePage        = lazyNamed(() => import("./pages/ComparePage.jsx"),        "ComparePage");
const ProfilePage        = lazyNamed(() => import("./pages/ProfilePage.jsx"),        "ProfilePage");
const AlbumPage          = lazyNamed(() => import("./pages/AlbumPage.jsx"),          "AlbumPage");
const TrackPage          = lazyNamed(() => import("./pages/TrackPage.jsx"),          "TrackPage");
const ArtistPage         = lazyNamed(() => import("./pages/ArtistPage.jsx"),         "ArtistPage");
const SavedComparisonPage = lazyNamed(() => import("./pages/SavedComparisonPage.jsx"), "SavedComparisonPage");
const AuthSuccessPage    = lazyNamed(() => import("./pages/AuthSuccessPage.jsx"),    "AuthSuccessPage");
const UserPage           = lazyNamed(() => import("./pages/UserPage.jsx"),           "UserPage");
const LeaderboardPage    = lazyNamed(() => import("./pages/LeaderboardPage.jsx"),    "LeaderboardPage");
const NotificationsPage  = lazyNamed(() => import("./pages/NotificationsPage.jsx"),  "NotificationsPage");
const Methodology        = lazyNamed(() => import("./components/Methodology.jsx"),   "Methodology");
const PrivacyPage        = lazyNamed(() => import("./pages/PrivacyPage.jsx"),        "PrivacyPage");
const TermsPage          = lazyNamed(() => import("./pages/TermsPage.jsx"),          "TermsPage");
const ListDetailPage     = lazyNamed(() => import("./pages/ListDetailPage.jsx"),     "ListDetailPage");
const BlocksPage         = lazyNamed(() => import("./pages/BlocksPage.jsx"),         "BlocksPage");
const DislikedArtistsPage = lazyNamed(() => import("./pages/DislikedArtistsPage.jsx"), "DislikedArtistsPage");
const AdminReportsPage   = lazyNamed(() => import("./pages/AdminReportsPage.jsx"),   "AdminReportsPage");
const ImportPage         = lazyNamed(() => import("./pages/ImportPage.jsx"),         "ImportPage");
const TrendingPage       = lazyNamed(() => import("./pages/TrendingPage.jsx"),       "TrendingPage");
const FriendsPage        = lazyNamed(() => import("./pages/FriendsPage.jsx"),        "FriendsPage");
const SettingsPage       = lazyNamed(() => import("./pages/SettingsPage.jsx"),       "SettingsPage");
const TasteProfilePage   = lazyNamed(() => import("./pages/TasteProfilePage.jsx"),   "TasteProfilePage");
const TasteMatchPage     = lazyNamed(() => import("./pages/TasteMatchPage.jsx"),     "TasteMatchPage");

/**
 * Listens for Capacitor `appUrlOpen` events — fired when iOS / Android
 * resumes the app via a registered URL scheme. We use this to complete the
 * Google OAuth flow on native: after the user signs in in external Safari,
 * the backend redirects to `contour://auth?token=...`, iOS wakes the app
 * up with that URL, and this handler routes it to /auth/success which
 * already knows how to exchange the token for a session.
 *
 * No-op on web — Capacitor.isNativePlatform() is false in the browser.
 */
/**
 * Capacitor app-lifecycle handler — addresses "white screen on resume."
 *
 * The Capacitor iOS app is a thin WKWebView shell loading
 * https://contour-rosy.vercel.app. iOS can evict the WebView's JS
 * heap when the app is backgrounded under memory pressure; on resume
 * the page reloads from scratch. Two known failure modes during that
 * reload:
 *
 *   1. SplashScreen.hide() is only called once at first main.jsx
 *      parse. The Capacitor SplashScreen plugin has
 *      launchAutoHide:false, so on the SECOND boot after eviction —
 *      if for any reason main.jsx is slower to parse than usual —
 *      the native splash can hold over a non-yet-mounted WebView.
 *      We re-call .hide() on every resume defensively. No-op when
 *      the splash isn't up.
 *
 *   2. Render exceptions during the resume path (expired auth, stale
 *      localStorage shape, etc.) unmount the React tree. The
 *      top-level ErrorBoundary in main.jsx catches those — this
 *      listener just makes the lifecycle visible for diagnosis.
 *
 * Debug overlay: gated behind ?debug=resume in the URL. Renders a
 * ring buffer of state-change events in the corner — finger-screenshot
 * is the easiest way to send the data over. NOT shown in production
 * by default; you have to opt in. Same pattern as ?debug=splash
 * elsewhere in the codebase.
 *
 * Web is a no-op — Capacitor.isNativePlatform() returns false in
 * Safari / Chrome so the listener never registers.
 */
function NativeResumeHandler() {
  const [events, setEvents] = useState([]);
  const ringRef = useRef([]);
  const debug = typeof window !== "undefined"
    && /[?&]debug=resume(\b|$)/.test(window.location.search);

  useEffect(() => {
    if (!isNativePlatform()) return;
    let cancelled = false;
    let removeAppState = null;
    let removeResume = null;

    function record(label) {
      const t = new Date().toISOString().slice(11, 23);
      const entry = `${t} ${label}`;
      ringRef.current = [...ringRef.current.slice(-9), entry];
      if (debug) setEvents([...ringRef.current]);
      // eslint-disable-next-line no-console
      console.log("[NativeResumeHandler]", entry);
    }

    async function hideSplashDefensively(reason) {
      try {
        const mod = await import("@capacitor/splash-screen");
        // No-op if splash isn't showing. Failure is non-fatal — the
        // user has the in-page boot splash + the React app to fall
        // back on.
        await mod.SplashScreen.hide({ fadeOutDuration: 150 });
        record(`splash hide ok (${reason})`);
      } catch (e) {
        record(`splash hide err (${reason}): ${e?.message || e}`);
      }
    }

    record("listener mounted");

    import("@capacitor/app").then(({ App: CapApp }) => {
      if (cancelled) return;
      CapApp.addListener("appStateChange", ({ isActive }) => {
        record(`appStateChange isActive=${isActive}`);
        if (isActive) {
          // Resumed from background. Defensive splash hide for the
          // post-eviction "native splash never dismissed on second
          // boot" case. Cheap; safe to call when splash isn't up.
          hideSplashDefensively("appStateChange");
        }
      }).then((h) => { removeAppState = h; });

      // The dedicated "resume" event isn't always emitted by every
      // Capacitor version — listen for both and de-dup via the ring
      // buffer.
      CapApp.addListener("resume", () => {
        record("resume");
        hideSplashDefensively("resume");
      }).then((h) => { removeResume = h; });
    }).catch((e) => record(`@capacitor/app import err: ${e?.message || e}`));

    return () => {
      cancelled = true;
      if (removeAppState && typeof removeAppState.remove === "function") removeAppState.remove();
      if (removeResume && typeof removeResume.remove === "function") removeResume.remove();
    };
  }, [debug]);

  if (!debug || !events.length) return null;
  return (
    <div style={{
      position: "fixed", bottom: 12, right: 12, zIndex: 99998,
      background: "rgba(0,0,0,0.82)", color: "#0ff",
      padding: "6px 8px", borderRadius: 4,
      fontSize: 10, fontFamily: "'SF Mono', Menlo, monospace",
      lineHeight: 1.35, pointerEvents: "none",
      maxWidth: 260, whiteSpace: "pre-wrap",
    }}>
      resume log:{"\n"}{events.join("\n")}
    </div>
  );
}


function NativeDeepLinkHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isNativePlatform()) return;
    let removeHandler = null;
    let cancelled = false;
    // Dynamic import keeps the @capacitor/app code out of the web bundle's
    // critical path — it's only needed inside the native shell.
    import("@capacitor/app").then(({ App: CapApp }) => {
      if (cancelled) return;
      CapApp.addListener("appUrlOpen", ({ url }) => {
        // Examples:
        //   contour://auth?token=eyJ...&provider=google
        try {
          // URL constructor parses non-standard schemes correctly in modern
          // engines — protocol="contour:", hostname="auth", search="?token=..."
          const u = new URL(url);
          if (u.protocol !== "contour:") return;
          // Either contour://auth or contour:auth — accept both shapes.
          const host = u.hostname || u.pathname.replace(/^\/*/, "").split("/")[0] || "";
          if (host === "auth") {
            navigate(`${ROUTES.AUTH_SUCCESS}${u.search || ""}`);
          }
        } catch {
          // Malformed deep link — ignore. Better than crashing the WebView.
        }
      }).then((h) => { removeHandler = h; });
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (removeHandler && typeof removeHandler.remove === "function") {
        removeHandler.remove();
      }
    };
  }, [navigate]);
  return null;
}

export default function App() {
  // Hide the inline boot-splash once React is actually mounted AND
  // fonts are ready. Both conditions matter:
  //   - React mounted = the app is on screen, not a black body bg
  //   - Fonts ready = the header wordmark won't font-swap from
  //     the system serif fallback (Iowan Old Style on iOS) to
  //     Instrument Serif a few hundred ms later
  // Pre-2026-05-25, main.jsx hid the splash on fontReady alone,
  // which meant on slow cold cellular boots the splash dropped
  // BEFORE React mounted → black screen visible. This effect
  // moves the trigger to React's actual paint commit. The
  // inline-HTML 12s watchdog in index.html stays as the truly-
  // stuck recovery story.
  useEffect(() => {
    let hidden = false;
    function hideSplashIfReady() {
      if (hidden) return;
      if (!window.__contour_fonts_ready) return;
      const splash = document.getElementById("boot-splash");
      if (splash) splash.style.display = "none";
      hidden = true;
    }
    // First attempt — fonts may already be ready by the time this
    // effect runs (if main.jsx's fontReady promise resolved fast).
    hideSplashIfReady();
    // Otherwise wait for the event main.jsx dispatches.
    window.addEventListener("contour:fonts-ready", hideSplashIfReady);
    return () => window.removeEventListener("contour:fonts-ready", hideSplashIfReady);
  }, []);

  // Prefetch likely-next-tab data so navigation to those surfaces is
  // instant. Fires in the background after a 400ms idle delay so it
  // doesn't compete with the cold-start path's bundle + first-paint
  // work. By the time the user has read the deck card and tapped Search
  // or Friends, the data's already in the SWR cache and the page snaps
  // open with no spinner. Failures are silent — the consuming component's
  // own useCachedFetch retries on mount.
  useEffect(() => {
    const t = setTimeout(() => {
      // Public endpoints, safe pre-auth. Anything that depends on the
      // signed-in user (feed personalization, profile) is NOT prefetched
      // here — those caches live in useCachedFetch keyed by user.id
      // and need the auth provider settled first.
      prefetchIntoCache("search:featured", () => api.getFeatured());
      prefetchIntoCache("search:trending-albums:7d", () => api.getTrendingAlbums("7d", 10));
      prefetchIntoCache("trending:albums:7d", () =>
        api.getTrendingAlbums("7d", 20).catch(() => ({ items: [], label: "Trending" }))
      );
    }, 400);
    return () => clearTimeout(t);
  }, []);

  // Prefetch the JS chunks for the most-likely-next routes. On cold
  // cellular, the lazy-import chunk download is often the dominant
  // cost when a user first navigates away from the deck (200-800ms
  // per chunk). Firing import() here triggers the browser fetch +
  // parse; the chunk lands in module cache and the lazy() in Routes
  // resolves synchronously when the user later navigates.
  //
  // Order = approximate frequency of "next destination after the
  // deck." Profile first because every signed-in user goes there
  // to check ratings; Search second; then Friends/Trending. The
  // 1s delay puts these well past first paint so they don't
  // compete with deck rendering.
  //
  // Returned promises are intentionally discarded — Vite caches the
  // module by chunk hash so the lazy() call later picks it up
  // instantly. Failures (chunk 404, network drop) are swallowed;
  // the lazy() retry on actual navigation handles those.
  useEffect(() => {
    const t = setTimeout(() => {
      import("./pages/ProfilePage.jsx").catch(() => {});
      import("./pages/SearchPage.jsx").catch(() => {});
      import("./pages/FriendsPage.jsx").catch(() => {});
      import("./pages/TrendingPage.jsx").catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
    {/* SigninGate paints on top of everything for signed-out, non-guest
        visitors. Once dismissed (sign-in or guest-mode opt-in), the
        OnboardingModal takes over with genre picker + import upsell. */}
    <NativeDeepLinkHandler />
    <NativeResumeHandler />
    <SigninGate />
    <OnboardingModal />
    {/* Lazy-loaded routes need a Suspense boundary. Fallback is just a
        bg-coloured div so the previous route's content fades out into
        an empty page-bg surface rather than flashing white while the
        chunk downloads. */}
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--bg)" }} />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ForYouPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="compare" element={<ComparePage />} />
          <Route path="methodology" element={<Methodology />} />
          <Route path="album/:id" element={<AlbumPage />} />
          <Route path="track/:id" element={<TrackPage />} />
          <Route path="artist/:id" element={<ArtistPage />} />
          <Route path="compare/:id" element={<SavedComparisonPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="user/:id" element={<UserPage />} />
          {/* /feed retired — Friends timeline now lives as a tab on / (For You). */}
          <Route path="charts" element={<LeaderboardPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="auth/success" element={<AuthSuccessPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="terms" element={<TermsPage />} />
          <Route path="list/:id" element={<ListDetailPage />} />
          <Route path="blocks" element={<BlocksPage />} />
          <Route path="disliked-artists" element={<DislikedArtistsPage />} />
          <Route path="admin/reports" element={<AdminReportsPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="trending" element={<TrendingPage />} />
          <Route path="friends" element={<FriendsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/taste-profile" element={<TasteProfilePage />} />
          <Route path="taste-match/:id" element={<TasteMatchPage />} />
        </Route>
      </Routes>
    </Suspense>
    </>
  );
}
