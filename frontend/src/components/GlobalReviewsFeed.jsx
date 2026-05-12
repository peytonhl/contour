import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { BadgeChips } from "../pages/FeedPage.jsx";

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

// One review card — clickable through to the entity page, anchor scrolls to the review.
function ReviewCardItem({ item, user, onVote, badges }) {
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

      <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.65, margin: 0, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {item.body}
      </p>

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

/**
 * Global reviews feed — every public review on the platform, sorted Recent /
 * Top / Controversial. Renders inside whatever container it's dropped in
 * (currently the For You page's "Reviews" tab). Was formerly the "All Reviews"
 * tab on /feed.
 */
export function GlobalReviewsFeed() {
  const { user } = useAuth();
  const [sort, setSort] = useState("recent");
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState(null);

  useEffect(() => {
    api.getBadges().then(setBadges).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api.getGlobalReviews(sort)
      .then(setReviews)
      .catch(() => setReviews([]))
      .finally(() => setLoading(false));
  }, [sort]);

  function handleVote(reviewId, value) {
    if (!user) return;
    api.voteReview(reviewId, value).then((res) => {
      setReviews((prev) => prev.map((r) =>
        r.id === reviewId ? { ...r, upvotes: res.upvotes, downvotes: res.downvotes, user_vote: res.user_vote } : r
      ));
    });
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 20px" }}>
      <div style={{ display: "flex", gap: 0, padding: "0 0 6px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
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

      {loading && (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40 }}>Loading…</div>
      )}
      {!loading && reviews.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 60, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.35 }}>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          <p style={{ margin: 0, fontSize: 14 }}>No reviews yet — be the first to write one.</p>
        </div>
      )}
      {!loading && reviews.map((item) => (
        <ReviewCardItem key={item.id} item={item} user={user} onVote={handleVote} badges={badges} />
      ))}
    </div>
  );
}
