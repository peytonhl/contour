import { FollowingTab } from "../components/FollowingTab.jsx";

// Top-level Friends surface — bottom-nav and desktop-nav target. Wraps the
// existing FollowingTab component (which still drives the For You "Friends"
// sub-tab) with a page-level heading. FollowingTab already handles the
// signed-out, empty-state, and suggested-users surfaces, so this page is
// intentionally thin.
export function FriendsPage() {
  return (
    <div style={{ padding: "24px 0 60px" }}>
      <h1 style={{
        fontFamily: "var(--font-display)",
        fontSize: 32, fontWeight: 400,
        color: "var(--text)",
        margin: "0 auto 16px",
        maxWidth: 600,
        padding: "0 20px",
      }}>
        Friends
      </h1>
      <FollowingTab />
    </div>
  );
}
