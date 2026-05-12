import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const GOLD = "#f59e0b";
const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";

const ENTITY_COLOR = { album: ACCENT_A, track: ACCENT_B, artist: "#fb923c" };

// ── Badge definitions ─────────────────────────────────────────────────────────
export const BADGE_DEFS = [
  { key: "critics",      emoji: "✍️",  label: "Top Critic",     color: "#a78bfa", title: "Top 5 most reviews written" },
  { key: "influencers",  emoji: "⬆️",  label: "Influential",    color: "#34d399", title: "Top 5 most upvotes received" },
  { key: "connectors",   emoji: "👥",  label: "Most Followed",  color: "#fb923c", title: "Top 5 most followers" },
];

/**
 * Given the badges object from the API, return which badge keys this userId holds.
 * badges = { critics: [{id,...}], influencers: [...], connectors: [...] }
 */
export function getBadgesForUser(badges, userId) {
  if (!badges || !userId) return [];
  return BADGE_DEFS.filter((def) =>
    (badges[def.key] ?? []).some((u) => u.id === userId)
  );
}

export function BadgeChips({ badges, userId, size = "sm" }) {
  const held = getBadgesForUser(badges, userId);
  if (!held.length) return null;
  const fs = size === "sm" ? 10 : 12;
  const pad = size === "sm" ? "2px 7px" : "3px 10px";
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {held.map((b) => (
        <span
          key={b.key}
          title={b.title}
          style={{
            fontSize: fs, fontWeight: 700, padding: pad,
            borderRadius: 20,
            background: `${b.color}18`,
            border: `1px solid ${b.color}50`,
            color: b.color,
            whiteSpace: "nowrap",
          }}
        >
          {b.emoji} {b.label}
        </span>
      ))}
    </span>
  );
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── Following feed item (existing) ────────────────────────────────────────────
function FollowingItem({ item }) {
  const entityPath = `/${item.entity_type}/${item.entity_id}`;
  const userPath = `/user/${item.user?.id}`;
  const isReview = item.type === "review";

  return (
    <div style={{ display: "flex", gap: 14, padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
      <Link to={userPath} style={{ flexShrink: 0 }}>
        {item.user?.image_url
          ? <img src={item.user.image_url} alt={item.user.display_name} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }} />
          : <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--surface2)" }} />
        }
      </Link>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <Link to={userPath} style={{ color: "var(--text)", fontWeight: 700, textDecoration: "none" }}>{item.user?.display_name}</Link>
          <span style={{ color: "var(--text-muted)" }}>{isReview ? " reviewed " : " rated "}</span>
          <Link to={entityPath} style={{ color: ENTITY_COLOR[item.entity_type] ?? "var(--text)", fontWeight: 600, textDecoration: "none" }}>
            {item.entity_name ?? item.entity_id}
          </Link>
          {item.entity_artists?.length > 0 && (
            <span style={{ color: "var(--text-muted)" }}> by {item.entity_artists.slice(0, 2).join(", ")}</span>
          )}
        </div>
        {item.value && (
          <span style={{ display: "inline-flex", gap: 1 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} style={{ fontSize: 13, color: item.value >= n - 0.5 ? GOLD : "var(--border)", opacity: item.value >= n - 0.5 ? 1 : 0.3 }}>★</span>
            ))}
          </span>
        )}
        {isReview && item.body && (
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: 0, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {item.body}
          </p>
        )}
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{timeAgo(item.created_at)}</span>
      </div>
      {item.entity_image_url && (
        <Link to={entityPath} style={{ flexShrink: 0 }}>
          <img src={item.entity_image_url} alt={item.entity_name} style={{ width: 48, height: 48, borderRadius: item.entity_type === "artist" ? "50%" : 6, objectFit: "cover" }} />
        </Link>
      )}
    </div>
  );
}

