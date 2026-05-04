import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
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

function Stars({ value }) {
  return (
    <span style={{ display: "inline-flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ fontSize: 12, color: value >= n - 0.5 ? GOLD : "var(--border)", opacity: value >= n - 0.5 ? 1 : 0.3 }}>★</span>
      ))}
    </span>
  );
}

// ── Review card for the Discover feed ────────────────────────────────────────
function DiscoverCard({ item, user, onVote }) {
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
        <Link to={`/user/${item.user?.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", textDecoration: "none" }}>{item.user?.display_name}</Link>
        {item.rating && <Stars value={item.rating} />}
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>{timeAgo(item.created_at)}</span>
      </div>

      {/* Review body */}
      <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.65, margin: 0, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {item.body}
      </p>

      {/* Votes + share */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => user && onVote(item.id, 1)} disabled={!user}
          style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, fontSize: 13, cursor: user ? "pointer" : "default", color: item.user_vote === 1 ? ACCENT_A : "var(--text-muted)", fontWeight: item.user_vote === 1 ? 700 : 400 }}>
          ▲ {item.upvotes > 0 ? item.upvotes : ""}
        </button>
        <button onClick={() => user && onVote(item.id, -1)} disabled={!user}
          style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, fontSize: 13, cursor: user ? "pointer" : "default", color: item.user_vote === -1 ? DANGER : "var(--text-muted)", fontWeight: item.user_vote === -1 ? 700 : 400 }}>
          ▼ {item.downvotes > 0 ? item.downvotes : ""}
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

// ── Page ──────────────────────────────────────────────────────────────────────
export function FeedPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("discover"); // "following" | "discover"
  const [sort, setSort] = useState("recent");
  const [following, setFollowing] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [loadingFollowing, setLoadingFollowing] = useState(false);
  const [loadingDiscover, setLoadingDiscover] = useState(true);

  // Discover always loads
  useEffect(() => {
    setLoadingDiscover(true);
    api.getGlobalReviews(sort)
      .then(setDiscover)
      .catch(() => setDiscover([]))
      .finally(() => setLoadingDiscover(false));
  }, [sort]);

  // Following + suggested load when tab is active
  useEffect(() => {
    if (tab !== "following") return;
    if (suggested.length === 0) {
      api.getSuggestedUsers().then(setSuggested).catch(() => {});
    }
    if (!user || following.length > 0) return;
    setLoadingFollowing(true);
    api.getFeed()
      .then(setFollowing)
      .catch(() => setFollowing([]))
      .finally(() => setLoadingFollowing(false));
  }, [user, tab]);

  function handleVote(reviewId, value) {
    if (!user) return;
    api.voteReview(reviewId, value).then((res) => {
      setDiscover((prev) => prev.map((r) =>
        r.id === reviewId ? { ...r, upvotes: res.upvotes, downvotes: res.downvotes, user_vote: res.user_vote } : r
      ));
    });
  }

  const tabStyle = (active) => ({
    padding: "10px 20px", fontSize: 14, fontWeight: active ? 700 : 400,
    background: "none", border: "none", cursor: "pointer",
    borderBottom: active ? `2px solid ${ACCENT_A}` : "2px solid transparent",
    color: active ? "var(--text)" : "var(--text-muted)",
    marginBottom: -1,
  });

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "24px 20px" }}>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 0 }}>
        <button style={tabStyle(tab === "discover")} onClick={() => setTab("discover")}>Discover</button>
        <button style={tabStyle(tab === "following")} onClick={() => setTab("following")}>
          Following {!user && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>(sign in)</span>}
        </button>
      </div>

      {/* Discover tab */}
      {tab === "discover" && (
        <>
          {/* Sort controls */}
          <div style={{ display: "flex", gap: 0, padding: "12px 0 4px", borderBottom: "1px solid var(--border)" }}>
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
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 60 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✍️</div>
              <p>No reviews yet. Be the first to write one!</p>
            </div>
          )}
          {!loadingDiscover && discover.map((item) => (
            <DiscoverCard key={item.id} item={item} user={user} onVote={handleVote} />
          ))}
        </>
      )}

      {/* Following tab */}
      {tab === "following" && (
        <>
          {!user && (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 60, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 32 }}>🔒</div>
              <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Sign in to see your feed</p>
              <p style={{ fontSize: 13 }}>Follow other users to see their activity here.</p>
            </div>
          )}
          {user && loadingFollowing && <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40 }}>Loading…</div>}
          {user && !loadingFollowing && following.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "24px 0" }}>
              <div style={{ textAlign: "center", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: 0 }}>Nothing here yet</p>
                <p style={{ fontSize: 13, margin: 0 }}>Follow people to see their activity in your feed.</p>
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
        </>
      )}
    </div>
  );
}
