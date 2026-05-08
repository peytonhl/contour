import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const GOLD = "#f59e0b";
const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";
const DANGER = "#f87171";

const ENTITY_COLOR = { album: ACCENT_A, track: ACCENT_B, artist: "#fb923c" };
const SORT_LABELS = [
  { key: "recent", label: "Recent" },
  { key: "top", label: "Top" },
  { key: "controversial", label: "Controversial" },
];

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

function RatingBadge({ value }) {
  const high = value >= 4;
  const mid = value >= 3;
  return (
    <div style={{
      padding: "3px 9px", borderRadius: 4, fontSize: 12, fontWeight: 700, flexShrink: 0,
      background: high ? `${GOLD}18` : mid ? `${GOLD}0a` : "var(--surface2)",
      border: `1px solid ${high ? `${GOLD}50` : "var(--border)"}`,
      color: high ? GOLD : mid ? `${GOLD}99` : "var(--text-muted)",
    }}>{value}★</div>
  );
}

// ── Review card for the Discover feed ────────────────────────────────────────
function DiscoverCard({ item, user, onVote, badges }) {
  const [copiedShare, setCopiedShare] = useState(false);
  const entityPath = `/${item.entity_type}/${item.entity_id}#review-${item.id}`;

  async function handleShare() {
    const url = `${window.location.origin}/${item.entity_type}/${item.entity_id}#review-${item.id}`;
    if (navigator.share) {
      try { await navigator.share({ url }); } catch { /* cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        setCopiedShare(true);
        setTimeout(() => setCopiedShare(false), 2000);
      } catch { /* blocked */ }
    }
  }

  return (
    <div style={{ padding: "16px 0", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Entity row */}
      <Link to={`/${item.entity_type}/${item.entity_id}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        {item.entity_image_url
          ? <img src={item.entity_image_url} alt="" style={{ width: 42, height: 42, borderRadius: item.entity_type === "artist" ? "50%" : 6, objectFit: "cover", flexShrink: 0 }} />
          : <div style={{ width: 42, height: 42, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: ENTITY_COLOR[item.entity_type] ?? "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.entity_name ?? item.entity_id}
          </div>
          {item.entity_artists?.length > 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.entity_artists.slice(0, 2).join(", ")}</div>
          )}
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: ENTITY_COLOR[item.entity_type], padding: "2px 8px", borderRadius: 20, background: `${ENTITY_COLOR[item.entity_type]}18`, border: `1px solid ${ENTITY_COLOR[item.entity_type]}40`, flexShrink: 0 }}>
          {item.entity_type}
        </span>
      </Link>

      {/* Reviewer */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link to={`/user/${item.user?.id}`} style={{ flexShrink: 0 }}>
          {item.user?.image_url
            ? <img src={item.user.image_url} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }} />
            : <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--surface2)" }} />
          }
        </Link>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Link to={`/user/${item.user?.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", textDecoration: "none" }}>{item.user?.display_name}</Link>
            {item.rating && <RatingBadge value={item.rating} />}
            <BadgeChips badges={badges} userId={item.user?.id} />
          </div>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{timeAgo(item.created_at)}</span>
      </div>

      {/* Review body */}
      <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.65, margin: 0, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {item.body}
      </p>

      {/* Votes + share */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => user && onVote(item.id, 1)} disabled={!user}
          style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: "2px 4px", fontSize: 12, cursor: user ? "pointer" : "default", color: item.user_vote === 1 ? ACCENT_A : "var(--text-muted)", fontWeight: item.user_vote === 1 ? 700 : 400 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill={item.user_vote === 1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          {item.upvotes > 0 ? item.upvotes : ""}
        </button>
        <button onClick={() => user && onVote(item.id, -1)} disabled={!user}
          style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: "2px 4px", fontSize: 12, cursor: user ? "pointer" : "default", color: item.user_vote === -1 ? DANGER : "var(--text-muted)", fontWeight: item.user_vote === -1 ? 700 : 400 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill={item.user_vote === -1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          {item.downvotes > 0 ? item.downvotes : ""}
        </button>
        {item.replies_count > 0 && (
          <Link to={entityPath} style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>
            {item.replies_count} {item.replies_count === 1 ? "reply" : "replies"}
          </Link>
        )}
        <button onClick={handleShare}
          style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 12, color: copiedShare ? ACCENT_B : "var(--text-muted)", cursor: "pointer", padding: "2px 4px" }}>
          {copiedShare ? "✓ Copied" : "↗ Share"}
        </button>
      </div>
    </div>
  );
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
  const { user } = useAuth();
  const [tab, setTab] = useState("community"); // "community" | "following"
  const [sort, setSort] = useState("recent");
  const [discover, setDiscover] = useState([]);
  const [loadingDiscover, setLoadingDiscover] = useState(true);
  const [badges, setBadges] = useState(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Load badge leaderboard once
  useEffect(() => {
    api.getBadges().then(setBadges).catch(() => {});
  }, []);

  // Community reviews — reload when sort changes
  useEffect(() => {
    if (tab !== "community") return;
    setLoadingDiscover(true);
    api.getGlobalReviews(sort)
      .then(setDiscover)
      .catch(() => setDiscover([]))
      .finally(() => setLoadingDiscover(false));
  }, [sort, tab]);

  function handleVote(reviewId, value) {
    if (!user) return;
    api.voteReview(reviewId, value).then((res) => {
      setDiscover((prev) => prev.map((r) =>
        r.id === reviewId ? { ...r, upvotes: res.upvotes, downvotes: res.downvotes, user_vote: res.user_vote } : r
      ));
    });
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 20px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Community</h1>
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

      {/* Collapsible badge leaderboard */}
      {showLeaderboard && <BadgeLeaderboard badges={badges} />}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {[
          { key: "community", label: "All Reviews" },
          { key: "following", label: user ? "Following" : "Following" },
        ].map(({ key, label }) => {
          const active = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: "7px 16px", fontSize: 13, fontWeight: active ? 700 : 500,
              borderRadius: 6, border: "none", cursor: "pointer", whiteSpace: "nowrap",
              background: active ? "var(--surface2)" : "transparent",
              color: active ? "var(--text)" : "var(--text-muted)",
              outline: active ? "1px solid var(--border)" : "none",
              transition: "color 0.12s, background 0.12s",
            }}>{label}</button>
          );
        })}
      </div>

      {/* Community tab */}
      {tab === "community" && (
        <>
          {/* Sort controls */}
          <div style={{ display: "flex", gap: 0, padding: "8px 0 4px", borderBottom: "1px solid var(--border)" }}>
            {SORT_LABELS.map(({ key, label }) => (
              <button key={key} onClick={() => setSort(key)}
                style={{
                  padding: "4px 14px", fontSize: 12, fontWeight: sort === key ? 700 : 400,
                  background: sort === key ? "var(--surface2)" : "none",
                  border: sort === key ? "1px solid var(--border)" : "1px solid transparent",
                  borderRadius: 20, color: sort === key ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer", marginRight: 4,
                }}>
                {label}
              </button>
            ))}
          </div>

          {loadingDiscover && <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40 }}>Loading…</div>}
          {!loadingDiscover && discover.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 60, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.35 }}>
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              <p style={{ margin: 0, fontSize: 14 }}>No reviews yet — be the first to write one.</p>
            </div>
          )}
          {!loadingDiscover && discover.map((item) => (
            <DiscoverCard key={item.id} item={item} user={user} onVote={handleVote} badges={badges} />
          ))}
        </>
      )}

      {/* Following tab */}
      {tab === "following" && <FollowingTab />}
    </div>
  );
}
