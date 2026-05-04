import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { TasteSection } from "../components/TasteSection.jsx";

const ACCENT = "#a78bfa";
const ACCENT_B = "#34d399";
const GOLD = "#f59e0b";

function Stars({ value }) {
  return (
    <span style={{ display: "inline-flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ fontSize: 12, color: value >= n - 0.5 ? GOLD : "var(--border)", opacity: value >= n - 0.5 ? 1 : 0.3 }}>★</span>
      ))}
    </span>
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
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [tab, setTab] = useState("taste");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getUser(id),
      api.getUserReviews(id).catch(() => []),
    ])
      .then(([p, rev]) => {
        setProfile(p);
        setReviews(rev);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function handleFollow() {
    if (!me) return;
    setFollowLoading(true);
    try {
      const res = await api.toggleFollow(id);
      setProfile((p) => ({ ...p, is_following: res.following, followers_count: p.followers_count + (res.following ? 1 : -1) }));
    } catch {}
    setFollowLoading(false);
  }

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (!profile) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>User not found.</div>;

  const tabStyle = (active) => ({
    padding: "10px 18px", fontSize: 13, fontWeight: active ? 700 : 400,
    background: "none", border: "none", cursor: "pointer",
    borderBottom: active ? `2px solid ${ACCENT}` : "2px solid transparent",
    color: active ? "var(--text)" : "var(--text-muted)",
    marginBottom: -1, whiteSpace: "nowrap",
  });

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px", display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Profile header */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
        {profile.image_url
          ? <img src={profile.image_url} alt={profile.display_name} style={{ width: 88, height: 88, borderRadius: "50%", objectFit: "cover", border: "3px solid var(--border)" }} />
          : <div style={{ width: 88, height: 88, borderRadius: "50%", background: "var(--surface2)", border: "3px solid var(--border)" }} />
        }

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{profile.display_name}</h1>
          {profile.bio && (
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6, maxWidth: 420 }}>{profile.bio}</p>
          )}
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 24, fontSize: 13, color: "var(--text-muted)" }}>
          <span><strong style={{ color: "var(--text)" }}>{profile.ratings_count}</strong> ratings</span>
          <span><strong style={{ color: "var(--text)" }}>{profile.reviews_count}</strong> reviews</span>
          <span><strong style={{ color: "var(--text)" }}>{profile.followers_count}</strong> followers</span>
          <span><strong style={{ color: "var(--text)" }}>{profile.following_count}</strong> following</span>
        </div>

        {/* Follow button */}
        {me && !profile.is_self && (
          <button
            onClick={handleFollow}
            disabled={followLoading}
            style={{
              padding: "8px 28px", borderRadius: 20, fontWeight: 700, fontSize: 13,
              cursor: followLoading ? "default" : "pointer",
              background: profile.is_following
                ? "var(--surface2)"
                : `linear-gradient(90deg, ${ACCENT}, ${ACCENT_B})`,
              color: profile.is_following ? "var(--text-muted)" : "#000",
              border: profile.is_following ? "1px solid var(--border)" : "none",
              transition: "all 0.15s",
            }}
          >
            {profile.is_following ? "Following ✓" : "Follow"}
          </button>
        )}
        {!me && (
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            <Link to="/" style={{ color: ACCENT }}>Sign in</Link> to follow this user.
          </p>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", overflowX: "auto" }}>
        <button style={tabStyle(tab === "taste")} onClick={() => setTab("taste")}>Taste</button>
        <button style={tabStyle(tab === "reviews")} onClick={() => setTab("reviews")}>
          Reviews {profile.reviews_count > 0 && `(${profile.reviews_count})`}
        </button>
      </div>

      {/* Taste tab */}
      {tab === "taste" && (
        <TasteSection userId={id} isOwner={false} />
      )}

      {/* Reviews tab */}
      {tab === "reviews" && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {reviews.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No reviews yet.</p>
          )}
          {reviews.map((r) => {
            const entityColor = r.entity_type === "album" ? ACCENT : r.entity_type === "track" ? ACCENT_B : "#fb923c";
            const entityPath = `/${r.entity_type}/${r.entity_id}`;
            return (
              <div key={r.id} style={{ padding: "16px 0", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
                <Link to={entityPath} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
                  {r.entity_image_url
                    ? <img src={r.entity_image_url} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                    : <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: entityColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.entity_name ?? r.entity_id}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {r.entity_artists?.join(", ")} · {timeAgo(r.created_at)}
                    </div>
                  </div>
                  {r.rating && <Stars value={r.rating} />}
                </Link>
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {r.body}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
