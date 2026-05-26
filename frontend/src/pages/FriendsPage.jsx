import { useState } from "react";
import { FollowingTab } from "../components/FollowingTab.jsx";
import { FindFriendsModal } from "../components/FindFriendsModal.jsx";
import { CardPreviewModal } from "../components/CardPreviewModal.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { ACCENT_A as ACCENT } from "../theme.js";
import { userPath } from "../constants/routes.js";

// Top-level Following surface — bottom-nav and desktop-nav target. Wraps
// the existing FollowingTab component with a page-level heading + a
// "find people" action button.
//
// User-facing copy was previously "Friends" (route is still /friends to
// avoid breaking existing links / bookmarks / push-notification targets),
// but a user reported confusion: the relationship action button on a
// profile says "Follow", which is directional and one-way, while
// "Friends" connotes mutuality. The data model is pure one-way follow —
// there's no follows-back / is_friend / mutual check anywhere in the
// codebase. So the label was lying about the relationship type.
// Renamed all visible labels to "Following" to match what's actually
// stored. Route + component file names kept for diff hygiene.
//
// The + button surfaces the existing get_suggested_users endpoint plus a
// user-only search in a single modal — discoverable entry point for
// growing the follow graph rather than relying on the inline "More people
// to follow" tail in FollowingTab.
//
// The "Share my taste card" banner is the acquisition-mechanic surface.
// The community tab is where social-share intent peaks (the user is
// already thinking about other listeners), so a single-tap entry into the
// taste-card preview modal lives here in preference to bury-it-on-profile.
// Same modal + share dispatcher as the taste-match card, just pointed at
// /api/og/taste-card.
export function FriendsPage() {
  const { user } = useAuth();
  const [findOpen, setFindOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Card URL is rebuilt per-render so a freshly-logged-in user picks up
  // their own id immediately (no stale closure on a previous viewer).
  // The CardPreviewModal appends ?v=<version> internally.
  const cardUrl = user ? `/api/og/taste-card?user_id=${encodeURIComponent(user.id)}` : null;
  const shareUrl = user ? `${window.location.origin}${userPath(user.id)}` : null;
  const shareText = user ? `${user.display_name}'s music taste on Contour` : "";
  const fileName = user ? `contour-taste-card-${user.id}.png` : "contour-taste-card.png";

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
          Following
        </h1>
        <button
          onClick={() => setFindOpen(true)}
          aria-label="Find people to follow"
          title="Find people to follow"
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

      {/* Share-my-taste-card banner — only for authenticated users. We
          intentionally don't gate by rating count here; the modal fetches
          the PNG and the edge endpoint 404s under the 3-rating floor.
          When that happens, CardPreviewModal surfaces a friendly
          "Couldn't generate card" message inline, which doubles as a
          nudge to rate more. Cheaper than duplicating the floor on the
          client (and avoids the bug-class where the client check and
          server check drift apart on threshold changes). */}
      {user && (
        <div style={{
          maxWidth: 600,
          margin: "0 auto 20px",
          padding: "0 20px",
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 14px",
            background: `${ACCENT}12`,
            border: `1px solid ${ACCENT}44`,
            borderRadius: "var(--radius-xl)",
          }}>
            {/* Spark icon — visual cue that this produces a shareable
                artifact, not a settings toggle. Stroke matches the
                find-friends "+" button so the two CTAs read as a pair. */}
            <svg
              width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ flexShrink: 0 }}
              aria-hidden="true"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                Share your taste card
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                Top artists, genres, and rating stats in one image.
              </div>
            </div>
            <button
              onClick={() => setShareOpen(true)}
              style={{
                flexShrink: 0,
                padding: "8px 16px",
                background: ACCENT,
                border: "none",
                borderRadius: "var(--radius-xl)",
                color: "#000",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Share
            </button>
          </div>
        </div>
      )}

      <FollowingTab />
      <FindFriendsModal open={findOpen} onClose={() => setFindOpen(false)} />
      {/* Mount the preview modal alongside the find-friends modal. Only
          renders when shareOpen flips true; safe to mount when `user` is
          null because the modal itself short-circuits when cardUrl is
          empty and the trigger is gated above. */}
      {user && (
        <CardPreviewModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          cardUrl={cardUrl}
          shareUrl={shareUrl}
          shareText={shareText}
          fileName={fileName}
        />
      )}
    </div>
  );
}
