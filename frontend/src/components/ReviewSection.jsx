import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";

const GOLD = "#f59e0b";
const ACCENT = "#a78bfa";
const DANGER = "#f87171";

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

async function copyReviewLink(entityType, entityId, reviewId) {
  const url = `${window.location.origin}/${entityType}/${entityId}#review-${reviewId}`;
  if (navigator.share) {
    try { await navigator.share({ url }); } catch { /* cancelled */ }
  } else {
    try { await navigator.clipboard.writeText(url); } catch { /* blocked */ }
  }
}

// ── Stars (read-only + interactive) ──────────────────────────────────────────
function Stars({ value = 0, size = 18, interactive = false, onHover, onClick }) {
  function calcVal(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const starW = rect.width / 5;
    const i = Math.floor(x / starW);
    const within = x - i * starW;
    return Math.max(0.5, Math.min(5, i + (within < starW / 2 ? 0.5 : 1)));
  }
  return (
    <div
      style={{ display: "flex", gap: 2, cursor: interactive ? "pointer" : "default", touchAction: interactive ? "none" : "auto", userSelect: "none" }}
      onPointerMove={interactive ? (e) => onHover?.(calcVal(e)) : undefined}
      onPointerUp={interactive ? (e) => onClick?.(calcVal(e)) : undefined}
      onPointerLeave={interactive ? () => onHover?.(null) : undefined}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = value >= n ? "full" : value >= n - 0.5 ? "half" : "empty";
        return (
          <svg key={n} width={size} height={size} viewBox="0 0 20 20" style={{ pointerEvents: "none", flexShrink: 0 }}>
            <polygon
              points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7"
              fill={fill === "full" ? GOLD : fill === "half" ? `url(#h${n})` : "var(--surface2)"}
              stroke={fill === "empty" ? "var(--border)" : GOLD} strokeWidth="0.5"
            />
            {fill === "half" && (
              <defs><linearGradient id={`h${n}`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="50%" stopColor={GOLD} />
                <stop offset="50%" stopColor="var(--surface2)" />
              </linearGradient></defs>
            )}
          </svg>
        );
      })}
    </div>
  );
}

// ── Sort tabs ─────────────────────────────────────────────────────────────────
const SORTS = [
  { key: "recent", label: "Recent" },
  { key: "top", label: "Top" },
  { key: "controversial", label: "Controversial" },
];

