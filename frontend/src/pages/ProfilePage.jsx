import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const GOLD = "#f59e0b";
const ACCENT = "#a78bfa";
const ACCENT_B = "#34d399";

function Stars({ value, size = 14 }) {
  return (
    <span style={{ display: "inline-flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ fontSize: size, color: value >= n - 0.5 ? GOLD : "var(--border)", opacity: value >= n - 0.5 ? 1 : 0.3 }}>★</span>
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

function EntityRow({ item, right }) {
  const color = item.entity_type === "album" ? ACCENT : item.entity_type === "track" ? ACCENT_B : "var(--text)";
  const path = `/${item.entity_type}/${item.entity_id}`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
      {item.entity_image_url
        ? <img src={item.entity_image_url} alt={item.entity_name} style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
        : <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link to={path} style={{ color, fontWeight: 600, textDecoration: "none", fontSize: 14, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.entity_name ?? item.entity_id}
        </Link>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {item.entity_artists?.join(", ")}
          {item.entity_artists?.length > 0 && " · "}
          {timeAgo(item.created_at)}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>{right}</div>
    </div>
  );
}

export function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [artistDetails, setArtistDetails] = useState({});
  const [following, setFollowing] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("ratings");

  useEffect(() => {
    if (!user) { navigate("/"); return; }
    Promise.all([
      api.getProfile(),
      api.getFollowing(user.id).catch(() => []),
      api.getFollowers(user.id).catch(() => []),
    ])
      .then(([p, following, followers]) => {
        setProfile(p);
        setFollowing(following);
        setFollowers(followers);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!profile?.favorite_artists?.length) return;
    profile.favorite_artists.forEach(async (artistId) => {
      if (artistDetails[artistId]) return;
      try {
        const a = await api.getArtist(artistId);
        setArtistDetails((prev) => ({ ...prev, [artistId]: a }));
      } catch {}
    });
  }, [profile?.favorite_artists]);

  if (!user) return null;
  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;

  const tabs = [
    { key: "ratings", label: `Ratings (${profile?.ratings?.length ?? 0})` },
    { key: "reviews", label: `Reviews (${profile?.reviews?.length ?? 0})` },
    { key: "favorites", label: `Artists (${profile?.favorite_artists?.length ?? 0})` },
    { key: "following", label: `Following (${following.length})` },
    { key: "followers", label: `Followers (${followers.length})` },
  ];

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 28 }}>

      {/* Profile hero */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {user.image_url
          ? <img src={user.image_url} alt={user.display_name} style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover" }} />
          : <div style={{ width: 80, height: 80, borderRadius: "50%", background: "var(--surface2)" }} />
        }
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800 }}>{user.display_name}</h1>
          <div style={{ display: "flex", gap: 20, fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap" }}>
            <span><strong style={{ color: "var(--text)" }}>{profile?.ratings?.length ?? 0}</strong> ratings</span>
            <span><strong style={{ color: "var(--text)" }}>{profile?.reviews?.length ?? 0}</strong> reviews</span>
            <span><strong style={{ color: "var(--text)" }}>{following.length}</strong> following</span>
            <span><strong style={{ color: "var(--text)" }}>{followers.length}</strong> followers</span>
          </div>
          <button
            onClick={logout}
            style={{ fontSize: 12, color: "var(--text-muted)", background: "none", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", padding: "4px 10px", alignSelf: "flex-start" }}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", gap: 0, overflowX: "auto" }}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "10px 16px", fontSize: 13, fontWeight: tab === key ? 700 : 400, whiteSpace: "nowrap",
              background: "none", border: "none", borderBottom: tab === key ? `2px solid ${ACCENT}` : "2px solid transparent",
              color: tab === key ? "var(--text)" : "var(--text-muted)", cursor: "pointer", marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Ratings */}
      {tab === "ratings" && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {!profile?.ratings?.length && <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No ratings yet.</p>}
          {profile?.ratings?.map((r, i) => (
            <EntityRow key={i} item={r} right={<Stars value={r.value} />} />
          ))}
        </div>
      )}

      {/* Reviews */}
      {tab === "reviews" && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {!profile?.reviews?.length && <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No reviews yet.</p>}
          {profile?.reviews?.map((r, i) => (
            <div key={i} style={{ padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
              <EntityRow item={r} right={null} />
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6, margin: "8px 0 0 52px" }}>{r.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* Favorite Artists */}
      {tab === "favorites" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
          {!profile?.favorite_artists?.length && <p style={{ color: "var(--text-muted)", fontSize: 14, gridColumn: "1/-1" }}>No favorite artists yet.</p>}
          {profile?.favorite_artists?.map((artistId) => {
            const a = artistDetails[artistId];
            return (
              <Link key={artistId} to={`/artist/${artistId}`} style={{ textDecoration: "none", color: "var(--text)" }}>
                <div
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", transition: "border-color 0.15s, transform 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = "none"; }}
                >
                  {a?.image_url
                    ? <img src={a.image_url} alt={a.name} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                    : <div style={{ width: "100%", aspectRatio: "1", background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>🎵</div>
                  }
                  <div style={{ padding: "10px 12px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a?.name ?? "Loading…"}</div>
                    {a?.genres?.[0] && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{a.genres[0]}</div>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Following */}
      {tab === "following" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {!following.length && <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Not following anyone yet.</p>}
          {following.map((u) => (
            <Link key={u.id} to={`/user/${u.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}>
              {u.image_url
                ? <img src={u.image_url} alt={u.display_name} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface2)" }} />
              }
              <span style={{ fontSize: 14, fontWeight: 600 }}>{u.display_name}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Followers */}
      {tab === "followers" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {!followers.length && <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No followers yet.</p>}
          {followers.map((u) => (
            <Link key={u.id} to={`/user/${u.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}>
              {u.image_url
                ? <img src={u.image_url} alt={u.display_name} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface2)" }} />
              }
              <span style={{ fontSize: 14, fontWeight: 600 }}>{u.display_name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
