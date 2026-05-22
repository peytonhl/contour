import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { TasteSection } from "../components/TasteSection.jsx";
import { StatTabs } from "../components/StatTabs.jsx";
import { userAvatar } from "../utils/userAvatar.js";
import { BadgeMark } from "../components/Badges.jsx";
import { BacklogTabContent } from "../components/BacklogTabContent.jsx";
import { MentionBody } from "../components/Mentions.jsx";
import { EmptyHint } from "../components/Skeleton.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { CardPreviewModal } from "../components/CardPreviewModal.jsx";
import { CompareTastePicker } from "../components/CompareTastePicker.jsx";
import { ACCENT_A as ACCENT, ACCENT_B, GOLD } from "../theme.js";

// Eligibility probe — runs once on profile load. The button is only
// rendered when the backend confirms a qualifying hot take exists; this
// avoids the dead-end interaction where the user taps and gets a quiet
// "no hot takes yet" message that's easy to miss. A network failure
// returns null (button stays hidden) — acceptable since the user can
// refresh.
async function probeHotTakeEligibility(userId) {
  const cardUrl = `${window.location.origin}/api/og/hot-take?user_id=${encodeURIComponent(userId)}`;
  try {
    const res = await fetch(cardUrl, { method: "HEAD" });
    return res.ok;
  } catch { return false; }
}

// ── Shared helpers ────────────────────────────────────────────────────────────
// The local `ActionableEmpty` lived here. It became <EmptyState> in
// components/EmptyState.jsx so notifications, followed feed, etc. could all
// share the look. Three call sites in this file use it (Ratings / Reviews /
// Following tabs).

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
      letterSpacing: "0.01em",
    }}>
      {value}★
    </div>
  );
}

// "Show all N" button rendered at the bottom of a capped tab list. Used
// by Ratings / Reviews / Lists / Following / Followers tabs so the
// TasteSection at the bottom of the page is reachable without scrolling
// past every item. Outlined-secondary style — same language as the
// page's Sign out / gear buttons.
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
        ? <img src={item.entity_image_url} alt={item.entity_name} loading="lazy" decoding="async" style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 }} />
        : <div style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", background: "var(--surface2)", flexShrink: 0 }} />
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

