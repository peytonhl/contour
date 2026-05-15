import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { ReplyThread } from "./ReviewSection.jsx";
import { ShareButton } from "./ShareButton.jsx";

const GOLD = "#f59e0b";
const ACCENT_A = "#d97a3b";

const ENTITY_COLOR = { album: ACCENT_A, track: "#6a90b5", artist: "#fb923c" };

function timeAgo(iso) {
  // Backend serializes naive UTC; treat tz-less strings as UTC so non-UTC
  // clients don't show negative values like "-219m ago".
  const normalized = /[Z+-]\d{2}:?\d{2}$|Z$/.test(iso) ? iso : `${iso}Z`;
  const diff = Math.max(0, Date.now() - new Date(normalized).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── Action row: vote / share / reply on review items ─────────────────────────
// Sits inside the FollowingItem column for `type === "review"`. Vote/reply
// require auth (buttons render but no-op when signed out, mirroring how the
// album-page ReviewSection behaves); share works for everyone since the
// payload is just the review snippet + entity deep link.
function ReviewActionRow({ item, viewer }) {
  const [upvotes, setUpvotes] = useState(item.upvotes ?? 0);
  const [downvotes, setDownvotes] = useState(item.downvotes ?? 0);
  const [userVote, setUserVote] = useState(item.user_vote ?? null);
  const [voting, setVoting] = useState(false);

  async function handleVote(value) {
    if (!viewer || voting) return;
    setVoting(true);
    try {
      const res = await api.voteReview(item.id, value);
      setUpvotes(res.upvotes);
      setDownvotes(res.downvotes);
      setUserVote(res.user_vote);
      analytics.reviewVoted(value === 1 ? "up" : "down");
    } catch {
      // Vote failed — leave UI as-is so the user can retry.
    } finally {
      setVoting(false);
    }
  }

  // Build a share payload that captures the three pieces the user asked for:
  // who reviewed (display_name), what they reviewed (entity + artists), and
  // what they said (snippet of the body). The URL deep-links to the entity
  // page where the full review thread lives.
  const userName = item.user?.display_name ?? "Someone";
  const entityName = item.entity_name ?? `this ${item.entity_type}`;
  const artists = item.entity_artists?.slice(0, 2).join(", ");
  const bodyExcerpt = item.body && item.body.length > 200
    ? `${item.body.slice(0, 200)}…`
    : item.body;
  const shareTitle = `${userName}'s review on Contour`;
  const shareText = [
    `${userName} reviewed ${entityName}${artists ? ` by ${artists}` : ""}`,
    bodyExcerpt && `"${bodyExcerpt}"`,
  ].filter(Boolean).join("\n");
  const shareUrl = `${window.location.origin}/${item.entity_type}/${item.entity_id}`;

  function voteBtn(value, label, count) {
    const active = userVote === value;
    return (
      <button
        onClick={() => handleVote(value)}
        disabled={!viewer || voting}
        title={viewer ? (active ? "Remove vote" : value === 1 ? "Upvote" : "Downvote") : "Sign in to vote"}
        style={{
          background: "none",
          border: "none",
          padding: "4px 8px",
          fontSize: 13,
          color: active ? ACCENT_A : "var(--text-muted)",
          fontWeight: active ? 700 : 400,
          cursor: viewer ? "pointer" : "default",
        }}
      >
        {label} {count > 0 ? count : ""}
      </button>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
        {voteBtn(1, "▲", upvotes)}
        {voteBtn(-1, "▼", downvotes)}
        <ShareButton
          surface="review"
          title={shareTitle}
          text={shareText}
          url={shareUrl}
          style={{ padding: "4px 10px", fontSize: 12 }}
        />
      </div>
      <ReplyThread reviewId={item.id} user={viewer} initialCount={item.replies_count ?? 0} />
    </>
  );
}


function FollowingItem({ item }) {
  const { user: viewer } = useAuth();
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
            {item.entity_name ?? `Unknown ${item.entity_type ?? "item"}`}
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
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {timeAgo(item.created_at)}
          {item.edited && <span style={{ marginLeft: 6, fontStyle: "italic", opacity: 0.85 }}>(edited)</span>}
        </span>
        {isReview && item.id != null && (
          <ReviewActionRow item={item} viewer={viewer} />
        )}
      </div>
      {item.entity_image_url && (
        <Link to={entityPath} style={{ flexShrink: 0 }}>
          <img src={item.entity_image_url} alt={item.entity_name} style={{ width: 48, height: 48, borderRadius: item.entity_type === "artist" ? "50%" : 6, objectFit: "cover" }} />
        </Link>
      )}
    </div>
  );
}

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
            padding: "6px 14px", borderRadius: "var(--radius-xl)", fontSize: 12, fontWeight: 700,
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

/**
 * "Friends" tab content — chronological feed of ratings and reviews from
 * users you follow. Falls back to a suggested-people list when you follow
 * nobody, and a sign-in prompt when unauthenticated. Used inside ForYouPage.
 */
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
