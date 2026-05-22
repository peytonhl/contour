import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { TasteSection } from "../components/TasteSection.jsx";
import { BlockButton } from "../components/BlockButton.jsx";
import { StatTabs } from "../components/StatTabs.jsx";
import { userAvatar } from "../utils/userAvatar.js";
import { BadgeMark } from "../components/Badges.jsx";
import { BacklogTabContent } from "../components/BacklogTabContent.jsx";
import { EmptyHint } from "../components/Skeleton.jsx";
import { CardPreviewModal } from "../components/CardPreviewModal.jsx";
import { MentionBody } from "../components/Mentions.jsx";
import { ACCENT_A as ACCENT, ACCENT_B, GOLD, DANGER } from "../theme.js";

function ListCollage({ images }) {
  const slots = [0, 1, 2, 3];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", width: 52, height: 52, borderRadius: "var(--radius-md)", overflow: "hidden", flexShrink: 0 }}>
      {slots.map((i) =>
        images[i]
          ? <img key={i} src={images[i]} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div key={i} style={{ background: "var(--surface2)" }} />
      )}
    </div>
  );
}

function RatingBadge({ value }) {
  const high = value >= 4;
  const mid = value >= 3;
  return (
    <div style={{
      padding: "3px 10px", borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 700, flexShrink: 0,
      background: high ? `${GOLD}18` : mid ? `${GOLD}0a` : "var(--surface2)",
      border: `1px solid ${high ? `${GOLD}50` : "var(--border)"}`,
      color: high ? GOLD : mid ? `${GOLD}99` : "var(--text-muted)",
    }}>
      {value}★
    </div>
  );
}

// Show-all button rendered at the bottom of a capped tab list.
// Same outlined-secondary language as ProfilePage's version (kept here as
// a local helper to avoid a cross-page import for a 12-line component).
function ShowAllButton({ total, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        alignSelf: "flex-start",
        marginTop: 14,
        padding: "7px 16px",
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        color: "var(--text-muted)",
        fontSize: 13, fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Show all {total}
    </button>
  );
}

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

