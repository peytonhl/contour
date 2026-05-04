import { useState, useEffect } from "react";
import { api } from "../services/api.js";

const GOLD = "#f59e0b";
const ACCENT = "#a78bfa";

function Stars({ value = 0, size = 18, interactive = false, onHover, onClick }) {
  // All pointer handling lives on the container so touch-drag across stars works.
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
      style={{
        display: "flex", gap: 2,
        cursor: interactive ? "pointer" : "default",
        // prevent page-scroll interfering with drag-to-rate on touch
        touchAction: interactive ? "none" : "auto",
        userSelect: "none",
      }}
      onPointerMove={interactive ? (e) => onHover?.(calcVal(e)) : undefined}
      onPointerUp={interactive ? (e) => onClick?.(calcVal(e)) : undefined}
      onPointerLeave={interactive ? () => onHover?.(null) : undefined}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = value >= n ? "full" : value >= n - 0.5 ? "half" : "empty";
        return (
          <svg
            key={n}
            width={size} height={size} viewBox="0 0 20 20"
            style={{ pointerEvents: "none", flexShrink: 0 }}
          >
            <polygon
              points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7"
              fill={fill === "full" ? GOLD : fill === "half" ? `url(#h${n})` : "var(--surface2)"}
              stroke={fill === "empty" ? "var(--border)" : GOLD}
              strokeWidth="0.5"
            />
            {fill === "half" && (
              <defs>
                <linearGradient id={`h${n}`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="50%" stopColor={GOLD} />
                  <stop offset="50%" stopColor="var(--surface2)" />
                </linearGradient>
              </defs>
            )}
          </svg>
        );
      })}
    </div>
  );
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function ReviewSection({ entityType, entityId, user }) {
  const [summary, setSummary] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [hover, setHover] = useState(null);
  const [selectedRating, setSelectedRating] = useState(null);
  const [reviewText, setReviewText] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    const [s, r] = await Promise.all([
      api.getRatingSummary(entityType, entityId),
      api.getReviews(entityType, entityId),
    ]);
    setSummary(s);
    setReviews(r);
    if (s.user_rating) setSelectedRating(s.user_rating);
    if (s.user_review) setReviewText(s.user_review);
  }

  useEffect(() => { load(); }, [entityType, entityId]);

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
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLike(reviewId) {
    if (!user) return;
    await api.toggleLike(reviewId);
    setReviews((prev) => prev.map((r) =>
      r.id === reviewId
        ? { ...r, liked_by_me: !r.liked_by_me, likes: r.liked_by_me ? r.likes - 1 : r.likes + 1 }
        : r
    ));
  }

  const displayRating = hover ?? selectedRating ?? summary?.average ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Community score + your rating */}
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>

        {/* Community average */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Community Rating
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Stars value={summary?.average ?? 0} size={20} />
            {summary?.average ? (
              <span style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>
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

        {/* Your rating */}
        {user && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              {selectedRating ? "Your Rating" : "Rate This"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Stars
                value={displayRating}
                size={24}
                interactive
                onHover={setHover}
                onClick={handleStarClick}
              />
              {hover && (
                <span style={{ fontSize: 13, color: GOLD }}>{hover} / 5</span>
              )}
              {selectedRating && !hover && (
                <button
                  onClick={() => setShowForm((f) => !f)}
                  style={{ fontSize: 12, color: ACCENT, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  {summary?.user_review ? "Edit review" : "Write a review"}
                </button>
              )}
            </div>
          </div>
        )}

        {!user && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>Rate This</span>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Sign in to rate and review</span>
          </div>
        )}
      </div>

      {/* Review form */}
      {showForm && user && (
        <form onSubmit={handleSubmitReview} style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {summary?.user_review ? "Edit your review" : "Write a review"}
            {selectedRating && <span style={{ color: GOLD, marginLeft: 8 }}>· {selectedRating} / 5</span>}
          </div>
          <textarea
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="What did you think? Share your thoughts..."
            rows={4}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7,
              color: "var(--text)", fontSize: 16, padding: "10px 12px", resize: "vertical",
              fontFamily: "inherit", lineHeight: 1.6, outline: "none",
            }}
          />
          {error && <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={saving || !reviewText.trim()}
              style={{
                padding: "7px 18px", background: ACCENT, border: "none", borderRadius: 7,
                color: "#000", fontWeight: 700, fontSize: 13, cursor: saving ? "default" : "pointer",
                opacity: saving || !reviewText.trim() ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : "Save Review"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={{ padding: "7px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", fontSize: 13, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Reviews list */}
      {reviews.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            {reviews.length} {reviews.length === 1 ? "Review" : "Reviews"}
          </div>
          {reviews.map((rev) => (
            <div key={rev.id} style={{
              padding: "16px 0",
              borderTop: "1px solid var(--border)",
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              {/* Reviewer header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {rev.user.image_url
                  ? <img src={rev.user.image_url} alt={rev.user.display_name} style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
                  : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
                }
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{rev.user.display_name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {rev.rating && <Stars value={rev.rating} size={13} />}
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{timeAgo(rev.created_at)}</span>
                  </div>
                </div>
              </div>

              {/* Review body */}
              <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-muted)", margin: 0 }}>
                {rev.body}
              </p>

              {/* Like button */}
              <button
                onClick={() => handleLike(rev.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "none", border: "none", cursor: user ? "pointer" : "default",
                  color: rev.liked_by_me ? ACCENT : "var(--text-muted)",
                  fontSize: 12, padding: 0, alignSelf: "flex-start",
                }}
              >
                ♥ {rev.likes > 0 ? rev.likes : ""} {rev.liked_by_me ? "Liked" : "Like"}
              </button>
            </div>
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