// ── Inline reply thread ───────────────────────────────────────────────────────
function ReplyThread({ reviewId, user, initialCount }) {
  const [replies, setReplies] = useState(null); // null = not loaded
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [count, setCount] = useState(initialCount);

  async function load() {
    const data = await api.getReplies(reviewId);
    setReplies(data);
    setExpanded(true);
  }

  async function toggle() {
    if (!expanded) {
      if (!replies) await load();
      else setExpanded(true);
    } else {
      setExpanded(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      await api.postReply(reviewId, text.trim());
      setText("");
      setShowForm(false);
      const fresh = await api.getReplies(reviewId);
      setReplies(fresh);
      setExpanded(true);
      setCount(fresh.length);
    } catch { /* silently fail */ }
    setSaving(false);
  }

  return (
    <div style={{ marginTop: 6 }}>
      {/* Reply / expand controls */}
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        {user && (
          <button
            onClick={() => setShowForm((f) => !f)}
            style={{ background: "none", border: "none", fontSize: 12, color: "var(--text-muted)", cursor: "pointer", padding: 0 }}
          >
            Reply
          </button>
        )}
        {count > 0 && (
          <button
            onClick={toggle}
            style={{ background: "none", border: "none", fontSize: 12, color: ACCENT, cursor: "pointer", padding: 0 }}
          >
            {expanded ? "▴ Hide" : `▾ ${count} ${count === 1 ? "reply" : "replies"}`}
          </button>
        )}
      </div>

      {/* Reply form */}
      {showForm && user && (
        <form onSubmit={submit} style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply…"
            style={{
              flex: 1, padding: "8px 12px", background: "var(--surface2)",
              border: "1px solid var(--border)", borderRadius: 7,
              color: "var(--text)", fontSize: 13, outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={saving || !text.trim()}
            style={{
              padding: "8px 14px", background: ACCENT, border: "none",
              borderRadius: 7, color: "#000", fontWeight: 700, fontSize: 12,
              opacity: saving || !text.trim() ? 0.5 : 1, cursor: "pointer",
            }}
          >
            {saving ? "…" : "Post"}
          </button>
        </form>
      )}

      {/* Replies */}
      {expanded && replies?.map((r) => (
        <div key={r.id} style={{ marginTop: 10, paddingLeft: 16, borderLeft: "2px solid var(--border)", display: "flex", gap: 10 }}>
          <Link to={`/user/${r.user.id}`} style={{ flexShrink: 0 }}>
            {r.user.image_url
              ? <img src={r.user.image_url} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />
              : <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--surface2)" }} />
            }
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
              <Link to={`/user/${r.user.id}`} style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textDecoration: "none" }}>
                {r.user.display_name}
              </Link>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{timeAgo(r.created_at)}</span>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}>{r.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Single review card ────────────────────────────────────────────────────────
function ReviewCard({ rev, onVote, user, entityType, entityId }) {
  const [copiedShare, setCopiedShare] = useState(false);

  async function handleShare() {
    const url = `${window.location.origin}/${entityType}/${entityId}#review-${rev.id}`;
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
    <div
      id={`review-${rev.id}`}
      style={{ padding: "16px 0", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link to={`/user/${rev.user.id}`} style={{ flexShrink: 0 }}>
            {rev.user.image_url
              ? <img src={rev.user.image_url} alt={rev.user.display_name} style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
              : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
            }
          </Link>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Link to={`/user/${rev.user.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", textDecoration: "none" }}>
              {rev.user.display_name}
            </Link>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {rev.rating && <Stars value={rev.rating} size={13} />}
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{timeAgo(rev.created_at)}</span>
            </div>
          </div>
        </div>

        {/* Share this review */}
        <button
          onClick={handleShare}
          title="Share this review"
          style={{ background: "none", border: "none", cursor: "pointer", color: copiedShare ? "var(--accent-b)" : "var(--text-muted)", fontSize: 12, padding: "4px 6px", flexShrink: 0 }}
        >
          {copiedShare ? "✓" : "↗"}
        </button>
      </div>

      {/* Body */}
      <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-muted)", margin: 0 }}>
        {rev.body}
      </p>

      {/* Vote row */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* Upvote */}
        <button
          onClick={() => onVote(rev.id, 1)}
          disabled={!user}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            background: "none", border: "none", padding: 0,
            color: rev.user_vote === 1 ? ACCENT : "var(--text-muted)",
            fontSize: 13, cursor: user ? "pointer" : "default",
            fontWeight: rev.user_vote === 1 ? 700 : 400,
          }}
        >
          ▲ {rev.upvotes > 0 ? rev.upvotes : ""}
        </button>

        {/* Downvote */}
        <button
          onClick={() => onVote(rev.id, -1)}
          disabled={!user}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            background: "none", border: "none", padding: 0,
            color: rev.user_vote === -1 ? DANGER : "var(--text-muted)",
            fontSize: 13, cursor: user ? "pointer" : "default",
            fontWeight: rev.user_vote === -1 ? 700 : 400,
          }}
        >
          ▼ {rev.downvotes > 0 ? rev.downvotes : ""}
        </button>
      </div>

      {/* Reply thread */}
      <ReplyThread reviewId={rev.id} user={user} initialCount={rev.replies_count} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function ReviewSection({ entityType, entityId, user }) {
  const [summary, setSummary] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [sort, setSort] = useState("recent");
  const [hover, setHover] = useState(null);
  const [selectedRating, setSelectedRating] = useState(null);
  const [reviewText, setReviewText] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function load(s = sort) {
    const [sum, revs] = await Promise.all([
      api.getRatingSummary(entityType, entityId),
      api.getReviews(entityType, entityId, s),
    ]);
    setSummary(sum);
    setReviews(revs);
    if (sum.user_rating) setSelectedRating(sum.user_rating);
    if (sum.user_review) setReviewText(sum.user_review);
  }

  useEffect(() => { load(); }, [entityType, entityId]);

  // Reload reviews when sort changes (keep summary cached)
  useEffect(() => {
    api.getReviews(entityType, entityId, sort)
      .then(setReviews)
      .catch(() => {});
  }, [sort]);

  async function handleStarClick(val) {
    if (!user) return;
    setSelectedRating(val);
    setShowForm(true);
    await api.rateEntity(entityType, entityId, val);
    const updated = await api.getRatingSummary(entityType, entityId);
    setSummary(updated);
  }

  async function handleSubmitReview(e) {
    e.preventDefault();
    if (!reviewText.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.submitReview(entityType, entityId, reviewText, selectedRating);
      setShowForm(false);
      await load(sort);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleVote(reviewId, value) {
    if (!user) return;
    const res = await api.voteReview(reviewId, value);
    setReviews((prev) => prev.map((r) =>
      r.id === reviewId
        ? { ...r, upvotes: res.upvotes, downvotes: res.downvotes, user_vote: res.user_vote }
        : r
    ));
  }

  const displayRating = hover ?? selectedRating ?? summary?.average ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Community score + your rating */}
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>Community Rating</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Stars value={summary?.average ?? 0} size={20} />
            {summary?.average ? (
              <span style={{ fontSize: 22, fontWeight: 800 }}>
                {summary.average.toFixed(1)}
                <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-muted)", marginLeft: 4 }}>
                  / 5 · {summary.count} {summary.count === 1 ? "rating" : "ratings"}
                </span>
              </span>
            ) : (
              <span style={{ fontSize: 14, color: "var(--text-muted)" }}>No ratings yet</span>
            )}
          </div>
        </div>

        {user ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              {selectedRating ? "Your Rating" : "Rate This"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Stars value={displayRating} size={24} interactive onHover={setHover} onClick={handleStarClick} />
              {hover && <span style={{ fontSize: 13, color: GOLD }}>{hover} / 5</span>}
              {selectedRating && !hover && (
                <button onClick={() => setShowForm((f) => !f)}
                  style={{ fontSize: 12, color: ACCENT, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  {summary?.user_review ? "Edit review" : "Write a review"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>Rate This</span>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Sign in to rate and review</span>
          </div>
        )}
      </div>

      {/* Review form */}
      {showForm && user && (
        <form onSubmit={handleSubmitReview} style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {summary?.user_review ? "Edit your review" : "Write a review"}
            {selectedRating && <span style={{ color: GOLD, marginLeft: 8 }}>· {selectedRating} / 5</span>}
          </div>
          <textarea
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="What did you think? Share your thoughts…"
            rows={4}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7,
              color: "var(--text)", fontSize: 16, padding: "10px 12px", resize: "vertical",
              fontFamily: "inherit", lineHeight: 1.6, outline: "none",
            }}
          />
          {error && <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={saving || !reviewText.trim()}
              style={{ padding: "7px 18px", background: ACCENT, border: "none", borderRadius: 7, color: "#000", fontWeight: 700, fontSize: 13, cursor: saving ? "default" : "pointer", opacity: saving || !reviewText.trim() ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save Review"}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              style={{ padding: "7px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Reviews list */}
      {reviews.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Header + sort */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {reviews.length} {reviews.length === 1 ? "Review" : "Reviews"}
            </span>
            <div style={{ display: "flex", gap: 0 }}>
              {SORTS.map(({ key, label }) => (
                <button key={key} onClick={() => setSort(key)}
                  style={{
                    padding: "5px 12px", fontSize: 12, fontWeight: sort === key ? 700 : 400,
                    background: "none", border: "none",
                    borderBottom: sort === key ? `2px solid ${ACCENT}` : "2px solid transparent",
                    color: sort === key ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {reviews.map((rev) => (
            <ReviewCard
              key={rev.id}
              rev={rev}
              onVote={handleVote}
              user={user}
              entityType={entityType}
              entityId={entityId}
            />
          ))}
        </div>
      )}

      {reviews.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          No reviews yet. {user ? "Be the first to write one." : "Sign in to write the first review."}
        </div>
      )}
    </div>
  );
}