export function UserPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [lists, setLists] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [following, setFollowing] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [tab, setTab] = useState("taste");
  const [badges, setBadges] = useState(null);
  // Which review the user is sharing (id) — null = modal closed.
  const [shareReviewId, setShareReviewId] = useState(null);
  const shareReview = shareReviewId
    ? reviews.find((r) => r.id === shareReviewId)
    : null;

  // Cap each tab's list at TAB_VISIBLE_LIMIT items by default so this
  // page's bottom-of-scroll content (taste-tab CTA / suggestions, etc.)
  // is reachable without scrolling past hundreds of rows. "Show all N"
  // expands the current tab in place; resets on tab change.
  const TAB_VISIBLE_LIMIT = 10;
  const [tabExpanded, setTabExpanded] = useState(false);
  useEffect(() => { setTabExpanded(false); }, [tab]);

  useEffect(() => {
    api.getBadges().then(setBadges).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getUser(id),
      api.getUserReviews(id).catch(() => []),
      api.getUserLists(id).catch(() => []),
      api.getUserRatings(id).catch(() => []),
      api.getFollowing(id).catch(() => []),
      api.getFollowers(id).catch(() => []),
    ])
      .then(([p, rev, userLists, userRatings, followingList, followersList]) => {
        setProfile(p);
        setReviews(rev);
        setLists(userLists);
        setRatings(userRatings);
        setFollowing(followingList);
        setFollowers(followersList);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function handleFollow() {
    if (!me) return;
    setFollowLoading(true);
    try {
      const res = await api.toggleFollow(id);
      if (res.following) analytics.followUser();
      setProfile((p) => ({ ...p, is_following: res.following, followers_count: p.followers_count + (res.following ? 1 : -1) }));
    } catch {}
    setFollowLoading(false);
  }

  // Optimistic vote on someone else's review from their profile page. Same
  // pattern as ReviewSection.handleVote — tap the active arrow to clear it,
  // tap the opposite to swap. Server reconciles the totals via the response.
  async function handleVote(reviewId, value) {
    if (!me) return;
    setReviews((prev) => prev.map((r) => {
      if (r.id !== reviewId) return r;
      const prevVote = r.user_vote ?? 0;
      const nextVote = prevVote === value ? 0 : value;
      let up = r.upvotes ?? 0;
      let down = r.downvotes ?? 0;
      if (prevVote === 1) up -= 1;
      if (prevVote === -1) down -= 1;
      if (nextVote === 1) up += 1;
      if (nextVote === -1) down += 1;
      return { ...r, upvotes: Math.max(0, up), downvotes: Math.max(0, down), user_vote: nextVote || undefined };
    }));
    analytics.reviewVoted?.(value === 1 ? "up" : "down");
    try {
      const res = await api.voteReview(reviewId, value);
      setReviews((prev) => prev.map((r) =>
        r.id === reviewId
          ? { ...r, upvotes: res.upvotes, downvotes: res.downvotes, user_vote: res.user_vote }
          : r
      ));
    } catch { /* leave optimistic state; not worth a refetch for a vote */ }
  }

  if (loading) return <div style={{ padding: 80, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Loading…</div>;
  if (!profile) return <div style={{ padding: 80, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>User not found.</div>;

  // No `count` on Taste — it's the "Hi, this is me" view, not a count of anything.
  const tabs = [
    { key: "taste",     label: "Taste" },
    { key: "ratings",   label: "Ratings",   count: profile.ratings_count ?? ratings.length },
    { key: "reviews",   label: "Reviews",   count: profile.reviews_count ?? reviews.length },
    { key: "lists",     label: "Lists",     count: lists.length },
    { key: "following", label: "Following", count: profile.following_count ?? following.length },
    { key: "followers", label: "Followers", count: profile.followers_count ?? followers.length },
    // Backlog — public, viewable on anyone's profile.
    { key: "backlog",   label: "Backlog" },
  ];

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column" }}>

      {/* Back affordance — users landing here via an @-mention link, a
          followers list, or a search result need a way out. Same pattern
          as TasteMatchPage: navigate(-1) when there's history, fall back
          to /friends on deep-link entry so users aren't stranded. */}
      <button
        onClick={() => {
          if (window.history.length > 1) navigate(-1);
          else navigate("/friends");
        }}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "transparent", border: "none",
          color: "var(--text-muted)", fontSize: 14,
          padding: "16px 16px 0",
          alignSelf: "flex-start",
          cursor: "pointer",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>

      {/* ── Hero ── */}
      <div style={{
        paddingTop: 24,
        background: `linear-gradient(180deg, ${ACCENT}14 0%, transparent 100%)`,
      }}>
        {/* Centered content (avatar / name / buttons). Kept in its own
            flex-column wrapper so the StatTabs below can span full width. */}
        <div style={{
          padding: "0 24px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          textAlign: "center",
        }}>
        {/* Avatar with gradient ring */}
        <div style={{
          width: 92, height: 92, borderRadius: "50%",
          background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_B})`,
          padding: 2, flexShrink: 0,
        }}>
          <img
            src={userAvatar(profile, 180)}
            alt={profile.display_name}
            style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block", border: "3px solid var(--bg)" }}
          />
        </div>

        {/* Name + bio */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.025em", margin: 0, lineHeight: 1.1 }}>
            {profile.display_name}
            <BadgeMark badges={badges} userId={id} size="md" />
          </h1>
          {profile.bio && (
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.65, maxWidth: 400 }}>
              {profile.bio}
            </p>
          )}
        </div>

        {/* Stats are no longer rendered here — they're the tab nav below. */}

        {/* Follow + Compare taste + Block / sign-in prompt */}
        {me && !profile.is_self && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={handleFollow}
              disabled={followLoading}
              style={{
                padding: "8px 28px", borderRadius: "var(--radius-sm)", fontWeight: 700, fontSize: 13,
                cursor: followLoading ? "default" : "pointer",
                background: profile.is_following ? "var(--surface2)" : `linear-gradient(90deg, ${ACCENT}, ${ACCENT_B})`,
                color: profile.is_following ? "var(--text-muted)" : "#000",
                border: profile.is_following ? "1px solid var(--border)" : "none",
                transition: "all 0.15s", letterSpacing: "0.01em",
              }}
            >
              {profile.is_following ? "Following" : "Follow"}
            </button>
            <Link
              to={`/taste-match/${id}`}
              style={{
                padding: "8px 18px",
                borderRadius: "var(--radius-sm)",
                fontWeight: 700,
                fontSize: 13,
                textDecoration: "none",
                color: "var(--text)",
                background: "transparent",
                border: "1px solid var(--border)",
                letterSpacing: "0.01em",
              }}
            >
              Compare taste
            </Link>
            <BlockButton
              targetUserId={id}
              initiallyBlocked={profile.is_blocked ?? false}
              onChange={(isBlocked) => setProfile((p) => ({ ...p, is_blocked: isBlocked }))}
            />
          </div>
        )}
        {!me && (
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            <Link to="/" style={{ color: ACCENT }}>Sign in</Link> to follow this user.
          </p>
        )}
        </div>

        {/* Stat-style tab nav lives inside the hero — its built-in bottom
            border acts as the seamless separator between hero and content. */}
        <StatTabs tabs={tabs} active={tab} onChange={setTab} />
      </div>

      {/* ── Body ── */}
      <div style={{ padding: "24px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── Taste ── */}
        {tab === "taste" && <TasteSection userId={id} isOwner={false} ratings={ratings} />}

        {/* ── Ratings ── */}
        {tab === "ratings" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {ratings.length === 0 && <EmptyHint>No ratings yet.</EmptyHint>}
            {(tabExpanded ? ratings : ratings.slice(0, TAB_VISIBLE_LIMIT)).map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", borderBottom: "1px solid var(--border)" }}>
                {r.entity_image_url
                  ? <img src={r.entity_image_url} alt={r.entity_name} loading="lazy" decoding="async" style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", background: "var(--surface2)", flexShrink: 0 }} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link
                    to={`/${r.entity_type}/${r.entity_id}`}
                    style={{ color: "var(--text)", fontWeight: 600, textDecoration: "none", fontSize: 14, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {r.entity_name ?? `Unknown ${r.entity_type ?? "item"}`}
                  </Link>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    {r.entity_artists?.join(", ")}
                    {r.entity_artists?.length > 0 && <span style={{ margin: "0 5px", opacity: 0.4 }}>·</span>}
                    {timeAgo(r.created_at)}
                  </div>
                </div>
                <RatingBadge value={r.value} />
              </div>
            ))}
            {!tabExpanded && ratings.length > TAB_VISIBLE_LIMIT && (
              <ShowAllButton total={ratings.length} onClick={() => setTabExpanded(true)} />
            )}
          </div>
        )}

        {/* ── Reviews ── */}
        {tab === "reviews" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {reviews.length === 0 && <EmptyHint>No reviews yet.</EmptyHint>}
            {(tabExpanded ? reviews : reviews.slice(0, TAB_VISIBLE_LIMIT)).map((r) => {
              // Anchor link drops the viewer onto the entity page scrolled
              // to the actual review thread, so vote ↦ jump-to-thread is
              // one tap and lands them where the reply chain lives.
              const threadPath = `/${r.entity_type}/${r.entity_id}#review-${r.id}`;
              const canVote = me && id !== me.id;
              return (
                // Was a <Link>; now a <div onClick> because the review body
                // embeds mention <Link>s via <MentionBody>, and nesting <a>
                // inside <a> is an HTML5 violation. Row stays fully clickable
                // (cursor + keyboard); mention links inside navigate
                // independently with stopPropagation guarding the row's
                // onClick (see Mentions.jsx).
                <div
                  key={r.id}
                  onClick={() => navigate(threadPath)}
                  role="link"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(threadPath);
                    }
                  }}
                  style={{
                    padding: "16px 0",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {r.entity_image_url
                      ? <img src={r.entity_image_url} alt="" loading="lazy" decoding="async" style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 }} />
                      : <div style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", background: "var(--surface2)", flexShrink: 0 }} />
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.entity_name ?? `Unknown ${r.entity_type ?? "item"}`}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                        {r.entity_artists?.join(", ")}
                        {r.entity_artists?.length > 0 && <span style={{ margin: "0 5px", opacity: 0.4 }}>·</span>}
                        {timeAgo(r.created_at)}
                      </div>
                    </div>
                    {r.rating && <RatingBadge value={r.rating} />}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" }}>
                    <MentionBody body={r.body} mentions={r.mentions} />
                  </p>

                  {/* Vote row. Buttons stop propagation so tapping ▲/▼
                      doesn't also fire the row's navigation to the thread.
                      Hidden on the viewer's own profile (no self-voting)
                      and for signed-out users (canVote === false → buttons
                      render disabled with no action). */}
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (canVote) handleVote(r.id, 1); }}
                      disabled={!canVote}
                      title={canVote ? "Upvote this review" : (me ? "Can't vote on your own review" : "Sign in to vote")}
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        background: "none", border: "none", padding: "2px 4px",
                        fontSize: 12, cursor: canVote ? "pointer" : "default",
                        color: r.user_vote === 1 ? ACCENT : "var(--text-muted)",
                        fontWeight: r.user_vote === 1 ? 700 : 400,
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill={r.user_vote === 1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                      {r.upvotes > 0 ? r.upvotes : ""}
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (canVote) handleVote(r.id, -1); }}
                      disabled={!canVote}
                      title={canVote ? "Downvote this review" : (me ? "Can't vote on your own review" : "Sign in to vote")}
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        background: "none", border: "none", padding: "2px 4px",
                        fontSize: 12, cursor: canVote ? "pointer" : "default",
                        color: r.user_vote === -1 ? DANGER : "var(--text-muted)",
                        fontWeight: r.user_vote === -1 ? 700 : 400,
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill={r.user_vote === -1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                      {r.downvotes > 0 ? r.downvotes : ""}
                    </button>
                    {/* Reply ↦ jump to the review thread on the entity page,
                        which is where the reply composer + chain live. The
                        whole row is already a Link to the same anchor — this
                        button mirrors the same destination with an explicit
                        "Reply" affordance so users don't have to discover
                        the tap-to-thread interaction. */}
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = threadPath; }}
                      title="Reply on the thread"
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        background: "none", border: "none", padding: "2px 4px",
                        fontSize: 12, cursor: "pointer",
                        color: "var(--text-muted)",
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                      {(r.replies_count ?? r.reply_count ?? 0) > 0 ? (r.replies_count ?? r.reply_count) : ""}
                    </button>
                    {/* Share — opens the CardPreviewModal scoped to this
                        review id. Same modal used everywhere; native iOS
                        Capacitor share goes through @capacitor/share so the
                        PNG actually attaches to the iMessage. */}
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShareReviewId(r.id); }}
                      title="Share this review"
                      aria-label="Share this review"
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        background: "none", border: "none", padding: "2px 4px",
                        fontSize: 12, cursor: "pointer",
                        color: "var(--text-muted)",
                      }}
                    >
                      ↗
                    </button>
                  </div>
                </div>
              );
            })}
            {!tabExpanded && reviews.length > TAB_VISIBLE_LIMIT && (
              <ShowAllButton total={reviews.length} onClick={() => setTabExpanded(true)} />
            )}
          </div>
        )}

        {/* ── Lists ── */}
        {tab === "lists" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {lists.length === 0 && <EmptyHint>No lists yet.</EmptyHint>}
            {(tabExpanded ? lists : lists.slice(0, TAB_VISIBLE_LIMIT)).map((lst) => (
              <Link key={lst.id} to={`/list/${lst.id}`} style={{ textDecoration: "none", color: "var(--text)" }}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", transition: "border-color 0.15s" }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = ACCENT}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
                >
                  <ListCollage images={lst.preview_images ?? []} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lst.title}</div>
                    {lst.description && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{lst.description}</div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                      {lst.is_ranked ? "Ranked" : "Unranked"} · {lst.item_count} item{lst.item_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              </Link>
            ))}
            {!tabExpanded && lists.length > TAB_VISIBLE_LIMIT && (
              <ShowAllButton total={lists.length} onClick={() => setTabExpanded(true)} />
            )}
          </div>
        )}

        {/* ── Following / Followers ── */}
        {tab === "following" && (
          <UserList
            users={tabExpanded ? following : following.slice(0, TAB_VISIBLE_LIMIT)}
            emptyText="Not following anyone yet."
            footer={!tabExpanded && following.length > TAB_VISIBLE_LIMIT && (
              <ShowAllButton total={following.length} onClick={() => setTabExpanded(true)} />
            )}
          />
        )}
        {tab === "followers" && (
          <UserList
            users={tabExpanded ? followers : followers.slice(0, TAB_VISIBLE_LIMIT)}
            emptyText="No followers yet."
            footer={!tabExpanded && followers.length > TAB_VISIBLE_LIMIT && (
              <ShowAllButton total={followers.length} onClick={() => setTabExpanded(true)} />
            )}
          />
        )}

        {/* ── Backlog (public) ── */}
        {tab === "backlog" && (
          <BacklogTabContent userId={id} isOwner={false} showSuggestions={false} />
        )}
      </div>
      {/* Card-share modal — mounted once at the page root and driven by
          shareReviewId so any review row can trigger it. */}
      {shareReview && (
        <CardPreviewModal
          open={shareReviewId !== null}
          onClose={() => setShareReviewId(null)}
          cardUrl={`${window.location.origin}/api/og/review?id=${shareReview.id}`}
          shareUrl={`${window.location.origin}/${shareReview.entity_type}/${shareReview.entity_id}#review-${shareReview.id}`}
          shareText={`${profile?.display_name ?? "A Contour user"}'s review on Contour`}
          fileName={`contour-review-${shareReview.id}.png`}
        />
      )}
    </div>
  );
}

// ── Compact user list — used by Following / Followers tabs ───────────────────
function UserList({ users, emptyText, footer }) {
  if (!users?.length) {
    return <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>{emptyText}</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{/* footer rendered after the list inside this same container */}
      {users.map((u) => (
        <Link
          key={u.id}
          to={`/user/${u.id}`}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 14px", background: "var(--surface)",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            textDecoration: "none", color: "var(--text)",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = ACCENT}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
        >
          {u.image_url
            ? <img src={u.image_url} alt="" loading="lazy" decoding="async" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
            : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {u.display_name}
            </div>
            {u.bio && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                {u.bio.slice(0, 80)}{u.bio.length > 80 ? "…" : ""}
              </div>
            )}
          </div>
        </Link>
      ))}
      {footer}
    </div>
  );
}
