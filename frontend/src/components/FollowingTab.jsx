import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { requireAuth } from "../services/authGate.js";
import { ReplyThread } from "./ReviewSection.jsx";
import { CardPreviewModal } from "./CardPreviewModal.jsx";
import { MentionBody } from "./Mentions.jsx";
import { ExpandableReviewBody } from "./ExpandableReviewBody.jsx";
import { EmptyState } from "./EmptyState.jsx";
import { ACCENT_A, ACCENT_B, ACCENT_C, GOLD } from "../theme.js";
import { StarIcon } from "./Icons.jsx";
import { imageMedium } from "../utils/imageVariants.js";
import { userPath } from "../constants/routes.js";

// Entity-type tag colors used app-wide (Compare uses the same mapping):
// album → ACCENT_A, track → ACCENT_B, artist → ACCENT_C.
const ENTITY_COLOR = { album: ACCENT_A, track: ACCENT_B, artist: ACCENT_C };

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
  // Card-share modal — opens the same preview-then-share flow the
  // album-page review row, profile page, and post-deck-review share
  // already use, scoped to this specific review. Generates a "quote"
  // card PNG via /api/og/review?id=<review_id>.
  const [cardOpen, setCardOpen] = useState(false);

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

  const userName = item.user?.display_name ?? "Someone";

  function voteBtn(value, label, count) {
    const active = userVote === value;
    const accessibleLabel = viewer
      ? (active ? "Remove vote" : value === 1 ? "Upvote review" : "Downvote review")
      : "Sign in to vote";
    return (
      <button
        onClick={() => handleVote(value)}
        disabled={!viewer || voting}
        title={accessibleLabel}
        aria-label={accessibleLabel}
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

  // Anchor share URL to the entity page with a #review-<id> hash so the
  // share recipient lands directly on this review (the entity page's
  // ReviewSection scrolls to the anchor and paginates if needed).
  const cardShareUrl = `${window.location.origin}/${item.entity_type}/${item.entity_id}#review-${item.id}`;
  const cardShareText = `${userName}'s review on Contour`;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
        {voteBtn(1, "▲", upvotes)}
        {voteBtn(-1, "▼", downvotes)}
        <button
          onClick={() => {
            setCardOpen(true);
            analytics.shareClicked?.("review");
          }}
          title="Share this review as a card"
          style={{
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
      <ReplyThread reviewId={item.id} user={viewer} initialCount={item.replies_count ?? 0} />
      <CardPreviewModal
        open={cardOpen}
        onClose={() => setCardOpen(false)}
        cardUrl={`${window.location.origin}/api/og/review?id=${item.id}`}
        shareUrl={cardShareUrl}
        shareText={cardShareText}
        fileName={`contour-review-${item.id}.png`}
      />
    </>
  );
}


function FollowingItem({ item }) {
  const { user: viewer } = useAuth();
  // entityPath is runtime-typed (entity_type varies) so it stays as a
  // template literal — the centralized builders are per-type and don't
  // cover the "any-type" case the feed needs here.
  const entityPath = `/${item.entity_type}/${item.entity_id}`;
  // Renamed local from `userPath` to `userHref` to avoid colliding with
  // the imported userPath() builder used inside the same module.
  const userHref = userPath(item.user?.id);
  const isReview = item.type === "review";

  return (
    <div style={{ display: "flex", gap: 14, padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
      <Link to={userHref} style={{ flexShrink: 0 }}>
        {item.user?.image_url
          ? <img src={imageMedium(item.user.image_url)} alt={item.user.display_name} loading="lazy" decoding="async" style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }} />
          : <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--surface2)" }} />
        }
      </Link>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <Link to={userHref} style={{ color: "var(--text)", fontWeight: 700, textDecoration: "none" }}>{item.user?.display_name}</Link>
          <span style={{ color: "var(--text-muted)" }}>{isReview ? " reviewed " : " rated "}</span>
          <Link to={entityPath} style={{ color: ENTITY_COLOR[item.entity_type] ?? "var(--text)", fontWeight: 600, textDecoration: "none" }}>
            {item.entity_name ?? `Unknown ${item.entity_type ?? "item"}`}
          </Link>
          {item.entity_artists?.length > 0 && (
            <span style={{ color: "var(--text-muted)" }}> by {item.entity_artists.slice(0, 2).join(", ")}</span>
          )}
        </div>
        {item.value && (
          <span style={{ display: "inline-flex", gap: 1, alignItems: "center" }}>
            {[1, 2, 3, 4, 5].map((n) => {
              const lit = item.value >= n - 0.5;
              return (
                <span key={n} style={{ color: lit ? GOLD : "var(--border)", opacity: lit ? 1 : 0.3, display: "inline-flex" }}>
                  <StarIcon size={12} filled={lit} />
                </span>
              );
            })}
          </span>
        )}
        {isReview && item.body && (
          <ExpandableReviewBody
            body={item.body}
            mentions={item.mentions}
            clampLines={3}
            fontSize={13}
            lineHeight={1.6}
          />
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
          <img src={imageMedium(item.entity_image_url)} alt={item.entity_name} loading="lazy" decoding="async" style={{ width: 48, height: 48, borderRadius: item.entity_type === "artist" ? "50%" : 6, objectFit: "cover" }} />
        </Link>
      )}
    </div>
  );
}

export function SuggestedUser({ u, onFollow }) {
  const [followed, setFollowed] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  async function handleFollow() {
    if (!user) {
      requireAuth({
        kind: "follow",
        triggerLabel: "save",
        returnTo: window.location.pathname,
        payload: { followType: "user", id: u.id, name: u.display_name },
      });
      return;
    }
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
      <Link to={userPath(u.id)} style={{ flexShrink: 0 }}>
        {u.image_url
          ? <img src={imageMedium(u.image_url)} alt={u.display_name} loading="lazy" decoding="async" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
          : <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--surface2)" }} />
        }
      </Link>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link to={userPath(u.id)} style={{ color: "var(--text)", fontWeight: 600, fontSize: 14, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {u.display_name}
          </Link>
          {/* "Similar taste" / "Active reviewer" badge — backend's ranking
              reason. Surfaces *why* this person was recommended without
              exposing the raw similarity score. */}
          {u.reason && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
              padding: "2px 7px", borderRadius: "var(--radius-xl)",
              background: `${ACCENT_A}1a`, color: ACCENT_A,
              flexShrink: 0, whiteSpace: "nowrap",
            }}>
              {u.reason}
            </span>
          )}
        </div>
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

// Module-level cache for the Friends feed + the suggested-users list.
// Survives FollowingTab mount/unmount so a user who tabs away to
// Profile and back doesn't pay the api.getFeed() round-trip again.
// SWR semantics: on remount, show cached data immediately; if older
// than CACHE_FRESH_MS, kick off a background revalidate. Cleared on
// logout via the cache-bust effect below (different user.id → empty
// cache so we don't leak A's feed to B). Reported 2026-05-25: tab
// switch Friends → Profile → Friends took 5+ seconds the second
// time around; this is almost all of that latency gone.
const CACHE_FRESH_MS = 60_000;  // fresh: trust cache, no revalidate
const CACHE_TTL_MS = 5 * 60_000; // stale beyond 5min: drop entirely
let _feedCache = null;       // { userId, data, fetchedAt }
let _suggestedCache = null;  // { data, fetchedAt }

/**
 * "Friends" tab content — chronological feed of ratings and reviews from
 * users you follow. Falls back to a suggested-people list when you follow
 * nobody, and a sign-in prompt when unauthenticated. Used inside ForYouPage.
 */
export function FollowingTab() {
  const { user } = useAuth();
  // Seed state from cache so the first render after remount is
  // instant — no "Loading…" flash for the back-to-Friends case.
  const initialFollowing = (() => {
    if (!_feedCache || _feedCache.userId !== user?.id) return [];
    if (Date.now() - _feedCache.fetchedAt > CACHE_TTL_MS) return [];
    return _feedCache.data;
  })();
  const initialSuggested = (() => {
    if (!_suggestedCache) return [];
    if (Date.now() - _suggestedCache.fetchedAt > CACHE_TTL_MS) return [];
    return _suggestedCache.data;
  })();
  const [following, setFollowing] = useState(initialFollowing);
  const [suggested, setSuggested] = useState(initialSuggested);
  // Only show "Loading…" when we have no cached data to show. The
  // SWR path (cache present, revalidating in background) renders
  // the stale data and silently swaps to fresh — no spinner.
  const [loadingFollowing, setLoadingFollowing] = useState(
    !!user && initialFollowing.length === 0
  );

  useEffect(() => {
    // Suggested users — refresh in background if stale; cheap call,
    // no spinner regardless. Don't fire if cache is fresh.
    const suggestedFresh = _suggestedCache
      && Date.now() - _suggestedCache.fetchedAt < CACHE_FRESH_MS;
    if (!suggestedFresh) {
      api.getSuggestedUsers()
        .then((data) => {
          setSuggested(data);
          _suggestedCache = { data, fetchedAt: Date.now() };
        })
        .catch(() => {});
    }

    if (!user) return;

    // If we have a fresh same-user feed cache, skip the network
    // entirely — the seeded state IS the answer for this tick.
    const feedFresh = _feedCache
      && _feedCache.userId === user.id
      && Date.now() - _feedCache.fetchedAt < CACHE_FRESH_MS;
    if (feedFresh) {
      setLoadingFollowing(false);
      return;
    }

    // Cache miss or stale → revalidate. Show "Loading…" only when
    // we have nothing to render; otherwise swap silently.
    if (initialFollowing.length === 0) setLoadingFollowing(true);
    api.getFeed()
      .then((data) => {
        setFollowing(data);
        _feedCache = { userId: user.id, data, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Don't clobber existing cached data on a transient backend
        // error — the user keeps the last-known-good feed. Only
        // set [] when we had nothing to begin with.
        if (initialFollowing.length === 0) setFollowing([]);
      })
      .finally(() => setLoadingFollowing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
        <EmptyState
          title="Nothing here yet"
          description="Follow people to see their ratings and reviews here."
        >
          {suggested.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20, alignSelf: "stretch", textAlign: "left" }}>
              <p style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "var(--text)", margin: 0 }}>
                People to follow
              </p>
              {suggested.map((u) => (
                <SuggestedUser key={u.id} u={u} onFollow={(id) => setSuggested((prev) => prev.filter((x) => x.id !== id))} />
              ))}
            </div>
          )}
        </EmptyState>
      )}
      {user && !loadingFollowing && following.map((item, i) => (
        <FollowingItem key={`${item.type}-${item.user?.id}-${item.entity_id}-${i}`} item={item} />
      ))}

      {/* "More people to follow" tail — shown alongside the activity feed
          for users with some follows so the recommendations engine keeps
          working past the empty state. Backend ranks by taste similarity
          (artist Jaccard) so this stays relevant rather than spammy as
          the user's follow graph grows. Hidden when the empty-state above
          is already rendering the same suggestions (mutually exclusive on
          following.length). */}
      {user && !loadingFollowing && following.length > 0 && suggested.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "28px 0 8px", borderTop: "1px solid var(--border)", marginTop: 12 }}>
          <p style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "var(--text)", margin: 0 }}>
            More people to follow
          </p>
          {suggested.map((u) => (
            <SuggestedUser key={u.id} u={u} onFollow={(id) => setSuggested((prev) => prev.filter((x) => x.id !== id))} />
          ))}
        </div>
      )}
    </div>
  );
}
