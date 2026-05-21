import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { ReportModal } from "./ReportModal.jsx";
import { CardPreviewModal } from "./CardPreviewModal.jsx";
import { MentionInput, MentionBody } from "./Mentions.jsx";

const GOLD = "#f59e0b";
const ACCENT = "#d97a3b";
const DANGER = "#f87171";

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(iso) {
  // Backend serializes naive UTC; normalize tz-less strings to UTC.
  const normalized = /[Z+-]\d{2}:?\d{2}$|Z$/.test(iso) ? iso : `${iso}Z`;
  const diff = Math.max(0, Date.now() - new Date(normalized).getTime());
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
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

// ── Threaded reply system ─────────────────────────────────────────────────────
// Reddit-style nested replies: each reply can target another reply via
// parent_reply_id. The backend returns a flat list; we build the tree here
// and render recursively. Visual indent caps at depth 4 so deeply nested
// threads stay readable on narrow viewports.
//
// Used by:
//   - ReviewCard below (album/track/artist page review section)
//   - FollowingTab (Friends tab — followed users' reviews)
//   - GlobalReviewsFeed (Community tab — every public review)
// One source of truth for the reply UX across the platform.

// Max visual indent depth. Deeper replies still nest in the tree but stop
// pushing further right so threads don't disappear off the side of a phone.
const MAX_REPLY_INDENT_DEPTH = 4;

function buildReplyTree(flat) {
  const byId = new Map();
  for (const r of flat) byId.set(r.id, { ...r, children: [] });
  const roots = [];
  for (const r of flat) {
    const node = byId.get(r.id);
    if (r.parent_reply_id != null && byId.has(r.parent_reply_id)) {
      byId.get(r.parent_reply_id).children.push(node);
    } else {
      // Orphans (parent missing — shouldn't happen, but be defensive) fall
      // through to roots so they don't silently disappear from the UI.
      roots.push(node);
    }
  }
  return roots;
}

function countDescendants(node) {
  let n = 0;
  for (const c of node.children) n += 1 + countDescendants(c);
  return n;
}

function ReplyForm({ onSubmit, onCancel, autoFocus = false, placeholder = "Write a reply…" }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      await onSubmit(text.trim());
      setText("");
    } catch { /* parent handles refresh; keep text so user can retry */ }
    setSaving(false);
  }
  return (
    // flexWrap lets Cancel drop below the input/Post row on narrow phones
    // instead of squeezing the input to nothing. On desktop everything still
    // fits on one row.
    <form onSubmit={submit} style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
      <MentionInput
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        style={{
          // minWidth 0 keeps the field from forcing horizontal overflow.
          // The MentionInput wrapper handles flex sizing via its own flex
          // prop (passed through from `flex` on rest props), so we don't
          // double-up here.
          width: "100%", boxSizing: "border-box", minWidth: 0,
          padding: "10px 12px", background: "var(--surface2)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
          color: "var(--text)", fontSize: 13, outline: "none",
        }}
      />
      <button
        type="submit"
        disabled={saving || !text.trim()}
        style={{
          padding: "8px 14px", background: ACCENT, border: "none",
          borderRadius: "var(--radius-sm)", color: "#000", fontWeight: 700, fontSize: 12,
          opacity: saving || !text.trim() ? 0.5 : 1, cursor: "pointer",
        }}
      >
        {saving ? "…" : "Post"}
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "8px 10px", background: "none",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
          }}
        >
          Cancel
        </button>
      )}
    </form>
  );
}