// ── Suggested user row ────────────────────────────────────────────────────────
function SuggestedUser({ u, onFollow }) {
  const [followed, setFollowed] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  async function handleFollow() {
    if (!user) return;
    setLoading(true);
    try {
      await api.toggleFollow(u.id);
      analytics.followUser();
      setFollowed(true);
      setTimeout(() => onFollow(u.id), 600);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Link to={`/user/${u.id}`} style={{ flexShrink: 0 }}>
        {u.image_url
          ? <img src={u.image_url} alt={u.display_name} style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
          : <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--surface2)" }} />
        }
      </Link>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link to={`/user/${u.id}`} style={{ color: "var(--text)", fontWeight: 600, fontSize: 14, textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {u.display_name}
        </Link>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
          {u.bio ? u.bio.slice(0, 60) + (u.bio.length > 60 ? "…" : "") : `${u.reviews_count} review${u.reviews_count !== 1 ? "s" : ""}`}
        </div>
      </div>
      {user && (
        <button
          onClick={handleFollow} disabled={loading || followed}
          style={{
            padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
            border: `1px solid ${followed ? "var(--border)" : ACCENT_A}`,
            background: followed ? "var(--surface2)" : `${ACCENT_A}18`,
            color: followed ? "var(--text-muted)" : ACCENT_A,
            cursor: loading || followed ? "default" : "pointer",
            transition: "all 0.15s", flexShrink: 0,
          }}
        >
          {followed ? "Following ✓" : "Follow"}
        </button>
      )}
    </div>
  );
}

// ── Following tab — exported so ForYouPage can embed it ──────────────────────
export function FollowingTab() {
  const { user } = useAuth();
  const [following, setFollowing] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [loadingFollowing, setLoadingFollowing] = useState(false);

  useEffect(() => {
    api.getSuggestedUsers().then(setSuggested).catch(() => {});
    if (!user) return;
    setLoadingFollowing(true);
    api.getFeed()
      .then(setFollowing)
      .catch(() => setFollowing([]))
      .finally(() => setLoadingFollowing(false));
  }, [user]);

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 20px", overflowY: "auto", height: "100%" }}>
      {!user && (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 60, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.35 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: 0 }}>Sign in to see your feed</p>
          <p style={{ fontSize: 13, margin: 0 }}>Follow other users to see their activity here.</p>
        </div>
      )}
      {user && loadingFollowing && <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40 }}>Loading…</div>}
      {user && !loadingFollowing && following.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "24px 0" }}>
          <div style={{ textAlign: "center", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: 0 }}>Nothing here yet</p>
            <p style={{ fontSize: 13, margin: 0 }}>Follow people to see their ratings and reviews here.</p>
          </div>
          {suggested.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", margin: 0 }}>
                People to follow
              </p>
              {suggested.map((u) => (
                <SuggestedUser key={u.id} u={u} onFollow={(id) => setSuggested((prev) => prev.filter((x) => x.id !== id))} />
              ))}
            </div>
          )}
        </div>
      )}
      {user && !loadingFollowing && following.map((item, i) => (
        <FollowingItem key={`${item.type}-${item.user?.id}-${item.entity_id}-${i}`} item={item} />
      ))}
    </div>
  );
}

// ── Badge leaderboard sidebar section ────────────────────────────────────────
function BadgeLeaderboard({ badges }) {
  if (!badges) return null;
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "16px 18px",
      marginBottom: 20,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 14 }}>
        Community Top 5
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {BADGE_DEFS.map((def) => {
          const list = badges[def.key] ?? [];
          if (!list.length) return null;
          return (
            <div key={def.key}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 13 }}>{def.emoji}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: def.color, letterSpacing: "0.04em", textTransform: "uppercase" }}>{def.label}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {list.map((u, i) => (
                  <Link key={u.id} to={`/user/${u.id}`} style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", width: 14, flexShrink: 0 }}>#{i + 1}</span>
                    {u.image_url
                      ? <img src={u.image_url} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                      : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
                    }
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.display_name}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{u.score}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function FeedPage() {
  const [badges, setBadges] = useState(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Top 5 leaderboard data — community-flavored discovery for finding people
  // to follow. Lives here because /feed is the social surface; the actual
  // social timeline (FollowingTab) is the main content below.
  useEffect(() => {
    api.getBadges().then(setBadges).catch(() => {});
  }, []);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 20px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Feed</h1>
        <button
          onClick={() => setShowLeaderboard((v) => !v)}
          title="Top 5 leaderboard"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 20,
            background: showLeaderboard ? "var(--surface2)" : "transparent",
            border: `1px solid ${showLeaderboard ? "var(--border)" : "transparent"}`,
            color: showLeaderboard ? "var(--text)" : "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          🏆 Top 5
        </button>
      </div>

      {/* Collapsible badge leaderboard — discovery aid for finding people to follow. */}
      {showLeaderboard && <BadgeLeaderboard badges={badges} />}

      {/* Social timeline — what people you follow have rated and reviewed.
          (The community-wide "All Reviews" feed moved to the Reviews tab on /.) */}
      <FollowingTab />
    </div>
  );
}
