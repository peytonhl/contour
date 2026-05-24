import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { GENRE_OPTIONS_BASE, GENRE_OPTIONS_EXTENDED, GenreChip } from "./OnboardingModal.jsx";
import { ACCENT_A, ACCENT_B, GOLD } from "../theme.js";
import { imageThumb, imageMedium } from "../utils/imageVariants.js";

// Ghost action button paired with the "Music taste" section header. Lighter
// than the tinted pills used elsewhere on the page so it reads as a sub-
// action of the header, not a competing CTA.
const tasteActionBtn = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--text-muted)",
  background: "transparent",
  border: "none",
  padding: "8px 0",
  cursor: "pointer",
  transition: "color 160ms var(--ease)",
};

// ── Genre → color gradient ────────────────────────────────────────────────────
function genreGradient(genre) {
  const g = genre.toLowerCase();
  if (g.includes("hip") || g.includes("rap") || g.includes("trap") || g.includes("drill"))
    return ["#fb923c", "#f97316"];
  if (g.includes("r&b") || g.includes("soul") || g.includes("neo soul"))
    return ["#c084fc", "#a855f7"];
  if (g.includes("pop") && !g.includes("k-pop") && !g.includes("j-pop"))
    return ["#f472b6", "#ec4899"];
  if (g.includes("k-pop") || g.includes("kpop") || g.includes("j-pop"))
    return ["#f9a8d4", "#fb7185"];
  if (g.includes("indie") || g.includes("alternative") || g.includes("lo-fi") || g.includes("shoegaze"))
    return [ACCENT_A, "#7c3aed"];
  if (g.includes("rock") || g.includes("grunge") || g.includes("emo"))
    return ["#f87171", "#dc2626"];
  if (g.includes("metal") || g.includes("punk") || g.includes("hardcore"))
    return ["#9ca3af", "#4b5563"];
  if (g.includes("electr") || g.includes("edm") || g.includes("house") || g.includes("techno") || g.includes("ambient"))
    return ["#22d3ee", "#06b6d4"];
  if (g.includes("jazz") || g.includes("bossa") || g.includes("blues"))
    return ["#fcd34d", "#f59e0b"];
  if (g.includes("classical") || g.includes("orchestra") || g.includes("chamber") || g.includes("opera"))
    return ["#60a5fa", "#3b82f6"];
  if (g.includes("country") || g.includes("folk") || g.includes("bluegrass") || g.includes("americana"))
    return ["#4ade80", "#16a34a"];
  if (g.includes("latin") || g.includes("reggaeton") || g.includes("salsa") || g.includes("cumbia"))
    return ["#fb923c", "#fcd34d"];
  if (g.includes("reggae") || g.includes("dancehall"))
    return ["#4ade80", "#22c55e"];
  if (g.includes("funk") || g.includes("groove") || g.includes("disco"))
    return ["#f59e0b", "#fb923c"];
  return [ACCENT_A, ACCENT_B]; // default
}

function GenreBadge({ genre }) {
  const [from, to] = genreGradient(genre);
  return (
    <span style={{
      display: "inline-block",
      padding: "5px 13px",
      borderRadius: "var(--radius-xl)",
      fontSize: 12,
      fontWeight: 700,
      background: `linear-gradient(135deg, ${from}22, ${to}22)`,
      border: `1px solid ${from}55`,
      color: from,
      letterSpacing: "0.01em",
    }}>
      {genre}
    </span>
  );
}

