import { useState } from "react";
import { FollowingTab } from "../components/FollowingTab.jsx";
import { FindFriendsModal } from "../components/FindFriendsModal.jsx";
import { ACCENT_A as ACCENT } from "../theme.js";

// Top-level Friends surface — bottom-nav and desktop-nav target. Wraps the
// existing FollowingTab component (which still drives the For You "Friends"
// sub-tab) with a page-level heading + a "find friends" action button.
//
// The + button surfaces the existing get_suggested_users endpoint plus a
// user-only search in a single modal — discoverable entry point for
// growing the follow graph rather than relying on the inline "More people
// to follow" tail in FollowingTab.
export function FriendsPage() {
  const [findOpen, setFindOpen] = useState(false);
  return (
    <div style={{ padding: "24px 0 60px" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        margin: "0 auto 16px",
        maxWidth: 600,
        padding: "0 20px",
        gap: 12,
      }}>
        <h1 style={{
          fontFamily: "var(--font-display)",
          fontSize: 32, fontWeight: 400,
          color: "var(--text)",
          margin: 0,
        }}>
          Friends
        </h1>
        <button
          onClick={() => setFindOpen(true)}
          aria-label="Find friends"
          title="Find friends"
          style={{
            width: 36, height: 36,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: `${ACCENT}18`,
            border: `1px solid ${ACCENT}66`,
            borderRadius: "50%",
            color: ACCENT,
            cursor: "pointer",
            flexShrink: 0,
            padding: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>
      <FollowingTab />
      <FindFriendsModal open={findOpen} onClose={() => setFindOpen(false)} />
    </div>
  );
}
