import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { BadgeLeaderboard } from "./Badges.jsx";
import { ReplyThread } from "./ReviewSection.jsx";
import { CardPreviewModal } from "./CardPreviewModal.jsx";
import { MentionBody } from "./Mentions.jsx";
import { EmptyState } from "./EmptyState.jsx";
import { PenIcon } from "./Icons.jsx";
import { userPath } from "../constants/routes.js";
import { ACCENT_A, ACCENT_B, ACCENT_C, GOLD, DANGER } from "../theme.js";
import { imageThumb, imageMedium } from "../utils/imageVariants.js";
import { useCachedFetch } from "../utils/useCachedFetch.js";

// Entity-type tag colors used app-wide (Compare uses the same mapping):
// album → ACCENT_A, track → ACCENT_B, artist → ACCENT_C.
const ENTITY_COLOR = { album: ACCENT_A, track: ACCENT_B, artist: ACCENT_C };
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
// Number of lines past which we show a "Show more" affordance. Anything
// shorter than this fits entirely in the collapsed clamp, so the toggle
// would be a no-op — we detect that case below and only render the
// expand button when the body actually overflows.
const COMMUNITY_CLAMP_LINES = 4;

function ReviewCardItem({ item, user, onVote, badges }) {
  // Track whether the user has chosen to expand THIS review's body
  // (per-item state — collapsing back returns to the 4-line clamp).
  const [bodyExpanded, setBodyExpanded] = useState(false);
  // Track whether the clamp is actually clipping content. Set via a ref
  // callback that compares scrollHeight to clientHeight on first paint.
  // If the body fits in 4 lines, we hide the "Show more" button entirely
  // (rendering it on a short review would be misleading — there's
  // nothing to expand).
  const [bodyOverflows, setBodyOverflows] = useState(false);
  const measureBody = (el) => {
    if (!el) return;
    // Defer one frame so layout has settled (mentions can shift wrap).
    requestAnimationFrame(() => {
      setBodyOverflows(el.scrollHeight - el.clientHeight > 1);
    });
  };
  // Tapping Share opens the CardPreviewModal scoped to this review,
  // mirroring the Friends-tab + entity-page + post-deck-review share
  // flows. Generates a "quote" card PNG via /api/og/review?id=<id>.
  // Anchor (#review-{id}) lands the recipient on the exact review when
  // they open the link on the album page.
  const [cardOpen, setCardOpen] = useState(false);
  const userName = item.user?.display_name ?? "Someone";
  const cardShareUrl = `${window.location.origin}/${item.entity_type}/${item.entity_id}#review-${item.id}`;
  const cardShareText = `${userName}'s review on Contour`;

  return (
    <div style={{ padding: "16px 0", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
      <Link to={`/${item.entity_type}/${item.entity_id}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        {item.entity_image_url
          ? <img src={imageMedium(item.entity_image_url)} alt="" loading="lazy" decoding="async" style={{ width: 42, height: 42, borderRadius: item.entity_type === "artist" ? "50%" : 6, objectFit: "cover", flexShrink: 0 }} />
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
        <Link to={userPath(item.user?.id)} style={{ flexShrink: 0 }}>
          {item.user?.image_url
            ? <img src={imageThumb(item.user.image_url)} alt="" loading="lazy" decoding="async" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }} />
            : <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--surface2)" }} />
          }
        </Link>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Link to={userPath(item.user?.id)} style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", textDecoration: "none" }}>
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

      {/* Body — line-clamped at 4 lines by default. A "Show more" button
          below toggles the clamp off so long reviews can be read in
          full. Reported case: users in the Community feed couldn't
          reach the end of longer reviews. Measure-on-mount detects
          whether the body actually exceeds the clamp; the toggle is
          hidden on short reviews where it would be a misleading
          no-op. WebkitLineClamp="unset" rather than removing the
          property entirely so the transition stays smooth and the
          display:-webkit-box layout doesn't reflow. */}
      <p
        ref={measureBody}
        style={{
          fontSize: 14, color: "var(--text-muted)", lineHeight: 1.65, margin: 0,
          display: "-webkit-box",
          WebkitLineClamp: bodyExpanded ? "unset" : COMMUNITY_CLAMP_LINES,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          whiteSpace: "pre-wrap",
        }}
      >
        <MentionBody body={item.body} mentions={item.mentions} />
      </p>
      {bodyOverflows && (
        <button
          onClick={() => setBodyExpanded((e) => !e)}
          style={{
            alignSelf: "flex-start",
            background: "none", border: "none", padding: "2px 0",
            color: "var(--accent)", fontSize: 12, fontWeight: 600,
            cursor: "pointer", marginTop: -2,
          }}
        >
          {bodyExpanded ? "Show less" : "Show more"}
        </button>
      )}

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
        <button
          onClick={() => setCardOpen(true)}
          title="Share this review as a card"
          style={{
            marginLeft: "auto",
            background: "none",
            border: "none",
            padding: "4px 10px",
            fontSize: 12,
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          Share
        </button>
      </div>

      {/* Inline reply thread — same component the album-page review section
          and the Friends tab use, so the reply UX is identical across all
          surfaces (collapsible thread, inline form, report flow). Replaces
          the older affordance that linked out to the entity page. */}
      <ReplyThread reviewId={item.id} user={user} initialCount={item.replies_count ?? 0} />

      <CardPreviewModal
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        cardUrl={`${window.location.origin}/api/og/review?id=${item.id}`}
        shareUrl={cardShareUrl}
        shareText={cardShareText}
        fileName={`contour-review-${item.id}.png`}
      />
    </div>
  );
}

/**
 * Global reviews feed — every public review on the platform, sorted Recent /
 * Top / Controversial. Renders inside whatever container it's dropped in
 * (currently the For You page's "Reviews" tab). Was formerly the "All Reviews"
 * tab on /feed.
 */
// Page size for the community feed. Picked small enough that the
// initial load + render lands in <1s on a typical mobile connection,
// large enough that most users won't immediately hit "Load more".
const PAGE_SIZE = 10;

export function GlobalReviewsFeed() {
  const { user } = useAuth();
  const [sort, setSort] = useState("recent");

  // Cache the first page per sort. Subsequent pages are appended
  // imperatively below (not cached, since "Load more" is naturally
  // session-bound — users who tab away and come back land on page 1).
  // Switching Recent ↔ Top ↔ Controversial returns to page 1 for that
  // sort, instant on second visits via the SWR cache.
  const {
    data: firstPage,
    loading,
    mutate: mutateFirstPage,
  } = useCachedFetch(
    `community:reviews:${sort}:page0`,
    () => api.getGlobalReviews(sort, "all", PAGE_SIZE, 0),
  );
  const { data: badges } = useCachedFetch(
    "community:badges",
    () => api.getBadges(),
    { freshMs: 5 * 60_000 }, // badges drift slowly; 5min fresh window
  );

  // Accumulated extra pages beyond the cached first page. Reset to
  // empty when sort changes (the cached first page already swaps
  // automatically via the key).
  const [extraPages, setExtraPages] = useState([]);
  const [extraHasMore, setExtraHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    // New sort selected → discard previously-loaded extra pages.
    // First page swaps automatically via the cached fetch key.
    setExtraPages([]);
    setExtraHasMore(true);
  }, [sort]);

  // Combine first page (cached) + any "load more" results into one
  // flat list. has_more comes from the most recent loaded page.
  const firstItems = Array.isArray(firstPage?.items) ? firstPage.items : [];
  const firstHasMore = !!firstPage?.has_more;
  const reviewsList = [...firstItems, ...extraPages.flatMap((p) => p.items || [])];
  const hasMore = extraPages.length > 0 ? extraHasMore : firstHasMore;

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const offset = firstItems.length + extraPages.reduce((n, p) => n + (p.items?.length || 0), 0);
      const res = await api.getGlobalReviews(sort, "all", PAGE_SIZE, offset);
      setExtraPages((prev) => [...prev, res]);
      setExtraHasMore(!!res?.has_more);
    } catch (e) {
      // Surface failure briefly via has_more=false so user isn't
      // stuck tapping a non-responsive button. Next refresh resets.
      setExtraHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  function handleVote(reviewId, value) {
    if (!user) return;
    api.voteReview(reviewId, value).then((res) => {
      // Vote may land in firstPage's items OR in one of the extra
      // pages — search both and update in-place. Keeps the optimistic
      // UI consistent across the paginated boundary.
      const inFirst = firstItems.some((r) => r.id === reviewId);
      if (inFirst) {
        const nextItems = firstItems.map((r) =>
          r.id === reviewId
            ? { ...r, upvotes: res.upvotes, downvotes: res.downvotes, user_vote: res.user_vote }
            : r
        );
        mutateFirstPage({ ...firstPage, items: nextItems });
      } else {
        setExtraPages((prev) => prev.map((page) => ({
          ...page,
          items: (page.items || []).map((r) =>
            r.id === reviewId
              ? { ...r, upvotes: res.upvotes, downvotes: res.downvotes, user_vote: res.user_vote }
              : r
          ),
        })));
      }
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
      {!loading && reviewsList.length === 0 && (
        <EmptyState
          icon={<PenIcon size={28} />}
          description="No reviews yet. Be the first to write one."
        />
      )}
      {!loading && reviewsList.map((item) => (
        <ReviewCardItem key={item.id} item={item} user={user} onVote={handleVote} badges={badges} />
      ))}
      {!loading && hasMore && reviewsList.length > 0 && (
        <div style={{ display: "flex", justifyContent: "center", padding: "16px 0 8px" }}>
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              padding: "10px 24px", fontSize: 13, fontWeight: 600,
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-xl)",
              color: loadingMore ? "var(--text-muted)" : "var(--text)",
              cursor: loadingMore ? "default" : "pointer",
              transition: "background 0.12s",
            }}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