// ── Album slot in the 2×2 grid ────────────────────────────────────────────────
function AlbumSlot({ album, isOwner, onClick, onRemove }) {
  const [hovered, setHovered] = useState(false);

  if (!album) {
    // Empty slot
    return (
      <div
        onClick={isOwner ? onClick : undefined}
        onMouseEnter={() => isOwner && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          aspectRatio: "1",
          borderRadius: "var(--radius-lg)",
          border: `2px dashed ${hovered ? ACCENT_A : "var(--border)"}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          cursor: isOwner ? "pointer" : "default",
          transition: "border-color 0.15s",
          background: hovered ? `${ACCENT_A}0a` : "transparent",
        }}
      >
        {isOwner && (
          <>
            <span style={{ fontSize: 24, color: hovered ? ACCENT_A : "var(--border)", transition: "color 0.15s" }}>+</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>Add album</span>
          </>
        )}
      </div>
    );
  }

  // Filled slot
  return (
    <div
      style={{ position: "relative", aspectRatio: "1", borderRadius: "var(--radius-lg)", overflow: "hidden", cursor: "pointer" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link to={`/album/${album.id}`}>
        {album.image_url
          ? <img src={album.image_url} alt={album.name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
        }
      </Link>
      {/* Hover overlay: album info + optional remove */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 50%)",
        opacity: hovered ? 1 : 0,
        transition: "opacity 0.18s",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        padding: "10px 10px 8px",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {album.name}
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {album.artists?.join(", ")}
        </div>
        {isOwner && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(album.id); }}
            style={{
              marginTop: 6, alignSelf: "flex-start",
              fontSize: 10, fontWeight: 700,
              background: "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "var(--radius-xl)", color: "#fff",
              padding: "3px 10px", cursor: "pointer",
            }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ── Album picker modal ────────────────────────────────────────────────────────
function AlbumPickerModal({ selected, onSave, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [picks, setPicks] = useState(selected); // array of album objects
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleInput(e) {
    const val = e.target.value;
    setQuery(val);
    setSearchError(null);
    clearTimeout(timerRef.current);
    if (val.trim().length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        // Dedicated album endpoint — DB-first, Spotify title-fallback, no
        // artist-resolution detour. The picker is album-only, so unified
        // /search would just throw away its users/tracks results anyway.
        const res = await api.searchAlbums(val.trim());
        setResults(res || []);
      } catch {
        setSearchError("Search failed. Check your connection and try again.");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  }

  function toggle(album) {
    setPicks((prev) => {
      const already = prev.some((p) => p.id === album.id);
      if (already) return prev.filter((p) => p.id !== album.id);
      if (prev.length >= 4) return prev; // max 4
      return [...prev, album];
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updatePinnedAlbums(picks.map((p) => p.id));
      onSave(picks);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300 }}
      />

      {/* Centered dialog */}
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 301,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 16px",
        pointerEvents: "none",
      }}>
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          width: "100%",
          maxWidth: 520,
          maxHeight: "85dvh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
          pointerEvents: "all",
          overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ padding: "22px 24px 18px", flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Pick your top albums</h3>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
                  Choose up to 4 · {picks.length}/4 selected
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  style={{
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    borderRadius: "50%", width: 32, height: 32,
                    cursor: "pointer", color: "var(--text-muted)",
                    fontSize: 18, lineHeight: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >×</button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: "8px 20px", borderRadius: "var(--radius-xl)", fontSize: 13, fontWeight: 800,
                    background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                    border: "none", color: "#000", cursor: saving ? "default" : "pointer",
                    opacity: saving ? 0.7 : 1, flexShrink: 0,
                  }}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            {/* Selected pills */}
            {picks.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                {picks.map((p) => (
                  <div key={p.id} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: `${ACCENT_A}18`, border: `1px solid ${ACCENT_A}40`,
                    borderRadius: "var(--radius-xl)", padding: "5px 10px 5px 6px",
                  }}>
                    {p.image_url && (
                      <img src={imageThumb(p.image_url)} alt="" loading="lazy" decoding="async" style={{ width: 22, height: 22, borderRadius: "var(--radius-sm)", objectFit: "cover" }} />
                    )}
                    <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT_A, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <button onClick={() => toggle(p)} aria-label="Remove pinned album" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)", fontSize: 16, lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Search input */}
            <div style={{ position: "relative" }}>
              <svg style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={handleInput}
                placeholder="Search for an album…"
                style={{
                  width: "100%", padding: "11px 14px 11px 38px",
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)", color: "var(--text)", fontSize: 14,
                  outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          {/* Results */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {searching && (
              <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "28px 0", fontSize: 13 }}>
                Searching…
              </div>
            )}
            {searchError && (
              <div style={{ textAlign: "center", color: "var(--danger)", padding: "16px 24px", fontSize: 13 }}>
                {searchError}
              </div>
            )}
            {!searching && !searchError && query.length >= 2 && results.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "28px 0", fontSize: 13 }}>
                No albums found. Try a different title or artist name.
              </div>
            )}
            {!searching && results.length === 0 && query.length < 2 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "40px 24px", color: "var(--text-muted)" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <p style={{ margin: 0, fontSize: 13, textAlign: "center", lineHeight: 1.5, maxWidth: 260 }}>
                  Search Spotify's full catalog by album title or artist name
                </p>
              </div>
            )}
            {results.map((album) => {
              const isSelected = picks.some((p) => p.id === album.id);
              const isFull = picks.length >= 4 && !isSelected;
              return (
                <div
                  key={album.id}
                  onClick={() => !isFull && toggle(album)}
                  style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "12px 24px",
                    cursor: isFull ? "default" : "pointer",
                    opacity: isFull ? 0.35 : 1,
                    background: isSelected ? `${ACCENT_A}12` : "transparent",
                    borderLeft: `3px solid ${isSelected ? ACCENT_A : "transparent"}`,
                    transition: "background 0.12s, border-color 0.12s",
                  }}
                >
                  {album.image_url
                    ? <img src={imageMedium(album.image_url)} alt={album.name} loading="lazy" decoding="async" style={{ width: 60, height: 60, borderRadius: "var(--radius-md)", objectFit: "cover", flexShrink: 0, boxShadow: "0 2px 10px rgba(0,0,0,0.35)" }} />
                    : <div style={{ width: 60, height: 60, borderRadius: "var(--radius-md)", background: "var(--surface2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)" }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                          <circle cx="12" cy="12" r="9" />
                          <circle cx="12" cy="12" r="2.5" />
                        </svg>
                      </div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{album.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                      {album.artists?.join(", ")}
                      {album.release_date && <span style={{ marginLeft: 6, opacity: 0.7 }}>· {album.release_date.slice(0, 4)}</span>}
                    </div>
                  </div>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                    border: `2px solid ${isSelected ? ACCENT_A : "var(--border)"}`,
                    background: isSelected ? ACCENT_A : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}>
                    {isSelected && <span style={{ fontSize: 13, color: "#000", fontWeight: 900 }}>✓</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Genre editor sheet ────────────────────────────────────────────────────────
//
// Two interactive controls:
//   - Tri-state chips: tap cycles neutral → liked (orange border) → excluded
//     (red strike-through). Excluded genres are sent to /taste/profile as
//     `excluded_genres` and hard-removed from the discover feed's tier 1
//     candidate pool, so they never spend a Spotify search slot.
//   - "View more" button reveals the extended genre list (~40 sub-genres)
//     below the base 18. Auto-expands when the user already has any extended
//     genre selected/excluded so they can see what's set.
//
// Cross-list invariant: a slug is never in both `selected` and `excluded`
// at the same time. The tri-state cycle in GenreChip already enforces this
// at the click level; the handlers below mirror it server-side by stripping
// the slug from the other list on every flip.
function GenreEditorSheet({ currentGenres, currentExcluded, onSave, onClose }) {
  const [selected, setSelected] = useState(currentGenres ?? []);
  const [excluded, setExcluded] = useState(currentExcluded ?? []);
  const [saving, setSaving] = useState(false);
  // Auto-expand if the user has any extended-list activity to display.
  const extendedSlugs = GENRE_OPTIONS_EXTENDED.map((g) => g.slug);
  const hasExtendedActivity =
    selected.some((s) => extendedSlugs.includes(s)) ||
    excluded.some((s) => extendedSlugs.includes(s));
  const [showExtended, setShowExtended] = useState(hasExtendedActivity);

  function toggleLike(slug) {
    setSelected((prev) => prev.includes(slug) ? prev.filter((g) => g !== slug) : [...prev, slug]);
    setExcluded((prev) => prev.filter((g) => g !== slug));
  }

  function toggleExclude(slug) {
    setExcluded((prev) => prev.includes(slug) ? prev.filter((g) => g !== slug) : [...prev, slug]);
    setSelected((prev) => prev.filter((g) => g !== slug));
  }

  async function handleSave() {
    setSaving(true);
    try {
      localStorage.setItem("contour_genres_v1", JSON.stringify(selected));
      localStorage.setItem("contour_excluded_genres_v1", JSON.stringify(excluded));
      await api.saveTasteProfile(selected, [], true, excluded);
      onSave(selected, excluded);
      onClose();
    } catch {
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const summary =
    selected.length === 0 && excluded.length === 0
      ? "Tap once to like · tap again to exclude"
      : `${selected.length} liked${excluded.length ? ` · ${excluded.length} excluded` : ""}`;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300,
          // touchAction: none on the backdrop so a swipe over the dim area
          // doesn't bleed into ProfilePage scroll on iOS. (The sheet itself
          // sets touch-action via overscroll-behavior below.)
          touchAction: "none",
        }}
      />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 301,
        padding: "0 16px calc(env(safe-area-inset-bottom, 16px) + 16px)",
        // The wrapper can't itself be the scroll container (padding + safe-
        // area math), so we cap its height instead and let the SHEET inside
        // own the scroll. Without this cap the sheet could grow taller than
        // the viewport and the touchmove that started "inside" the sheet
        // would land on the page behind it because the sheet had no
        // overflow handler.
        maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - 24px)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
      }}>
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "20px 20px 16px 16px", padding: "22px 22px 20px",
          maxWidth: 480, margin: "0 auto", boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
          // Make the sheet itself the scroll container. Combined with
          // overscroll-behavior: contain, iOS recognizes the gesture as
          // sheet-internal and stops chaining scroll to ProfilePage when
          // the user reaches the top/bottom of the chips list. Previously
          // the OUTER chips container had maxHeight + overflowY, which is
          // flaky on iOS WebKit when nested inside a sheet that itself
          // overflows the viewport — the gesture would land on the wrong
          // target and scroll the page behind. Removing the inner cap
          // collapses to a single scroll region.
          maxHeight: "100%",
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
        }}>
          <div style={{ width: 36, height: 4, borderRadius: "var(--radius-sm)", background: "var(--border)", margin: "0 auto 20px" }} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Edit your genres</h3>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                {summary}
              </p>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "7px 18px", borderRadius: "var(--radius-xl)", fontSize: 13, fontWeight: 800,
                background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                border: "none", color: "#000", cursor: "pointer", opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          <div style={{
            display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center",
            padding: "4px 0",
            // No internal scroll — the parent sheet owns the scroll
            // container so iOS sees ONE consistent touch target on swipe.
            // The previous maxHeight: 360 + overflowY: auto created a
            // nested scrolling region that confused iOS WebKit's gesture
            // routing, causing the page behind the sheet to scroll
            // instead of the chips.
          }}>
            {GENRE_OPTIONS_BASE.map((g) => (
              <GenreChip
                key={g.slug} genre={g}
                selected={selected} onToggle={toggleLike}
                excluded={excluded} onExclude={toggleExclude}
              />
            ))}

            {showExtended && (
              <>
                {/* Soft divider between base and extended. Full row via 100% width
                    + flex-basis trick so flex-wrap puts it on its own line. */}
                <div style={{
                  flexBasis: "100%", height: 1, background: "var(--border)",
                  margin: "10px 6px 4px",
                }} />
                {GENRE_OPTIONS_EXTENDED.map((g) => (
                  <GenreChip
                    key={g.slug} genre={g}
                    selected={selected} onToggle={toggleLike}
                    excluded={excluded} onExclude={toggleExclude}
                  />
                ))}
              </>
            )}
          </div>

          {!showExtended && (
            <button
              onClick={() => setShowExtended(true)}
              style={{
                marginTop: 12, width: "100%", padding: "10px 0",
                background: "transparent", border: "1px solid var(--border)",
                borderRadius: "var(--radius-xl)", color: "var(--text-muted)",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                letterSpacing: "0.02em",
              }}
            >
              View more genres ({GENRE_OPTIONS_EXTENDED.length})
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Rating distribution bar chart ─────────────────────────────────────────────
function RatingDistribution({ distribution, average }) {
  const maxCount = Math.max(...Object.values(distribution), 1);
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);

  if (total === 0) return null;

  // Format the backend-computed average. Backend uses raw r.value so this
  // preserves half-stars (e.g. 3.7) rather than re-binning to integers
  // from the distribution dict. Falls back to a distribution-derived
  // estimate if the server-side field isn't available (older payloads).
  const avgValue = typeof average === "number"
    ? average
    : Object.entries(distribution).reduce((sum, [star, count]) => sum + Number(star) * count, 0) / total;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {[5, 4, 3, 2, 1].map((star) => {
        const count = distribution[star] ?? 0;
        const pct = (count / maxCount) * 100;
        return (
          <div key={star} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: GOLD, width: 20, textAlign: "right", flexShrink: 0 }}>
              {star}★
            </span>
            <div style={{ flex: 1, height: 8, borderRadius: "var(--radius-sm)", background: "var(--surface2)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${pct}%`,
                borderRadius: "var(--radius-sm)",
                background: star >= 4
                  ? `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`
                  : star === 3
                  ? `linear-gradient(90deg, ${GOLD}, #fb923c)`
                  : "var(--border)",
                transition: "width 0.5s ease",
              }} />
            </div>
            <span style={{ fontSize: 11, color: "var(--text-muted)", width: 22, textAlign: "right", flexShrink: 0 }}>{count}</span>
          </div>
        );
      })}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        fontSize: 11, color: "var(--text-muted)", marginTop: 4,
      }}>
        <span>
          Avg <span style={{ color: GOLD, fontWeight: 700 }}>{avgValue.toFixed(1)}★</span>
        </span>
        <span>
          {total} total rating{total !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

// ── Main exported component ───────────────────────────────────────────────────
/**
 * `ratings` is an optional list of the user's ratings, already enriched
 * with entity name + image + artists + value. Both ProfilePage and
 * UserPage fetch this for their RATINGS tab anyway; passing it down
 * lets us surface a "TOP RATED" preview without a duplicate fetch.
 * The viewer-friendly visual: actual music a user liked, with
 * cover art — much richer than abstract genre badges alone.
 */
export function TasteSection({ userId, isOwner, ratings = [] }) {
  const [taste, setTaste] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [genreEditorOpen, setGenreEditorOpen] = useState(false);
  const [savedGenres, setSavedGenres] = useState(() => {
    try { return JSON.parse(localStorage.getItem("contour_genres_v1") || "[]"); } catch { return []; }
  });
  // Mirror localStorage on mount for instant render, then reconcile with the
  // server-side value below — same pattern as savedGenres. Profile owners
  // only; the server is the source of truth for the discover feed.
  const [excludedGenres, setExcludedGenres] = useState(() => {
    try { return JSON.parse(localStorage.getItem("contour_excluded_genres_v1") || "[]"); } catch { return []; }
  });

  useEffect(() => {
    setLoading(true);
    api.getUserTaste(userId)
      .then(setTaste)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  // Pull the authoritative excluded_genres from the server on mount when the
  // owner is viewing their own profile. /users/{id}/taste is public and may
  // not include this private field, so we read it from /taste/profile (auth-
  // required) separately. Failure is silent — localStorage value is good
  // enough to render the picker until the user saves.
  useEffect(() => {
    if (!isOwner) return;
    api.getMyTasteProfile()
      .then((p) => {
        if (Array.isArray(p?.excluded_genres)) {
          setExcludedGenres(p.excluded_genres);
          try { localStorage.setItem("contour_excluded_genres_v1", JSON.stringify(p.excluded_genres)); } catch {}
        }
        if (Array.isArray(p?.genres) && p.genres.length > 0) {
          setSavedGenres(p.genres);
        }
      })
      .catch(() => {});
  }, [isOwner]);

  async function handleSavePins(newAlbums) {
    setTaste((prev) => prev ? { ...prev, pinned_albums: newAlbums } : prev);
    // Extract unique artist IDs from pinned albums and merge into taste profile
    // so the For You feed's personalization tiers use these artists.
    const artistIds = [...new Set(newAlbums.flatMap((a) => a.artist_ids ?? []))];
    if (artistIds.length > 0) {
      try {
        // Pass empty genres so the backend only merges artist IDs, leaves genres untouched
        await api.saveTasteProfile([], artistIds, false);
      } catch {
        // Best-effort — don't surface taste profile errors to the user
      }
    }
  }

  function handleRemove(albumId) {
    const updated = (taste?.pinned_albums ?? []).filter((a) => a.id !== albumId);
    api.updatePinnedAlbums(updated.map((a) => a.id)).then(() => {
      setTaste((prev) => prev ? { ...prev, pinned_albums: updated } : prev);
    });
  }

  if (loading) return null; // load silently, don't block the page

  // Derive the top 4 highest-rated entities from the user's ratings.
  // Sort: value DESC, then created_at DESC as a tiebreak (more recent
  // wins ties — surfaces evolving taste over old favorites). Skip
  // entities without a name (failed enrichment — empty card looks
  // broken). The cap at 4 mirrors the pinned-albums grid for visual
  // consistency. Visible to BOTH the owner and viewers; serves as a
  // "what they actually like" auto-derived snapshot, distinct from
  // pinned albums (which are user-curated).
  const topRated = [...(ratings ?? [])]
    .filter((r) => r.entity_name)
    .sort((a, b) => {
      const dv = (b.value ?? 0) - (a.value ?? 0);
      if (dv !== 0) return dv;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    })
    .slice(0, 4);

  const hasAnyContent =
    (taste?.pinned_albums?.length > 0) ||
    (taste?.top_genres?.length > 0) ||
    (Object.values(taste?.rating_distribution ?? {}).some((v) => v > 0)) ||
    topRated.length > 0;

  if (!hasAnyContent && !isOwner) return null;

  const slots = [0, 1, 2, 3].map((i) => taste?.pinned_albums?.[i] ?? null);

  return (
    <>
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "20px 20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}>
        {/* Section header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, color: "var(--text)" }}>
            Music taste
          </h3>
          {isOwner && (
            <div style={{ display: "flex", gap: 18 }}>
              <button
                onClick={() => setGenreEditorOpen(true)}
                style={tasteActionBtn}
                onMouseEnter={(e) => e.currentTarget.style.color = "var(--text)"}
                onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-muted)"}
              >
                {savedGenres.length > 0 || excludedGenres.length > 0
                  ? `Edit genres · ${savedGenres.length}${excludedGenres.length ? ` · −${excludedGenres.length}` : ""}`
                  : "Add genres"}
              </button>
              <button
                onClick={() => setPickerOpen(true)}
                style={tasteActionBtn}
                onMouseEnter={(e) => e.currentTarget.style.color = "var(--text)"}
                onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-muted)"}
              >
                {taste?.pinned_albums?.length ? `Edit albums · ${taste.pinned_albums.length}` : "Pick albums"}
              </button>
            </div>
          )}
        </div>

        {/* Album grid — only rendered when at least one album is pinned */}
        {taste?.pinned_albums?.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {slots.map((album, i) => (
              <AlbumSlot
                key={album?.id ?? `empty-${i}`}
                album={album}
                isOwner={isOwner}
                onClick={() => setPickerOpen(true)}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}

        {/* Empty album prompt — compact, shown only to owner when no albums pinned */}
        {isOwner && !taste?.pinned_albums?.length && (
          <button
            onClick={() => setPickerOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "14px 16px", borderRadius: "var(--radius)",
              border: "1px dashed var(--border)",
              background: "transparent", cursor: "pointer",
              textAlign: "left", width: "100%",
              transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT_A; e.currentTarget.style.background = `${ACCENT_A}08`; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: "var(--radius-md)", flexShrink: 0,
              border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Pin your top albums</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Choose up to 4 albums that define your taste</div>
            </div>
          </button>
        )}

        {/* Top rated — auto-derived from the user's highest ratings.
            Distinct from the curated pinned albums above: this row
            answers "what do they actually like" with cover art a
            visitor can recognize. 2×2 grid mirrors the pinned slots
            so the section feels balanced when both are present. */}
        {topRated.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>
              Top rated
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {topRated.map((r) => (
                <Link
                  key={`${r.entity_type}-${r.entity_id}`}
                  to={`/${r.entity_type}/${r.entity_id}`}
                  style={{
                    display: "flex", gap: 10, padding: 8,
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    textDecoration: "none", color: "inherit",
                    alignItems: "center",
                    minWidth: 0,
                  }}
                >
                  {r.entity_image_url
                    ? <img
                        src={imageMedium(r.entity_image_url)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
                      />
                    : <div style={{ width: 44, height: 44, borderRadius: 6, background: "var(--surface)", flexShrink: 0 }} />
                  }
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 2, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.entity_name}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: GOLD, fontWeight: 700 }}>
                      <span>{r.value?.toFixed?.(1) ?? r.value}</span>
                      <span>★</span>
                      {r.entity_artists?.[0] && (
                        <span style={{ color: "var(--text-muted)", fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                          · {r.entity_artists[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Genre badges */}
        {taste?.top_genres?.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>
              Favorite genres
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {taste.top_genres.map((g) => <GenreBadge key={g} genre={g} />)}
            </div>
          </div>
        )}

        {/* Rating distribution */}
        {taste?.rating_distribution && Object.values(taste.rating_distribution).some((v) => v > 0) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>
              Rating distribution
            </p>
            <RatingDistribution distribution={taste.rating_distribution} average={taste.average_rating} />
          </div>
        )}

        {/* Empty state — owner has no content at all */}
        {isOwner && !hasAnyContent && (
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Rate music to build your taste profile. Your genres and rating history will appear here.
          </p>
        )}
      </div>

      {pickerOpen && (
        <AlbumPickerModal
          selected={taste?.pinned_albums ?? []}
          onSave={handleSavePins}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {genreEditorOpen && (
        <GenreEditorSheet
          currentGenres={savedGenres}
          currentExcluded={excludedGenres}
          onSave={(genres, exc) => {
            setSavedGenres(genres);
            setExcludedGenres(exc);
          }}
          onClose={() => setGenreEditorOpen(false)}
        />
      )}
    </>
  );
}
