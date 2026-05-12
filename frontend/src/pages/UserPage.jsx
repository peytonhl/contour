import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { TasteSection } from "../components/TasteSection.jsx";
import { BlockButton } from "../components/BlockButton.jsx";
import { StatTabs } from "../components/StatTabs.jsx";
import { userAvatar } from "../utils/userAvatar.js";
import { BadgeChips } from "./FeedPage.jsx";

const ACCENT = "#a78bfa";
const ACCENT_B = "#34d399";
const GOLD = "#f59e0b";

function ListCollage({ images }) {
  const slots = [0, 1, 2, 3];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", width: 52, height: 52, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
      {slots.map((i) =>
        images[i]
          ? <img key={i} src={images[i]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
      padding: "3px 10px", borderRadius: 4, fontSize: 13, fontWeight: 700, flexShrink: 0,
      background: high ? `${GOLD}18` : mid ? `${GOLD}0a` : "var(--surface2)",
      border: `1px solid ${high ? `${GOLD}50` : "var(--border)"}`,
      color: high ? GOLD : mid ? `${GOLD}99` : "var(--text-muted)",
    }}>
      {value}★
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

export function UserPage() {
  const { id } = useParams();
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
  ];

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column" }}>

      {/* ── Hero ── */}
      <div style={{
        padding: "40px 24px 32px",
        background: `linear-gradient(180deg, ${ACCENT}12 0%, transparent 100%)`,
        borderBottom: "1px solid var(--border)",
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
          </h1>
          <BadgeChips badges={badges} userId={id} size="md" />
          {profile.bio && (
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.65, maxWidth: 400 }}>
              {profile.bio}
            </p>
          )}
        </div>

        {/* Stats are no longer rendered here — they're the tab nav below. */}

        {/* Follow + Block / sign-in prompt */}
        {me && !profile.is_self && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={handleFollow}
              disabled={followLoading}
              style={{
                padding: "8px 28px", borderRadius: 6, fontWeight: 700, fontSize: 13,
                cursor: followLoading ? "default" : "pointer",
                background: profile.is_following ? "var(--surface2)" : `linear-gradient(90deg, ${ACCENT}, ${ACCENT_B})`,
                color: profile.is_following ? "var(--text-muted)" : "#000",
                border: profile.is_following ? "1px solid var(--border)" : "none",
                transition: "all 0.15s", letterSpacing: "0.01em",
              }}
            >
              {profile.is_following ? "Following" : "Follow"}
            </button>
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

      {/* ── Body ── */}
      <div style={{ padding: "24px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Stat-style tab nav — each cell shows count + label and activates a section. */}
        <StatTabs tabs={tabs} active={tab} onChange={setTab} />

        {/* ── Taste ── */}
        {tab === "taste" && <TasteSection userId={id} isOwner={false} />}

        {/* ── Ratings ── */}
        {tab === "ratings" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {ratings.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>No ratings yet.</p>
            )}
            {ratings.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", borderBottom: "1px solid var(--border)" }}>
                {r.entity_image_url
                  ? <img src={r.entity_image_url} alt={r.entity_name} style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 48, height: 48, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link
                    to={`/${r.entity_type}/${r.entity_id}`}
                    style={{ color: "var(--text)", fontWeight: 600, textDecoration: "none", fontSize: 14, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {r.entity_name ?? r.entity_id}
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
          </div>
        )}

        {/* ── Reviews ── */}
        {tab === "reviews" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {reviews.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>No reviews yet.</p>
            )}
            {reviews.map((r) => {
              const entityPath = `/${r.entity_type}/${r.entity_id}`;
              return (
                <div key={r.id} style={{ padding: "16px 0", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Link to={entityPath}>
                      {r.entity_image_url
                        ? <img src={r.entity_image_url} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 48, height: 48, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
                      }
                    </Link>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link to={entityPath} style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.entity_name ?? r.entity_id}
                      </Link>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                        {r.entity_artists?.join(", ")}
                        {r.entity_artists?.length > 0 && <span style={{ margin: "0 5px", opacity: 0.4 }}>·</span>}
                        {timeAgo(r.created_at)}
                      </div>
                    </div>
                    {r.rating && <RatingBadge value={r.rating} />}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {r.body}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Lists ── */}
        {tab === "lists" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {lists.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>No lists yet.</p>
            )}
            {lists.map((lst) => (
              <Link key={lst.id} to={`/list/${lst.id}`} style={{ textDecoration: "none", color: "var(--text)" }}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, transition: "border-color 0.15s" }}
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
          </div>
        )}

        {/* ── Following / Followers ── */}
        {tab === "following" && <UserList users={following} emptyText="Not following anyone yet." />}
        {tab === "followers" && <UserList users={followers} emptyText="No followers yet." />}
      </div>
    </div>
  );
}

// ── Compact user list — used by Following / Followers tabs ───────────────────
function UserList({ users, emptyText }) {
  if (!users?.length) {
    return <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>{emptyText}</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {users.map((u) => (
        <Link
          key={u.id}
          to={`/user/${u.id}`}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 14px", background: "var(--surface)",
            border: "1px solid var(--border)", borderRadius: 10,
            textDecoration: "none", color: "var(--text)",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = ACCENT}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
        >
          {u.image_url
            ? <img src={u.image_url} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
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
    </div>
  );
}
