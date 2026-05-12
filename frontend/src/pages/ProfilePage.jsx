import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { TasteSection } from "../components/TasteSection.jsx";
import { StatTabs } from "../components/StatTabs.jsx";
import { userAvatar } from "../utils/userAvatar.js";
import { BadgeChips } from "../components/Badges.jsx";
import { BacklogTabContent } from "../components/BacklogTabContent.jsx";

const GOLD = "#f59e0b";
const ACCENT = "#a78bfa";
const ACCENT_B = "#34d399";

// ── Shared helpers ────────────────────────────────────────────────────────────

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
      letterSpacing: "0.01em",
    }}>
      {value}★
    </div>
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

function EntityRow({ item, right }) {
  const isAlbum = item.entity_type === "album";
  const isTrack = item.entity_type === "track";
  const accent = isAlbum ? ACCENT : isTrack ? ACCENT_B : "var(--text)";
  const path = `/${item.entity_type}/${item.entity_id}`;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "13px 0", borderBottom: "1px solid var(--border)",
    }}>
      {item.entity_image_url
        ? <img src={item.entity_image_url} alt={item.entity_name} style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
        : <div style={{ width: 48, height: 48, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link
          to={path}
          style={{ color: "var(--text)", fontWeight: 600, textDecoration: "none", fontSize: 14, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          onMouseEnter={(e) => e.currentTarget.style.color = accent}
          onMouseLeave={(e) => e.currentTarget.style.color = "var(--text)"}
        >
          {item.entity_name ?? `Unknown ${item.entity_type ?? "item"}`}
        </Link>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
          {item.entity_artists?.join(", ")}
          {item.entity_artists?.length > 0 && <span style={{ margin: "0 5px", opacity: 0.4 }}>·</span>}
          {timeAgo(item.created_at)}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>{right}</div>
    </div>
  );
}

// ── Settings popover (gear icon) ─────────────────────────────────────────────
// Lives here rather than in its own file because it's tiny and profile-specific.
// Click-away dismissal is handled by a transparent fixed backdrop.
function SettingsMenu({ open, onClose }) {
  if (!open) return null;
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 80 }}
      />
      <div style={{
        position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 81,
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, padding: 6, minWidth: 200,
        boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
      }}>
        <Link
          to="/import"
          onClick={onClose}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 6,
            color: "var(--text)", textDecoration: "none", fontSize: 13, fontWeight: 600,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Import ratings
        </Link>
        <Link
          to="/disliked-artists"
          onClick={onClose}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 6,
            color: "var(--text)", textDecoration: "none", fontSize: 13, fontWeight: 600,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18.364 5.636L5.636 18.364" />
            <circle cx="12" cy="12" r="9" />
          </svg>
          Disliked artists
        </Link>
        <Link
          to="/blocks"
          onClick={onClose}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 6,
            color: "var(--text)", textDecoration: "none", fontSize: 13, fontWeight: 600,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          Blocked users
        </Link>
        <button
          onClick={() => {
            // Fires the listener inside OnboardingModal to re-open it from
            // step 0. No reload, keeps the user's place on the profile page.
            window.dispatchEvent(new CustomEvent("contour:replay-onboarding"));
            onClose();
          }}
          style={{
            width: "100%", textAlign: "left",
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 6,
            background: "transparent", border: "none",
            color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Show tutorial again
        </button>
        <Link
          to="/methodology"
          onClick={onClose}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 6,
            color: "var(--text)", textDecoration: "none", fontSize: 13, fontWeight: 600,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          How it works
        </Link>
      </div>
    </>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────
export function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [profile, setProfile] = useState(null);
  const [artistDetails, setArtistDetails] = useState({});
  const [following, setFollowing] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [loading, setLoading] = useState(true);
  // Deep-link support: /profile?tab=backlog opens directly to the Backlog tab.
  const initialTab = searchParams.get("tab") || "ratings";
  const [tab, setTab] = useState(initialTab);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Keep ?tab= in sync with state so refresh / share preserves the selection.
  useEffect(() => {
    const current = searchParams.get("tab") || "ratings";
    if (current !== tab) {
      const next = new URLSearchParams(searchParams);
      if (tab === "ratings") next.delete("tab");
      else next.set("tab", tab);
      setSearchParams(next, { replace: true });
    }
  }, [tab]);

  const [editingBio, setEditingBio] = useState(false);
  const [bioInput, setBioInput] = useState("");
  const [savingBio, setSavingBio] = useState(false);

  const [editingPhoto, setEditingPhoto] = useState(false);
  const [photoInput, setPhotoInput] = useState("");
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const [badges, setBadges] = useState(null);
  const [lists, setLists] = useState([]);
  const [showCreateList, setShowCreateList] = useState(false);
  const [newListTitle, setNewListTitle] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [newListRanked, setNewListRanked] = useState(true);
  const [creatingList, setCreatingList] = useState(false);

  useEffect(() => {
    api.getBadges().then(setBadges).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) { navigate("/"); return; }
    Promise.all([
      api.getProfile(),
      api.getFollowing(user.id).catch(() => []),
      api.getFollowers(user.id).catch(() => []),
      api.getUserLists(user.id).catch(() => []),
    ])
      .then(([p, fwing, fwers, userLists]) => {
        setProfile(p);
        setFollowing(fwing);
        setFollowers(fwers);
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
      setProfile((p) => p ? { ...p, bio: bioInput } : p);
      setEditingBio(false);
    } finally {
      setSavingBio(false);
    }
  }

  async function handleSavePhoto() {
    const url = photoInput.trim();
    // Allow data URLs (from file upload) or https URLs or empty (reset to Google)
    if (url && !url.startsWith("https://") && !url.startsWith("http://") && !url.startsWith("data:")) {
      setPhotoError("URL must start with https://");
      return;
    }
    setSavingPhoto(true);
    setPhotoError("");
    try {
      await api.updateProfilePhoto(url);
      setProfile((p) => p ? { ...p, image_url: url || null } : p);
      setEditingPhoto(false);
    } catch (e) {
      setPhotoError(e.message ?? "Failed to save");
    } finally {
      setSavingPhoto(false);
    }
  }

  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Please select an image file.");
      return;
    }
    setPhotoError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        // Resize to max 256×256 to keep DB storage reasonable
        const MAX = 256;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setPhotoInput(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    // Reset the input so the same file can be re-selected
    e.target.value = "";
  }

  async function handleCreateList() {
    if (!newListTitle.trim()) return;
    setCreatingList(true);
    try {
      const created = await api.createList(newListTitle.trim(), newListDesc.trim() || null, newListRanked);
      analytics.listCreated();
      navigate(`/list/${created.id}`);
    } finally {
      setCreatingList(false);
    }
  }

  if (!user) return null;
  if (loading) return <div style={{ padding: 80, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Loading…</div>;

  const tabs = [
    { key: "ratings",   label: "Ratings",   count: profile?.ratings?.length ?? 0 },
    { key: "reviews",   label: "Reviews",   count: profile?.reviews?.length ?? 0 },
    { key: "lists",     label: "Lists",     count: lists.length },
    { key: "favorites", label: "Favorited", count: profile?.favorite_artists?.length ?? 0 },
    { key: "following", label: "Following", count: following.length },
    { key: "followers", label: "Followers", count: followers.length },
    // Backlog appended to the end per Task 9 placement rules.
    { key: "backlog",   label: "Backlog" },
  ];

  return (
    <div
      className="profile-root"
      style={{ maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column" }}
    >

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div style={{
        paddingTop: 36,
        background: `linear-gradient(180deg, ${ACCENT}14 0%, transparent 100%)`,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 22, padding: "0 28px 24px" }}>

          {/* Avatar */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <div style={{
              width: 96, height: 96, borderRadius: "50%",
              background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_B})`,
              padding: 2,
            }}>
              <img
                src={userAvatar(profile ?? user, 200)}
                alt={user.display_name}
                style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block", border: "3px solid var(--bg)" }}
              />
            </div>
            <button
              onClick={() => { setPhotoInput(profile?.image_url ?? ""); setEditingPhoto(true); setPhotoError(""); }}
              title="Change photo"
              style={{
                position: "absolute", bottom: 2, right: 2,
                width: 24, height: 24, borderRadius: "50%",
                background: "var(--surface)", border: "2px solid var(--bg)",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--text-muted)",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>

          {/* Name + bio + stats */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* flexWrap so on narrow viewports the settings/sign-out
                buttons drop below the name instead of squeezing the
                name into an unreadable width or producing horizontal
                page overflow. */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.025em", margin: 0, lineHeight: 1.1 }}>
                  {user.display_name}
                </h1>
                <BadgeChips badges={badges} userId={user?.id} size="md" />
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, position: "relative" }}>
                <button
                  onClick={() => setSettingsOpen((v) => !v)}
                  aria-label="Settings"
                  title="Settings"
                  style={{
                    width: 28, height: 28, color: "var(--text-muted)", background: "none",
                    border: "1px solid var(--border)", borderRadius: 6,
                    cursor: "pointer", display: "inline-flex",
                    alignItems: "center", justifyContent: "center",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
                <SettingsMenu open={settingsOpen} onClose={() => setSettingsOpen(false)} />
                <button
                  onClick={logout}
                  style={{
                    fontSize: 12, color: "var(--text-muted)", background: "none",
                    border: "1px solid var(--border)", borderRadius: 6,
                    cursor: "pointer", padding: "4px 12px",
                    letterSpacing: "0.01em",
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>

            {/* Bio */}
            {!editingBio && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 18 }}>
                <p style={{
                  fontSize: 13, color: profile?.bio ? "var(--text-muted)" : "var(--border)",
                  margin: 0, lineHeight: 1.65, maxWidth: 380,
                  fontStyle: profile?.bio ? "normal" : "italic",
                }}>
                  {profile?.bio || "No bio yet"}
                </p>
                <button
                  onClick={() => { setBioInput(profile?.bio ?? ""); setEditingBio(true); }}
                  title="Edit bio"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "2px 4px", opacity: 0.5, flexShrink: 0, marginTop: 1 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              </div>
            )}

            {editingBio && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18, maxWidth: 400 }}>
                <textarea
                  autoFocus
                  value={bioInput}
                  onChange={(e) => setBioInput(e.target.value.slice(0, 300))}
                  placeholder="Tell people about your taste…"
                  rows={3}
                  style={{
                    width: "100%", padding: "9px 11px", fontSize: 13,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    borderRadius: 8, color: "var(--text)", resize: "vertical",
                    outline: "none", boxSizing: "border-box", lineHeight: 1.6,
                    fontFamily: "inherit",
                  }}
                />
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={handleSaveBio} disabled={savingBio}
                    style={{
                      fontSize: 12, fontWeight: 700, padding: "5px 16px", borderRadius: 6,
                      background: ACCENT, border: "none", color: "#000", cursor: "pointer",
                    }}
                  >
                    {savingBio ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setEditingBio(false)}
                    style={{
                      fontSize: 12, color: "var(--text-muted)", background: "none",
                      border: "1px solid var(--border)", borderRadius: 6,
                      cursor: "pointer", padding: "5px 12px",
                    }}
                  >
                    Cancel
                  </button>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                    {bioInput.length}/300
                  </span>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Stat-style tab nav lives inside the hero — its built-in bottom
            border acts as the seamless separator between hero and content. */}
        <StatTabs tabs={tabs} active={tab} onChange={setTab} />
      </div>

      {/* Photo editor modal */}
      {editingPhoto && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={(e) => e.target === e.currentTarget && setEditingPhoto(false)}
        >
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "26px 24px", width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Change profile photo</h3>

            {/* Preview */}
            {photoInput.trim() && (
              <img
                src={photoInput.trim()}
                alt="Preview"
                onError={(e) => { e.currentTarget.style.display = "none"; setPhotoError("Could not load that URL."); }}
                style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", alignSelf: "center", border: "3px solid var(--border)" }}
              />
            )}

            {/* Upload from device */}
            <label style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "10px 16px", borderRadius: 8, border: "1px dashed var(--border)",
              cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--text-muted)",
              transition: "border-color 0.15s",
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Upload from device
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFileUpload}
              />
            </label>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>or paste a URL</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>

            {/* URL input */}
            <input
              value={photoInput.startsWith("data:") ? "" : photoInput}
              onChange={(e) => { setPhotoInput(e.target.value); setPhotoError(""); }}
              placeholder="https://i.imgur.com/…"
              style={{
                padding: "9px 12px", background: "var(--surface2)",
                border: `1px solid ${photoError ? "#f87171" : "var(--border)"}`,
                borderRadius: 8, color: "var(--text)", fontSize: 14, outline: "none",
                fontFamily: "inherit",
              }}
            />
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>
              Leave blank to reset to your Google photo.
            </p>

            {photoError && <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{photoError}</p>}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleSavePhoto} disabled={savingPhoto}
                style={{ padding: "8px 20px", borderRadius: 8, fontWeight: 700, fontSize: 13, background: ACCENT, border: "none", color: "#000", cursor: "pointer" }}
              >
                {savingPhoto ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setEditingPhoto(false); setPhotoInput(""); setPhotoError(""); }}
                style={{ padding: "8px 14px", borderRadius: 8, fontSize: 13, background: "none", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      {/* On mobile, CSS reorders the .profile-tab-content above the
          .profile-taste-section so tapping a tab shows the data right
          beneath it. Desktop keeps the original "Taste → tab content"
          order since the wider layout makes both visible at once. */}
      <div className="profile-body" style={{ padding: "28px 28px", display: "flex", flexDirection: "column", gap: 28 }}>

        {/* Taste */}
        <div className="profile-taste-section">
          <TasteSection userId={user.id} isOwner={true} />
        </div>

        <div className="profile-tab-content" style={{ display: "flex", flexDirection: "column", gap: 28 }}>

        {/* ── Ratings ── */}
        {tab === "ratings" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {!profile?.ratings?.length && (
              <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>No ratings yet.</p>
            )}
            {profile?.ratings?.map((r, i) => (
              <EntityRow key={i} item={r} right={<RatingBadge value={r.value} />} />
            ))}
          </div>
        )}

        {/* ── Reviews ── */}
        {tab === "reviews" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {!profile?.reviews?.length && (
              <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>No reviews yet.</p>
            )}
            {profile?.reviews?.map((r, i) => (
              <div key={i} style={{ padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
                <EntityRow item={r} right={r.value ? <RatingBadge value={r.value} /> : null} />
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65, margin: "8px 0 0 62px" }}>
                  {r.body}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ── Lists ── */}
        {tab === "lists" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {!showCreateList ? (
              <button
                onClick={() => { setShowCreateList(true); setNewListTitle(""); setNewListDesc(""); setNewListRanked(true); }}
                style={{
                  alignSelf: "flex-start", padding: "7px 18px", borderRadius: 6,
                  fontWeight: 700, fontSize: 13, letterSpacing: "0.01em",
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  color: "var(--text)", cursor: "pointer",
                }}
              >
                + New list
              </button>
            ) : (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  autoFocus
                  value={newListTitle}
                  onChange={(e) => setNewListTitle(e.target.value.slice(0, 200))}
                  placeholder="List title…"
                  style={{ padding: "9px 12px", background: "var(--surface2)", border: `1px solid ${ACCENT}50`, borderRadius: 8, color: "var(--text)", fontSize: 14, outline: "none", fontFamily: "inherit" }}
                />
                <textarea
                  value={newListDesc}
                  onChange={(e) => setNewListDesc(e.target.value.slice(0, 500))}
                  placeholder="Description (optional)…"
                  rows={2}
                  style={{ padding: "9px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit" }}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>
                  <input type="checkbox" checked={newListRanked} onChange={(e) => setNewListRanked(e.target.checked)} />
                  Ranked (numbered)
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleCreateList} disabled={creatingList || !newListTitle.trim()}
                    style={{ padding: "7px 18px", borderRadius: 6, fontWeight: 700, fontSize: 13, background: ACCENT, border: "none", color: "#000", cursor: "pointer", opacity: !newListTitle.trim() ? 0.45 : 1 }}
                  >
                    {creatingList ? "Creating…" : "Create"}
                  </button>
                  <button
                    onClick={() => setShowCreateList(false)}
                    style={{ padding: "7px 14px", borderRadius: 6, fontSize: 13, background: "none", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {lists.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "8px 0" }}>No lists yet.</p>
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
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, letterSpacing: "0.01em" }}>
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

        {/* ── Favorite artists ── */}
        {tab === "favorites" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
            {!profile?.favorite_artists?.length && (
              <p style={{ color: "var(--text-muted)", fontSize: 14, gridColumn: "1/-1", padding: "20px 0" }}>No favorite artists yet.</p>
            )}
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
                      : <div style={{ width: "100%", aspectRatio: "1", background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                          </svg>
                        </div>
                    }
                    <div style={{ padding: "10px 12px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a?.name ?? "Loading…"}
                      </div>
                      {a?.genres?.[0] && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, textTransform: "capitalize" }}>
                          {a.genres[0]}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* ── Following ── */}
        {tab === "following" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {!following.length && <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>Not following anyone yet.</p>}
            {following.map((u) => (
              <Link
                key={u.id}
                to={`/user/${u.id}`}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}
              >
                {u.image_url
                  ? <img src={u.image_url} alt={u.display_name} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
                }
                <span style={{ fontSize: 14, fontWeight: 600 }}>{u.display_name}</span>
              </Link>
            ))}
          </div>
        )}

        {/* ── Followers ── */}
        {tab === "followers" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {!followers.length && <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>No followers yet.</p>}
            {followers.map((u) => (
              <Link
                key={u.id}
                to={`/user/${u.id}`}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}
              >
                {u.image_url
                  ? <img src={u.image_url} alt={u.display_name} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
                }
                <span style={{ fontSize: 14, fontWeight: 600 }}>{u.display_name}</span>
              </Link>
            ))}
          </div>
        )}

        {/* ── Backlog ── */}
        {tab === "backlog" && (
          <BacklogTabContent userId={user.id} isOwner={true} showSuggestions={true} />
        )}

        </div>{/* /.profile-tab-content */}
      </div>
    </div>
  );
}
