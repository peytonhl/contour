import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { GENRE_OPTIONS, GenreChip } from "./OnboardingModal.jsx";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";
const GOLD = "#f59e0b";

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
      borderRadius: 20,
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
          borderRadius: 12,
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
      style={{ position: "relative", aspectRatio: "1", borderRadius: 12, overflow: "hidden", cursor: "pointer" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link to={`/album/${album.id}`}>
        {album.image_url
          ? <img src={album.image_url} alt={album.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
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
              borderRadius: 20, color: "#fff",
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
        const res = await api.searchAlbums(val.trim());
        setResults(res);
      } catch {
        setSearchError("Search failed — check your connection and try again.");
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
          borderRadius: 20,
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
                  Choose up to 4 — {picks.length}/4 selected
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={onClose}
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
                    padding: "8px 20px", borderRadius: 20, fontSize: 13, fontWeight: 800,
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
                    borderRadius: 20, padding: "5px 10px 5px 6px",
                  }}>
                    {p.image_url && (
                      <img src={p.image_url} alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: "cover" }} />
                    )}
                    <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT_A, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <button onClick={() => toggle(p)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)", fontSize: 16, lineHeight: 1, flexShrink: 0 }}>×</button>
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
                  borderRadius: 12, color: "var(--text)", fontSize: 14,
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
              <div style={{ textAlign: "center", color: "#f87171", padding: "16px 24px", fontSize: 13 }}>
                {searchError}
              </div>
            )}
            {!searching && !searchError && query.length >= 2 && results.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "28px 0", fontSize: 13 }}>
                No albums found — try a different title or artist name
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
                    ? <img src={album.image_url} alt={album.name} style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover", flexShrink: 0, boxShadow: "0 2px 10px rgba(0,0,0,0.35)" }} />
                    : <div style={{ width: 60, height: 60, borderRadius: 8, background: "var(--surface2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🎵</div>
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
function GenreEditorSheet({ currentGenres, onSave, onClose }) {
  const [selected, setSelected] = useState(currentGenres ?? []);
  const [saving, setSaving] = useState(false);

  function toggle(slug) {
    setSelected((prev) =>
      prev.includes(slug) ? prev.filter((g) => g !== slug) : [...prev, slug]
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      localStorage.setItem("contour_genres_v1", JSON.stringify(selected));
      await api.saveTasteProfile(selected, [], true);
      onSave(selected);
      onClose();
    } catch {
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300 }} />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 301,
        padding: "0 16px calc(env(safe-area-inset-bottom, 16px) + 16px)",
      }}>
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "20px 20px 16px 16px", padding: "22px 22px 20px",
          maxWidth: 480, margin: "0 auto", boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
        }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border)", margin: "0 auto 20px" }} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Edit your genres</h3>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                {selected.length > 0 ? `${selected.length} selected` : "None selected — your feed will use defaults"}
              </p>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "7px 18px", borderRadius: 20, fontSize: 13, fontWeight: 800,
                background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                border: "none", color: "#000", cursor: "pointer", opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          <div style={{
            display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center",
            maxHeight: 260, overflowY: "auto", padding: "4px 0",
          }}>
            {GENRE_OPTIONS.map((g) => (
              <GenreChip key={g.slug} genre={g} selected={selected} onToggle={toggle} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Rating distribution bar chart ─────────────────────────────────────────────
function RatingDistribution({ distribution }) {
  const maxCount = Math.max(...Object.values(distribution), 1);
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);

  if (total === 0) return null;

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
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--surface2)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${pct}%`,
                borderRadius: 4,
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
      <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0", textAlign: "right" }}>
        {total} total rating{total !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

// ── Main exported component ───────────────────────────────────────────────────
export function TasteSection({ userId, isOwner }) {
  const [taste, setTaste] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [genreEditorOpen, setGenreEditorOpen] = useState(false);
  const [savedGenres, setSavedGenres] = useState(() => {
    try { return JSON.parse(localStorage.getItem("contour_genres_v1") || "[]"); } catch { return []; }
  });

  useEffect(() => {
    setLoading(true);
    api.getUserTaste(userId)
      .then(setTaste)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

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

  const hasAnyContent =
    (taste?.pinned_albums?.length > 0) ||
    (taste?.top_genres?.length > 0) ||
    (Object.values(taste?.rating_distribution ?? {}).some((v) => v > 0));

  if (!hasAnyContent && !isOwner) return null;

  const slots = [0, 1, 2, 3].map((i) => taste?.pinned_albums?.[i] ?? null);

  return (
    <>
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "20px 20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}>
        {/* Section header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Music Taste
          </h3>
          {isOwner && (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setGenreEditorOpen(true)}
                style={{
                  fontSize: 11, fontWeight: 700, color: ACCENT_B,
                  background: `${ACCENT_B}14`, border: `1px solid ${ACCENT_B}35`,
                  borderRadius: 20, padding: "4px 12px", cursor: "pointer",
                }}
              >
                {savedGenres.length > 0 ? `Genres (${savedGenres.length})` : "+ Add genres"}
              </button>
              <button
                onClick={() => setPickerOpen(true)}
                style={{
                  fontSize: 11, fontWeight: 700, color: ACCENT_A,
                  background: `${ACCENT_A}14`, border: `1px solid ${ACCENT_A}35`,
                  borderRadius: 20, padding: "4px 12px", cursor: "pointer",
                }}
              >
                {taste?.pinned_albums?.length ? "Edit albums" : "+ Pick albums"}
              </button>
            </div>
          )}
        </div>

        {/* 2×2 album grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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

        {/* Genre badges */}
        {taste?.top_genres?.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Favorite Genres
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {taste.top_genres.map((g) => <GenreBadge key={g} genre={g} />)}
            </div>
          </div>
        )}

        {/* Rating distribution */}
        {taste?.rating_distribution && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Rating Distribution
            </p>
            <RatingDistribution distribution={taste.rating_distribution} />
          </div>
        )}

        {/* Empty state nudge for owner with nothing yet */}
        {isOwner && !hasAnyContent && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
            Rate some music to build your taste profile — your genres and rating stats will appear here.
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
          onSave={(genres) => setSavedGenres(genres)}
          onClose={() => setGenreEditorOpen(false)}
        />
      )}
    </>
  );
}
