import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout.jsx";
import { OnboardingModal } from "./components/OnboardingModal.jsx";
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
import { AdminReportsPage } from "./pages/AdminReportsPage.jsx";
import { ImportPage } from "./pages/ImportPage.jsx";
import { TrendingPage } from "./pages/TrendingPage.jsx";

export default function App() {
  return (
    <>
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
        <Route path="admin/reports" element={<AdminReportsPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="trending" element={<TrendingPage />} />
      </Route>
    </Routes>
    </>
  );
}