function ReplyNode({ node, depth, user, replyingTo, onSetReplyingTo, onSubmitReply, collapsedIds, onToggleCollapse, onReport }) {
  const indent = Math.min(depth, MAX_REPLY_INDENT_DEPTH) * 16;
  const isCollapsed = collapsedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const descendants = hasChildren ? countDescendants(node) : 0;

  return (
    <div style={{ marginTop: 10, paddingLeft: indent, borderLeft: depth > 0 ? "2px solid var(--border)" : "none" }}>
      <div style={{ display: "flex", gap: 10 }}>
        <Link to={`/user/${node.user.id}`} style={{ flexShrink: 0 }}>
          {node.user.image_url
            ? <img src={node.user.image_url} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />
            : <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--surface2)" }} />
          }
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
            {hasChildren && (
              <button
                onClick={() => onToggleCollapse(node.id)}
                title={isCollapsed ? `Show ${descendants} ${descendants === 1 ? "reply" : "replies"}` : "Collapse thread"}
                // Padded hit target so a fingertip can land on it on mobile.
                // Inline-flex keeps the visible glyph in a clean box without
                // disturbing the surrounding row's alignment.
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, padding: "4px 6px", minWidth: 30, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                {isCollapsed ? "[+]" : "[−]"}
              </button>
            )}
            <Link to={`/user/${node.user.id}`} style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textDecoration: "none" }}>
              {node.user.display_name}
            </Link>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{timeAgo(node.created_at)}</span>
            {user && user.id !== node.user.id && (
              <button
                onClick={() => onReport(node.id)}
                title="Report this reply"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 11, padding: 0, marginLeft: "auto" }}
              >
                ⚐
              </button>
            )}
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            <MentionBody body={node.body} mentions={node.mentions} />
          </p>
          <div style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }}>
            {/* Per-node Reply button: visible to everyone for consistency
                with the top-level Reply and the platform's vote buttons.
                Signed-out users get a tooltip; clicking is a no-op. */}
            <button
              onClick={() => {
                if (!user) return;
                onSetReplyingTo(replyingTo === node.id ? null : node.id);
              }}
              title={user ? `Reply to ${node.user.display_name}` : "Sign in to reply"}
              style={{
                background: "none", border: "none", fontSize: 12,
                color: replyingTo === node.id ? ACCENT : "var(--text-muted)",
                cursor: user ? "pointer" : "default",
                padding: "6px 10px",
                fontWeight: replyingTo === node.id ? 700 : 400,
              }}
            >
              Reply
            </button>
            {isCollapsed && hasChildren && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {descendants} hidden
              </span>
            )}
          </div>
          {replyingTo === node.id && user && (
            <ReplyForm
              autoFocus
              placeholder={`Reply to ${node.user.display_name}…`}
              onSubmit={(text) => onSubmitReply(node.id, text)}
              onCancel={() => onSetReplyingTo(null)}
            />
          )}
        </div>
      </div>
      {!isCollapsed && hasChildren && node.children.map((child) => (
        <ReplyNode
          key={child.id}
          node={child}
          depth={depth + 1}
          user={user}
          replyingTo={replyingTo}
          onSetReplyingTo={onSetReplyingTo}
          onSubmitReply={onSubmitReply}
          collapsedIds={collapsedIds}
          onToggleCollapse={onToggleCollapse}
          onReport={onReport}
        />
      ))}
    </div>
  );
}

