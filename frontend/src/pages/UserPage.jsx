import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT = "#a78bfa";

export function UserPage() {
  const { id } = useParams();
  const { user: me } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getUser(id)
      .then(setProfile)
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

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "48px 24px", display: "flex", flexDirection: "column", gap: 24, alignItems: "center" }}>
      {profile.image_url
        ? <img src={profile.image_url} alt={profile.display_name} style={{ width: 100, height: 100, borderRadius: "50%", objectFit: "cover" }} />
        : <div style={{ width: 100, height: 100, borderRadius: "50%", background: "var(--surface2)" }} />
      }

      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>{profile.display_name}</h1>
        <div style={{ display: "flex", gap: 24, justifyContent: "center", fontSize: 13, color: "var(--text-muted)" }}>
          <span><strong style={{ color: "var(--text)" }}>{profile.ratings_count}</strong> ratings</span>
          <span><strong style={{ color: "var(--text)" }}>{profile.reviews_count}</strong> reviews</span>
          <span><strong style={{ color: "var(--text)" }}>{profile.followers_count}</strong> followers</span>
          <span><strong style={{ color: "var(--text)" }}>{profile.following_count}</strong> following</span>
        </div>
      </div>

      {me && !profile.is_self && (
        <button
          onClick={handleFollow}
          disabled={followLoading}
          style={{
            padding: "8px 24px", borderRadius: 20, fontWeight: 700, fontSize: 13,
            cursor: followLoading ? "default" : "pointer",
            background: profile.is_following ? "var(--surface2)" : ACCENT,
            color: profile.is_following ? "var(--text-muted)" : "#000",
            border: profile.is_following ? "1px solid var(--border)" : "none",
            transition: "all 0.15s",
          }}
        >
          {profile.is_following ? "Following" : "Follow"}
        </button>
      )}

      {!me && (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          <Link to="/" style={{ color: ACCENT }}>Sign in</Link> to follow this user.
        </p>
      )}
    </div>
  );
}
