import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { BadgeLeaderboard } from "./Badges.jsx";
import { ReplyThread } from "./ReviewSection.jsx";
import { ShareButton } from "./ShareButton.jsx";
import { MentionBody } from "./Mentions.jsx";
import { EmptyState } from "./EmptyState.jsx";
import { PenIcon } from "./Icons.jsx";
import { ACCENT_A, ACCENT_B, GOLD, DANGER } from "../theme.js";

const ENTITY_COLOR = { album: ACCENT_A, track: ACCENT_B, artist: "#fb923c" };
const SORT_LABELS = [
  { key: "recent", label: "Recent" },
  { key: "top", label: "Top" },
  { key: "controversial", label: "Controversial" },
];

function timeAgo(iso) {
  // The backend serializes datetime.utcnow() as a naive ISO string with no
  // timezone suffix, which JS interprets as local time. For non-UTC users
  // this makes UTC server timestamps appear shifted by their TZ offset
  // (e.g. -219m ago for an East Coast user). Treat tz-less strings as UTC.
  const normalized = /[Z+-]\d{2}:?\d{2}$|Z$/.test(iso) ? iso : `${iso}Z`;
  const diff = Math.max(0, Date.now() - new Date(normalized).getTime());
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function RatingBadge({ value }) {
  // Render 5 stars with the appropriate count lit, matching FollowingTab's
  // treatment so the same rating shows the same visual on both Friends and
  // Community tabs. The earlier "4★" + number pill was compact but a tester
  // reported it read as "only one star" — the unicode ★ looked like a unit
  // glyph rather than part of a rating display.
  return (
    <span style={{ display: "inline-flex", gap: 1, flexShrink: 0 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const lit = value >= n - 0.5;
        return (
          <span
            key={n}
            style={{
              fontSize: 12,
              color: lit ? GOLD : "var(--border)",
              opacity: lit ? 1 : 0.35,
            }}
          >
            ★
          </span>
        );
      })}
    </span>
  );
}

// One review card — clickable through to the entity page, anchor scrolls to the review.
function ReviewCardItem({ item, user, onVote, badges }) {
  // Share payload mirrors the Friends-tab review share so the two
  // surfaces produce consistent messages and both fire content_shared.
  // Anchor (#review-{id}) lands the recipient on the exact review when
  // they open the link on the album page.
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
  const shareUrl = `${window.location.origin}/${item.entity_type}/${item.entity_id}#review-${item.id}`;

  return (
    <div style={{ padding: "16px 0", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
      <Link to={`/${item.entity_type}/${item.entity_id}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        {item.entity_image_url
          ? <img src={item.entity_image_url} alt="" loading="lazy" decoding="async" style={{ width: 42, height: 42, borderRadius: item.entity_type === "artist" ? "50%" : 6, objectFit: "cover", flexShrink: 0 }} />
          : <div style={{ width: 42, height: 42, borderRadius: "var(--radius-sm)", background: "var(--surface2)", flexShrink: 0 }} />
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: ENTITY_COLOR[item.entity_type] ?? "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.entity_name ?? `Unknown ${item.entity_type ?? "item"}`}
          </div>
          {item.entity_artists?.length > 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.entity_artists.slice(0, 2).join(", ")}</div>
          )}
        </div>
        <span style={{
          fontFamily: "var(--font-display)", fontStyle: "italic",
          fontSize: 12, color: ENTITY_COLOR[item.entity_type],
          flexShrink: 0,
        }}>
          {item.entity_type === "album" ? "album"
            : item.entity_type === "track" ? "track"
            : item.entity_type === "artist" ? "artist"
            : item.entity_type}
        </span>
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link to={`/user/${item.user?.id}`} style={{ flexShrink: 0 }}>
          {item.user?.image_url
            ? <img src={item.user.image_url} alt="" loading="lazy" decoding="async" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }} />
            : <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--surface2)" }} />
          }
        </Link>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Link to={`/user/${item.user?.id}`} style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", textDecoration: "none" }}>
              {item.user?.display_name}
            </Link>
            {/* BadgeMark (the "Community Top 5" gold star next to a user's
                name) was removed from this surface — it sat next to the
                review's rating stars and read as "this person rated it 1
                star" even though it's a recognition marker, not a rating.
                Still rendered on profile heroes where it can't be confused
                with a rating display. */}
            {item.rating && <RatingBadge value={item.rating} />}
          </div>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
          {timeAgo(item.created_at)}
          {item.edited && <span style={{ marginLeft: 6, fontStyle: "italic", opacity: 0.85 }}>(edited)</span>}
        </span>
      </div>

      <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.65, margin: 0, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" }}>
        <MentionBody body={item.body} mentions={item.mentions} />
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
        <ShareButton
          surface="review"
          title={shareTitle}
          text={shareText}
          url={shareUrl}
          style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }}
        />
      </div>

      {/* Inline reply thread — same component the album-page review section
          and the Friends tab use, so the reply UX is identical across all
          surfaces (collapsible thread, inline form, report flow). Replaces
          the older affordance that linked out to the entity page. */}
      <ReplyThread reviewId={item.id} user={user} initialCount={item.replies_count ?? 0} />
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
      {/* Community Top 5 — promoted from a toggleable section to a permanent
          surface at the top of the Community tab. The reasoning: this is the
          only place in the app where users can see WHO the prolific reviewers
          / most-upvoted critics / most-followed connectors are, and hiding it
          behind a button defeated the engagement loop. BadgeLeaderboard
          self-handles the null state (returns nothing while badges load) so
          we don't need a loading skeleton here. */}
      <BadgeLeaderboard badges={badges} />

      {/* Sort row for the global review feed below. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 0 6px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
        <div style={{ display: "flex", gap: 0 }}>
          {SORT_LABELS.map(({ key, label }) => (
            <button key={key} onClick={() => setSort(key)}
              style={{
                padding: "4px 14px", fontSize: 12, fontWeight: sort === key ? 700 : 400,
                background: sort === key ? "var(--surface2)" : "none",
                border: sort === key ? "1px solid var(--border)" : "1px solid transparent",
                borderRadius: "var(--radius-xl)", color: sort === key ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer", marginRight: 4,
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* (BadgeLeaderboard was previously rendered here behind a toggle —
          now lives permanently above the sort row.) */}

      {loading && (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40 }}>Loading…</div>
      )}
      {!loading && reviews.length === 0 && (
        <EmptyState
          icon={<PenIcon size={28} />}
          description="No reviews yet. Be the first to write one."
        />
      )}
      {!loading && reviews.map((item) => (
        <ReviewCardItem key={item.id} item={item} user={user} onVote={handleVote} badges={badges} />
      ))}
    </div>
  );
}
