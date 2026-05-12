import { useEffect } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout.jsx";
import { OnboardingModal } from "./components/OnboardingModal.jsx";
import { SigninGate } from "./components/SigninGate.jsx";
import { isNativePlatform } from "./utils/native.js";
import { SearchPage } from "./pages/SearchPage.jsx";
import { ComparePage } from "./pages/ComparePage.jsx";
import { ProfilePage } from "./pages/ProfilePage.jsx";
import { AlbumPage } from "./pages/AlbumPage.jsx";
import { TrackPage } from "./pages/TrackPage.jsx";
import { ArtistPage } from "./pages/ArtistPage.jsx";
import { SavedComparisonPage } from "./pages/SavedComparisonPage.jsx";
import { AuthSuccessPage } from "./pages/AuthSuccessPage.jsx";
import { UserPage } from "./pages/UserPage.jsx";
import { LeaderboardPage } from "./pages/LeaderboardPage.jsx";
import { NotificationsPage } from "./pages/NotificationsPage.jsx";
import { ForYouPage } from "./pages/ForYouPage.jsx";
import { Methodology } from "./components/Methodology.jsx";
import { PrivacyPage } from "./pages/PrivacyPage.jsx";
import { ListDetailPage } from "./pages/ListDetailPage.jsx";
import { BlocksPage } from "./pages/BlocksPage.jsx";
import { DislikedArtistsPage } from "./pages/DislikedArtistsPage.jsx";
import { AdminReportsPage } from "./pages/AdminReportsPage.jsx";
import { ImportPage } from "./pages/ImportPage.jsx";
import { TrendingPage } from "./pages/TrendingPage.jsx";

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
        <Route path="list/:id" element={<ListDetailPage />} />
        <Route path="blocks" element={<BlocksPage />} />
        <Route path="disliked-artists" element={<DislikedArtistsPage />} />
        <Route path="admin/reports" element={<AdminReportsPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="trending" element={<TrendingPage />} />
      </Route>
    </Routes>
    </>
  );
}