// Exported so the Friends tab (FollowingTab.jsx) and Community tab
// (GlobalReviewsFeed.jsx) render replies with the same UX as the
// album-page review section.
export function ReplyThread({ reviewId, user, initialCount }) {
  const [flatReplies, setFlatReplies] = useState(null); // null = not loaded
  const [expanded, setExpanded] = useState(false);
  // replyingTo: null = no form open, "root" = top-level reply form (replies
  // to the review itself), <id> = form is open under that specific reply.
  const [replyingTo, setReplyingTo] = useState(null);
  const [count, setCount] = useState(initialCount);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [reportingReplyId, setReportingReplyId] = useState(null);

  async function load() {
    const data = await api.getReplies(reviewId);
    setFlatReplies(data);
    setCount(data.length);
    setExpanded(true);
  }

  async function toggle() {
    if (!expanded) {
      if (!flatReplies) await load();
      else setExpanded(true);
    } else {
      setExpanded(false);
    }
  }

  async function submitReply(parentReplyId, text) {
    await api.postReply(reviewId, text, parentReplyId);
    const fresh = await api.getReplies(reviewId);
    setFlatReplies(fresh);
    setCount(fresh.length);
    setExpanded(true);
    setReplyingTo(null);
  }

  function toggleCollapse(replyId) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(replyId)) next.delete(replyId);
      else next.add(replyId);
      return next;
    });
  }

  const tree = flatReplies ? buildReplyTree(flatReplies) : [];

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {/* Visible to everyone — signed-out users see the affordance with
            a "Sign in to reply" tooltip and the click is a no-op. Mirrors
            the existing vote-button pattern and keeps the action discoverable
            on the iOS Capacitor shell, where the Reply button was previously
            invisible to non-authenticated browsers of the Community feed. */}
        <button
          onClick={() => {
            if (!user) return;
            setReplyingTo(replyingTo === "root" ? null : "root");
          }}
          title={user ? "Reply to this review" : "Sign in to reply"}
          style={{
            background: "none", border: "none", fontSize: 12,
            color: replyingTo === "root" ? ACCENT : "var(--text-muted)",
            cursor: user ? "pointer" : "default",
            // ~30px tall hit target — well above the previous ~14px and
            // close enough to iOS's 44pt guideline when the line-height
            // of surrounding rows is included.
            padding: "6px 10px",
            fontWeight: replyingTo === "root" ? 700 : 400,
          }}
        >
          Reply
        </button>
        {count > 0 && (
          <button
            onClick={toggle}
            style={{ background: "none", border: "none", fontSize: 12, color: ACCENT, cursor: "pointer", padding: "6px 10px" }}
          >
            {expanded ? "▴ Hide" : `▾ ${count} ${count === 1 ? "reply" : "replies"}`}
          </button>
        )}
      </div>

      {replyingTo === "root" && user && (
        <ReplyForm
          autoFocus
          onSubmit={(text) => submitReply(null, text)}
          onCancel={() => setReplyingTo(null)}
        />
      )}

      {expanded && tree.map((node) => (
        <ReplyNode
          key={node.id}
          node={node}
          depth={0}
          user={user}
          replyingTo={replyingTo}
          onSetReplyingTo={setReplyingTo}
          onSubmitReply={submitReply}
          collapsedIds={collapsedIds}
          onToggleCollapse={toggleCollapse}
          onReport={setReportingReplyId}
        />
      ))}

      <ReportModal
        open={reportingReplyId !== null}
        onClose={() => setReportingReplyId(null)}
        targetType="reply"
        targetId={reportingReplyId}
      />
    </div>
  );
}

