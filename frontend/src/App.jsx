import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout.jsx";
import { SearchPage } from "./pages/SearchPage.jsx";
import { ComparePage } from "./pages/ComparePage.jsx";
import { ProfilePage } from "./pages/ProfilePage.jsx";
import { AlbumPage } from "./pages/AlbumPage.jsx";
import { TrackPage } from "./pages/TrackPage.jsx";
import { ArtistPage } from "./pages/ArtistPage.jsx";
import { SavedComparisonPage } from "./pages/SavedComparisonPage.jsx";
import { AuthSuccessPage } from "./pages/AuthSuccessPage.jsx";
import { UserPage } from "./pages/UserPage.jsx";
import { FeedPage } from "./pages/FeedPage.jsx";
import { Methodology } from "./components/Methodology.jsx";
import { PrivacyPage } from "./pages/PrivacyPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<SearchPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="methodology" element={<Methodology />} />
        <Route path="album/:id" element={<AlbumPage />} />
        <Route path="track/:id" element={<TrackPage />} />
        <Route path="artist/:id" element={<ArtistPage />} />
        <Route path="compare/:id" element={<SavedComparisonPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="user/:id" element={<UserPage />} />
        <Route path="feed" element={<FeedPage />} />
        <Route path="auth/success" element={<AuthSuccessPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
      </Route>
    </Routes>
  );
}
