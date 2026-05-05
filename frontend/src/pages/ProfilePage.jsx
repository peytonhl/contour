import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { TasteSection } from "../components/TasteSection.jsx";

function ListCollage({ images }) {
  const slots = [0, 1, 2, 3];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", width: 56, height: 56, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
      {slots.map((i) =>
        images[i]
          ? <img key={i} src={images[i]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div key={i} style={{ background: "var(--surface2)" }} />
      )}
    </div>
  );
}

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
  const [editingBio, setEditingBio] = useState(false);
  const [bioInput, setBioInput] = useState("");
  const [savingBio, setSavingBio] = useState(false);
  const [lists, setLists] = useState([]);
  const [showCreateList, setShowCreateList] = useState(false);
  const [newListTitle, setNewListTitle] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [newListRanked, setNewListRanked] = useState(true);
  const [creatingList, setCreatingList] = useState(false);

  useEffect(() => {
    if (!user) { navigate("/"); return; }
    Promise.all([
      api.getProfile(),
      api.getFollowing(user.id).catch(() => []),
      api.getFollowers(user.id).catch(() => []),
      api.getUserLists(user.id).catch(() => []),
    ])
      .then(([p, following, followers, userLists]) => {
        setProfile(p);
        setFollowing(following);
        setFollowers(followers);
        setLists(userLists);
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

  async function handleSaveBio() {
    setSavingBio(true);
    try {
      await api.updateProfile(bioInput);
      setProfile((p) => p ? { ...p } : p);
      setEditingBio(false);
    } finally {
      setSavingBio(false);
    }
  }

  async function handleCreateList() {
    if (!newListTitle.trim()) return;
    setCreatingList(true);
    try {
      const created = await api.createList(newListTitle.trim(), newListDesc.trim() || null, newListRanked);
      navigate(`/list/${created.id}`);
    } finally {
      setCreatingList(false);
    }
  }

  if (!user) return null;
  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;

  const tabs = [
    { key: "ratings", label: `Ratings (${profile?.ratings?.length ?? 0})` },
    { key: "reviews", label: `Reviews (${profile?.reviews?.length ?? 0})` },
    { key: "lists", label: `Lists (${lists.length})` },
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
          {/* Bio */}
          {!editingBio && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              {user.bio
                ? <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6, maxWidth: 400 }}>{user.bio}</p>
                : <p style={{ fontSize: 13, color: "var(--border)", margin: 0, fontStyle: "italic" }}>No bio yet</p>
              }
              <button
                onClick={() => { setBioInput(user.bio ?? ""); setEditingBio(true); }}
                style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "1px solid var(--border)", borderRadius: 5, cursor: "pointer", padding: "2px 8px", flexShrink: 0 }}
              >
                Edit
              </button>
            </div>
          )}
          {editingBio && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 400 }}>
              <textarea
                autoFocus
                value={bioInput}
                onChange={(e) => setBioInput(e.target.value.slice(0, 300))}
                placeholder="Tell people about your taste…"
                rows={3}
                style={{
                  width: "100%", padding: "8px 10px", fontSize: 13,
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  borderRadius: 8, color: "var(--text)", resize: "vertical",
                  outline: "none", boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={handleSaveBio} disabled={savingBio}
                  style={{ fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 6, background: ACCENT, border: "none", color: "#000", cursor: "pointer" }}
                >
                  {savingBio ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setEditingBio(false)}
                  style={{ fontSize: 12, color: "var(--text-muted)", background: "none", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", padding: "5px 10px" }}
                >
                  Cancel
                </button>
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>{bioInput.length}/300</span>
              </div>
            </div>
          )}

          <button
            onClick={logout}
            style={{ fontSize: 12, color: "var(--text-muted)", background: "none", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer", padding: "4px 10px", alignSelf: "flex-start" }}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Taste profile */}
      <TasteSection userId={user.id} isOwner={true} />

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

      {/* Lists */}
      {tab === "lists" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Create list button / form */}
          {!showCreateList ? (
            <button
              onClick={() => { setShowCreateList(true); setNewListTitle(""); setNewListDesc(""); setNewListRanked(true); }}
              style={{
                alignSelf: "flex-start", padding: "8px 18px", borderRadius: 8, fontWeight: 700, fontSize: 13,
                background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_B})`, border: "none", color: "#000", cursor: "pointer",
              }}
            >
              + New list
            </button>
          ) : (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                autoFocus
                value={newListTitle}
                onChange={(e) => setNewListTitle(e.target.value.slice(0, 200))}
                placeholder="List title…"
                style={{ padding: "8px 12px", background: "var(--surface2)", border: `1px solid ${ACCENT}60`, borderRadius: 8, color: "var(--text)", fontSize: 14, outline: "none" }}
              />
              <textarea
                value={newListDesc}
                onChange={(e) => setNewListDesc(e.target.value.slice(0, 500))}
                placeholder="Description (optional)…"
                rows={2}
                style={{ padding: "8px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 13, outline: "none", resize: "vertical" }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>
                <input type="checkbox" checked={newListRanked} onChange={(e) => setNewListRanked(e.target.checked)} />
                Ranked (numbered)
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handleCreateList} disabled={creatingList || !newListTitle.trim()}
                  style={{ padding: "7px 18px", borderRadius: 8, fontWeight: 700, fontSize: 13, background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_B})`, border: "none", color: "#000", cursor: "pointer", opacity: !newListTitle.trim() ? 0.5 : 1 }}
                >
                  {creatingList ? "Creating…" : "Create"}
                </button>
                <button onClick={() => setShowCreateList(false)} style={{ padding: "7px 14px", borderRadius: 8, fontSize: 13, background: "none", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {lists.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No lists yet. Create one to get started.</p>
          )}

          {lists.map((lst) => (
            <Link key={lst.id} to={`/list/${lst.id}`} style={{ textDecoration: "none", color: "var(--text)" }}>
              <div
                style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, transition: "border-color 0.15s" }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = ACCENT}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
              >
                <ListCollage images={lst.preview_images ?? []} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lst.title}</div>
                  {lst.description && <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{lst.description}</div>}
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                    {lst.is_ranked ? "Ranked" : "Unranked"} · {lst.item_count} item{lst.item_count !== 1 ? "s" : ""}
                  </div>
                </div>
                <span style={{ fontSize: 18, color: "var(--text-muted)", flexShrink: 0 }}>›</span>
              </div>
            </Link>
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
