import { useEffect, lazy, Suspense } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout.jsx";
import { OnboardingModal } from "./components/OnboardingModal.jsx";
import { SigninGate } from "./components/SigninGate.jsx";
import { isNativePlatform } from "./utils/native.js";
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
            navigate(`/auth/success${u.search || ""}`);
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
  return (
    <>
    {/* SigninGate paints on top of everything for signed-out, non-guest
        visitors. Once dismissed (sign-in or guest-mode opt-in), the
        OnboardingModal takes over with genre picker + import upsell. */}
    <NativeDeepLinkHandler />
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
        </Route>
      </Routes>
    </Suspense>
    </>
  );
}