// ── Single review card ────────────────────────────────────────────────────────
function ReviewCard({ rev, onVote, onDelete, user, entityType, entityId }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const isOwn = user && user.id === rev.user.id;

  const reviewUrl = `${window.location.origin}/${entityType}/${entityId}#review-${rev.id}`;
  const cardUrl   = `${window.location.origin}/api/og/review?id=${rev.id}`;
  const shareText = `${rev.user.display_name}'s review on Contour`;
  const fileName  = `contour-review-${rev.id}.png`;

  // Share button opens the card preview modal instead of dispatching directly
  // to the system share sheet. The modal renders the PNG inline so the user
  // can verify it before sending, and offers explicit Save / Share CTAs that
  // route through @capacitor/share (native) or Web Share Level 2 (web).
  // Previous direct-share path (navigator.share + canShare gate) silently
  // false-negatived on iOS Capacitor WKWebView, dropping every file-attached
  // share back to URL-only — see utils/share.js for the dispatch details.
  function handleShare() { setCardOpen(true); }

  function handleDelete() {
    if (!window.confirm("Delete this review? Your star rating will be kept.")) return;
    onDelete?.(rev.id);
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
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {timeAgo(rev.created_at)}
                {rev.edited && <span style={{ marginLeft: 6, fontStyle: "italic", opacity: 0.85 }}>(edited)</span>}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {/* Share this review */}
          <button
            onClick={handleShare}
            title="Share this review"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, padding: "4px 6px", flexShrink: 0 }}
          >
            ↗
          </button>
          {/* Own-review delete vs. other-user report — these occupy the same
              slot since they're never both applicable on the same row. */}
          {isOwn ? (
            <button
              onClick={handleDelete}
              title="Delete this review"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, padding: "4px 6px", flexShrink: 0 }}
            >
              Delete
            </button>
          ) : user && (
            <button
              onClick={() => setReportOpen(true)}
              title="Report this review"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, padding: "4px 6px", flexShrink: 0 }}
            >
              ⚐
            </button>
          )}
        </div>
      </div>
      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="review"
        targetId={rev.id}
      />
      <CardPreviewModal
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        cardUrl={cardUrl}
        shareUrl={reviewUrl}
        shareText={shareText}
        fileName={fileName}
      />

      {/* Body */}
      <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-muted)", margin: 0, whiteSpace: "pre-wrap" }}>
        <MentionBody body={rev.body} mentions={rev.mentions} />
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
    // Always sync — clears local state when the user just deleted their
    // review so the textarea doesn't keep a stale draft.
    setReviewText(sum.user_review ?? "");
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
    analytics.ratingSubmitted(entityType, entityId, val);
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
      analytics.reviewSubmitted(entityType, reviewText.trim().length);
      setShowForm(false);
      await load(sort);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(reviewId) {
    try {
      await api.deleteReview(reviewId);
      setShowForm(false);
      await load(sort);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleVote(reviewId, value) {
    if (!user) return;
    // Optimistic: derive what the new totals look like from the current row
    // and apply immediately. The user sees their vote register on the same
    // frame as their tap; the server reconciles on the response. If the
    // server disagrees (eg. the row was edited since we loaded it), we still
    // overwrite with the authoritative numbers when the request returns.
    setReviews((prev) => prev.map((r) => {
      if (r.id !== reviewId) return r;
      const prevVote = r.user_vote ?? 0;
      const nextVote = prevVote === value ? 0 : value;          // tapping the active arrow clears it
      let up = r.upvotes ?? 0;
      let down = r.downvotes ?? 0;
      if (prevVote === 1) up -= 1;
      if (prevVote === -1) down -= 1;
      if (nextVote === 1) up += 1;
      if (nextVote === -1) down += 1;
      return { ...r, upvotes: Math.max(0, up), downvotes: Math.max(0, down), user_vote: nextVote };
    }));
    analytics.reviewVoted(value === 1 ? "up" : "down");
    try {
      const res = await api.voteReview(reviewId, value);
      setReviews((prev) => prev.map((r) =>
        r.id === reviewId
          ? { ...r, upvotes: res.upvotes, downvotes: res.downvotes, user_vote: res.user_vote }
          : r
      ));
    } catch {
      // Server failed — refetch the row's authoritative state by reloading
      // the whole reviews list. Cheap; vote failures should be rare.
      api.getReviews(entityType, entityId, sort).then(setReviews).catch(() => {});
    }
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
        <form onSubmit={handleSubmitReview} style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {summary?.user_review ? "Edit your review" : "Write a review"}
            {selectedRating && <span style={{ color: GOLD, marginLeft: 8 }}>· {selectedRating} / 5</span>}
          </div>
          <MentionInput
            as="textarea"
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="What did you think? Share your thoughts… Use @ to mention another user."
            rows={4}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              color: "var(--text)", fontSize: 16, padding: "10px 12px", resize: "vertical",
              fontFamily: "inherit", lineHeight: 1.6, outline: "none",
            }}
          />
          {error && <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={saving || !reviewText.trim()}
              style={{ padding: "7px 18px", background: ACCENT, border: "none", borderRadius: "var(--radius-sm)", color: "#000", fontWeight: 700, fontSize: 13, cursor: saving ? "default" : "pointer", opacity: saving || !reviewText.trim() ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save Review"}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              style={{ padding: "7px 14px", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", fontSize: 13, cursor: "pointer" }}>
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
              onDelete={handleDelete}
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