// ── Main page ─────────────────────────────────────────────────────────────────
export function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [profile, setProfile] = useState(null);
  const [following, setFollowing] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [loading, setLoading] = useState(true);
  // Deep-link support: /profile?tab=backlog opens directly to the Backlog tab.
  const initialTab = searchParams.get("tab") || "ratings";
  const [tab, setTab] = useState(initialTab);

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

  // Cap each tab's list at TAB_VISIBLE_LIMIT items by default so the
  // TasteSection at the bottom of the page is reachable without scrolling
  // past a 200-item ratings history. "Show all N" expands the current tab
  // in place. Resets on tab change so each tab starts collapsed again.
  const TAB_VISIBLE_LIMIT = 10;
  const [tabExpanded, setTabExpanded] = useState(false);
  useEffect(() => { setTabExpanded(false); }, [tab]);

  const [editingBio, setEditingBio] = useState(false);
  const [bioInput, setBioInput] = useState("");
  const [savingBio, setSavingBio] = useState(false);

  // Hot-take button only renders when the backend confirms eligibility
  // (qualifying rating exists). null = check pending, false = no qualifying
  // take, true = render the button. Probed once on profile load so taps go
  // straight to the modal without a per-tap roundtrip.
  const [hasHotTake, setHasHotTake] = useState(null);
  const [hotTakeModalOpen, setHotTakeModalOpen] = useState(false);
  const [comparePickerOpen, setComparePickerOpen] = useState(false);
  // Which of the user's own reviews is open in the card-share modal.
  // null = closed. Looked up against profile.reviews to build the modal props.
  const [shareReviewId, setShareReviewId] = useState(null);
  const shareReview = shareReviewId
    ? profile?.reviews?.find((r) => r.id === shareReviewId)
    : null;

  const [editingPhoto, setEditingPhoto] = useState(false);
  const [photoInput, setPhotoInput] = useState("");
  // Photo source toggle. Two paths to set a profile photo (upload a file
  // or paste a URL) used to render side-by-side, which let users
  // accidentally clobber an upload by typing in the URL field — feedback
  // was that they read as AND when they should be OR. Now a tab toggle
  // shows only one input at a time, and switching modes clears the
  // staged photoInput so committing to one path means abandoning the other.
  const [photoMode, setPhotoMode] = useState("upload");
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
        // /auth/profile returns user fields nested under a `user` key:
        //   {user: {id, display_name, image_url, bio}, ratings, reviews}
        // But the rest of this page reads (and the bio/photo edit handlers
        // patch) those fields at the top level (`profile.image_url`,
        // `profile.bio`). Spreading `p.user` over `p` lifts them so both
        // the initial render AND the in-place patches converge on the same
        // structure. Without this, userAvatar(profile) fell back to the
        // "?" placeholder until the user re-uploaded their photo
        // (which top-level-patched image_url back into place).
        setProfile({ ...p, ...p.user });
        setFollowing(fwing);
        setFollowers(fwers);
        setLists(userLists);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // Probe hot-take eligibility in parallel. Independent of the main
    // profile load so a slow / failing hot-take check doesn't block the
    // page render. Button only renders when this resolves to true.
    probeHotTakeEligibility(user.id).then(setHasHotTake);
  }, [user]);

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
              onClick={() => {
                const current = profile?.image_url ?? "";
                setPhotoInput(current);
                // Open the modal in whichever mode matches the existing
                // photo — data URL → upload tab, http(s) URL → URL tab.
                // Default to upload when there's no existing photo since
                // that's the more common path users take.
                setPhotoMode(current.startsWith("http") ? "url" : "upload");
                setEditingPhoto(true);
                setPhotoError("");
              }}
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
                  <BadgeMark badges={badges} userId={user?.id} size="md" />
                </h1>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, position: "relative" }}>
                {/* Gear icon → /settings. The old in-place popover was
                    replaced by a dedicated settings page so account /
                    preference / content / about live in one consolidated
                    surface rather than a 5-item dropdown. */}
                <Link
                  to="/settings"
                  aria-label="Settings"
                  title="Settings"
                  style={{
                    width: 28, height: 28, color: "var(--text-muted)", background: "none",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                    cursor: "pointer", display: "inline-flex",
                    alignItems: "center", justifyContent: "center",
                    textDecoration: "none",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </Link>
                <button
                  onClick={logout}
                  style={{
                    fontSize: 12, color: "var(--text-muted)", background: "none",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
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

            {/* Hot take share — only rendered when probeHotTakeEligibility
                confirms a qualifying take exists. Hiding the button when
                there's nothing to share avoids the dead-end interaction
                Peyton reported (tap → "nothing happened" because the
                "no hot takes yet" feedback was too subtle).
                Style matches the SavedComparison "Share card" CTA:
                solid accent, --radius-sm, black text. */}
            {!editingBio && (
              <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
                {hasHotTake === true && (
                  <button
                    onClick={() => setHotTakeModalOpen(true)}
                    title="Share the rating where you diverge most from the community"
                    style={{
                      padding: "8px 16px",
                      background: ACCENT,
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      color: "#000",
                      fontSize: 13, fontWeight: 700,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Share my hot take
                  </button>
                )}
                <button
                  onClick={() => setComparePickerOpen(true)}
                  title="Compare your taste with another user"
                  style={{
                    padding: "8px 16px",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text)",
                    fontSize: 13, fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Compare with a friend
                </button>
              </div>
            )}
            {user && (
              <CardPreviewModal
                open={hotTakeModalOpen}
                onClose={() => setHotTakeModalOpen(false)}
                cardUrl={`${window.location.origin}/api/og/hot-take?user_id=${encodeURIComponent(user.id)}`}
                shareUrl={`${window.location.origin}/user/${user.id}`}
                shareText={`${user.display_name}'s hot take on Contour`}
                fileName={`contour-hot-take-${user.id}.png`}
              />
            )}
            <CompareTastePicker
              open={comparePickerOpen}
              onClose={() => setComparePickerOpen(false)}
            />
            {/* Card-share modal for the user's own reviews. Same component
                used by ReviewSection / UserPage / SavedComparison — single
                source of truth for the preview-then-share UX. */}
            {shareReview && (
              <CardPreviewModal
                open={shareReviewId !== null}
                onClose={() => setShareReviewId(null)}
                cardUrl={`${window.location.origin}/api/og/review?id=${shareReview.id}`}
                shareUrl={`${window.location.origin}/${shareReview.entity_type}/${shareReview.entity_id}#review-${shareReview.id}`}
                shareText={`${user?.display_name ?? "A Contour user"}'s review on Contour`}
                fileName={`contour-review-${shareReview.id}.png`}
              />
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
                    borderRadius: "var(--radius-md)", color: "var(--text)", resize: "vertical",
                    outline: "none", boxSizing: "border-box", lineHeight: 1.6,
                    fontFamily: "inherit",
                  }}
                />
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={handleSaveBio} disabled={savingBio}
                    style={{
                      fontSize: 12, fontWeight: 700, padding: "5px 16px", borderRadius: "var(--radius-sm)",
                      background: ACCENT, border: "none", color: "#000", cursor: "pointer",
                    }}
                  >
                    {savingBio ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setEditingBio(false)}
                    style={{
                      fontSize: 12, color: "var(--text-muted)", background: "none",
                      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
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
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "26px 24px", width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Change profile photo</h3>

            {/* Preview — only when something is staged */}
            {photoInput.trim() && (
              <img
                src={photoInput.trim()}
                alt="Preview"
                onError={(e) => { e.currentTarget.style.display = "none"; setPhotoError("Could not load that image."); }}
                style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", alignSelf: "center", border: "3px solid var(--border)" }}
              />
            )}

            {/* Mode toggle: pick ONE path. Switching clears the staged photo
                so users can't accidentally combine an upload with a URL. */}
            <div style={{
              display: "flex", padding: 3,
              background: "var(--surface2)", borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
            }}>
              {[
                { key: "upload", label: "Upload" },
                { key: "url",    label: "Paste URL" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => {
                    if (key !== photoMode) {
                      setPhotoMode(key);
                      setPhotoInput("");
                      setPhotoError("");
                    }
                  }}
                  style={{
                    flex: 1, padding: "8px 14px", fontSize: 13,
                    fontWeight: photoMode === key ? 700 : 500,
                    background: photoMode === key ? ACCENT : "transparent",
                    color: photoMode === key ? "#000" : "var(--text-muted)",
                    border: "none", borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {photoMode === "upload" && (
              <label style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "14px 16px", borderRadius: "var(--radius-md)", border: "1px dashed var(--border)",
                cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--text-muted)",
                transition: "border-color 0.15s",
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                {photoInput.startsWith("data:") ? "Choose a different image" : "Upload from device"}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                />
              </label>
            )}

            {photoMode === "url" && (
              <input
                value={photoInput.startsWith("data:") ? "" : photoInput}
                onChange={(e) => { setPhotoInput(e.target.value); setPhotoError(""); }}
                placeholder="https://i.imgur.com/…"
                style={{
                  padding: "10px 12px", background: "var(--surface2)",
                  border: `1px solid ${photoError ? "#f87171" : "var(--border)"}`,
                  borderRadius: "var(--radius-md)", color: "var(--text)", fontSize: 14, outline: "none",
                  fontFamily: "inherit",
                }}
              />
            )}

            <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>
              Leave blank and save to reset to your Google photo.
            </p>

            {photoError && <p style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>{photoError}</p>}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleSavePhoto} disabled={savingPhoto}
                style={{ padding: "8px 20px", borderRadius: "var(--radius-md)", fontWeight: 700, fontSize: 13, background: ACCENT, border: "none", color: "#000", cursor: "pointer" }}
              >
                {savingPhoto ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => { setEditingPhoto(false); setPhotoInput(""); setPhotoError(""); setPhotoMode("upload"); }}
                style={{ padding: "8px 14px", borderRadius: "var(--radius-md)", fontSize: 13, background: "none", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      {/* CSS reorders .profile-tab-content above .profile-taste-section on
          every viewport (see index.css). The interaction model is "tap a
          StatTab, see its data right beneath" — having TasteSection in
          between pushes the active tab's content too far down to feel
          connected to the tap. Was mobile-only originally; extended to
          desktop after the same complaint surfaced there. */}
      <div className="profile-body" style={{ padding: "28px 28px", display: "flex", flexDirection: "column", gap: 28 }}>

        {/* Taste */}
        <div className="profile-taste-section">
          <TasteSection userId={user.id} isOwner={true} ratings={profile?.ratings ?? []} />
        </div>

        <div className="profile-tab-content" style={{ display: "flex", flexDirection: "column", gap: 28 }}>

        {/* ── Ratings ── */}
        {tab === "ratings" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {!profile?.ratings?.length && (
              <EmptyState
                description="No ratings yet."
                ctaLabel="Find something to rate"
                ctaTo="/"
              />
            )}
            {(tabExpanded ? profile?.ratings : profile?.ratings?.slice(0, TAB_VISIBLE_LIMIT))?.map((r, i) => (
              <EntityRow key={i} item={r} right={<RatingBadge value={r.value} />} />
            ))}
            {!tabExpanded && (profile?.ratings?.length ?? 0) > TAB_VISIBLE_LIMIT && (
              <ShowAllButton total={profile.ratings.length} onClick={() => setTabExpanded(true)} />
            )}
          </div>
        )}

        {/* ── Reviews ── */}
        {tab === "reviews" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {!profile?.reviews?.length && (
              <EmptyState
                description="No reviews yet."
                ctaLabel="Rate something to get started"
                ctaTo="/"
              />
            )}
            {/* Own-profile review rows. Mirrors UserPage's review row layout
                but skips vote buttons (no self-voting) and keeps Reply +
                Share so the user can act on their own reviews from here.
                Previously the row used EntityRow inside a wrapper that also
                drew its own borderBottom → doubled separator lines. Now the
                single borderBottom on the outer row is the only separator. */}
            {(tabExpanded ? profile?.reviews : profile?.reviews?.slice(0, TAB_VISIBLE_LIMIT))?.map((r) => {
              const threadPath = `/${r.entity_type}/${r.entity_id}#review-${r.id}`;
              return (
                // Outer wrapper was a <Link> but the body now embeds
                // mention <Link>s via <MentionBody>, and nesting <a>
                // inside <a> is an HTML5 violation that browsers handle
                // unpredictably. Converted to a <div onClick> — the row
                // is still fully clickable, the mention links inside
                // navigate independently (with stopPropagation inside
                // MentionBody to suppress the row's onClick on tap).
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
                    display: "flex", flexDirection: "column", gap: 10,
                    color: "inherit", cursor: "pointer",
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
                    {r.value && <RatingBadge value={r.value} />}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" }}>
                    <MentionBody body={r.body} mentions={r.mentions} />
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = threadPath; }}
                      title="Reply on the thread"
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        background: "none", border: "none", padding: "2px 4px",
                        fontSize: 12, cursor: "pointer", color: "var(--text-muted)",
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                      {(r.replies_count ?? r.reply_count ?? 0) > 0 ? (r.replies_count ?? r.reply_count) : ""}
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShareReviewId(r.id); }}
                      title="Share this review"
                      aria-label="Share this review"
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        background: "none", border: "none", padding: "2px 4px",
                        fontSize: 12, cursor: "pointer", color: "var(--text-muted)",
                      }}
                    >
                      ↗
                    </button>
                  </div>
                </div>
              );
            })}
            {!tabExpanded && (profile?.reviews?.length ?? 0) > TAB_VISIBLE_LIMIT && (
              <ShowAllButton total={profile.reviews.length} onClick={() => setTabExpanded(true)} />
            )}
          </div>
        )}

        {/* ── Lists ── */}
        {tab === "lists" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {!showCreateList ? (
              <button
                onClick={() => { setShowCreateList(true); setNewListTitle(""); setNewListDesc(""); setNewListRanked(true); }}
                style={{
                  alignSelf: "flex-start", padding: "7px 18px", borderRadius: "var(--radius-sm)",
                  fontWeight: 700, fontSize: 13, letterSpacing: "0.01em",
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  color: "var(--text)", cursor: "pointer",
                }}
              >
                + New list
              </button>
            ) : (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  autoFocus
                  value={newListTitle}
                  onChange={(e) => setNewListTitle(e.target.value.slice(0, 200))}
                  placeholder="List title…"
                  style={{ padding: "9px 12px", background: "var(--surface2)", border: `1px solid ${ACCENT}50`, borderRadius: "var(--radius-md)", color: "var(--text)", fontSize: 14, outline: "none", fontFamily: "inherit" }}
                />
                <textarea
                  value={newListDesc}
                  onChange={(e) => setNewListDesc(e.target.value.slice(0, 500))}
                  placeholder="Description (optional)…"
                  rows={2}
                  style={{ padding: "9px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text)", fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit" }}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>
                  <input type="checkbox" checked={newListRanked} onChange={(e) => setNewListRanked(e.target.checked)} />
                  Ranked (numbered)
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleCreateList} disabled={creatingList || !newListTitle.trim()}
                    style={{ padding: "7px 18px", borderRadius: "var(--radius-sm)", fontWeight: 700, fontSize: 13, background: ACCENT, border: "none", color: "#000", cursor: "pointer", opacity: !newListTitle.trim() ? 0.45 : 1 }}
                  >
                    {creatingList ? "Creating…" : "Create"}
                  </button>
                  <button
                    onClick={() => setShowCreateList(false)}
                    style={{ padding: "7px 14px", borderRadius: "var(--radius-sm)", fontSize: 13, background: "none", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {lists.length === 0 && <EmptyHint dense>No lists yet.</EmptyHint>}

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
            {!tabExpanded && lists.length > TAB_VISIBLE_LIMIT && (
              <ShowAllButton total={lists.length} onClick={() => setTabExpanded(true)} />
            )}
          </div>
        )}

        {/* ── Following ── */}
        {tab === "following" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {!following.length && (
              <EmptyState
                description="Not following anyone yet."
                ctaLabel="Find people to follow"
                ctaTo="/friends"
              />
            )}
            {(tabExpanded ? following : following.slice(0, TAB_VISIBLE_LIMIT)).map((u) => (
              <Link
                key={u.id}
                to={`/user/${u.id}`}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}
              >
                {u.image_url
                  ? <img src={u.image_url} alt={u.display_name} loading="lazy" decoding="async" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
                }
                <span style={{ fontSize: 14, fontWeight: 600 }}>{u.display_name}</span>
              </Link>
            ))}
            {!tabExpanded && following.length > TAB_VISIBLE_LIMIT && (
              <ShowAllButton total={following.length} onClick={() => setTabExpanded(true)} />
            )}
          </div>
        )}

        {/* ── Followers ── */}
        {tab === "followers" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {!followers.length && <EmptyHint>No followers yet.</EmptyHint>}
            {(tabExpanded ? followers : followers.slice(0, TAB_VISIBLE_LIMIT)).map((u) => (
              <Link
                key={u.id}
                to={`/user/${u.id}`}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}
              >
                {u.image_url
                  ? <img src={u.image_url} alt={u.display_name} loading="lazy" decoding="async" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
                }
                <span style={{ fontSize: 14, fontWeight: 600 }}>{u.display_name}</span>
              </Link>
            ))}
            {!tabExpanded && followers.length > TAB_VISIBLE_LIMIT && (
              <ShowAllButton total={followers.length} onClick={() => setTabExpanded(true)} />
            )}
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
