import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";

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
          : <div style={{ width: "100%", height: "100%", background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🎵</div>
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
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleInput(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(timerRef.current);
    if (val.trim().length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.searchAlbums(val.trim());
        setResults(res);
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
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300 }}
      />

      {/* Modal */}
      <div style={{
        position: "fixed",
        bottom: 0, left: 0, right: 0,
        zIndex: 301,
        padding: "0 16px calc(env(safe-area-inset-bottom, 16px) + 16px)",
      }}>
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "20px 20px 16px 16px",
          maxWidth: 520,
          margin: "0 auto",
          overflow: "hidden",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
          maxHeight: "80dvh",
          display: "flex",
          flexDirection: "column",
        }}>
          {/* Header */}
          <div style={{ padding: "20px 20px 14px", flexShrink: 0 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border)", margin: "0 auto 18px" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Pick your top albums</h3>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                  Choose up to 4 albums that define your taste — {picks.length}/4 selected
                </p>
              </div>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "7px 18px", borderRadius: 20, fontSize: 13, fontWeight: 800,
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  border: "none", color: "#000", cursor: saving ? "default" : "pointer",
                  opacity: saving ? 0.7 : 1, flexShrink: 0,
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>

            {/* Selected pills */}
            {picks.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {picks.map((p) => (
                  <div key={p.id} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: `${ACCENT_A}18`, border: `1px solid ${ACCENT_A}40`,
                    borderRadius: 20, padding: "4px 10px 4px 6px",
                  }}>
                    {p.image_url && <img src={p.image_url} alt="" style={{ width: 20, height: 20, borderRadius: 3, objectFit: "cover" }} />}
                    <span style={{ fontSize: 11, fontWeight: 600, color: ACCENT_A, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <button onClick={() => toggle(p)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)", fontSize: 14, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Search input */}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleInput}
              placeholder="Search albums…"
              style={{
                width: "100%", padding: "10px 14px",
                background: "var(--surface2)", border: "1px solid var(--border)",
                borderRadius: 10, color: "var(--text)", fontSize: 14,
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Results */}
          <div style={{ overflowY: "auto", flex: 1, padding: "0 20px 20px" }}>
            {searching && <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 20, fontSize: 13 }}>Searching…</div>}
            {!searching && query.length >= 2 && results.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 20, fontSize: 13 }}>No results</div>
            )}
            {results.map((album) => {
              const isSelected = picks.some((p) => p.id === album.id);
              const isFull = picks.length >= 4 && !isSelected;
              return (
                <div
                  key={album.id}
                  onClick={() => !isFull && toggle(album)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 0", borderBottom: "1px solid var(--border)",
                    cursor: isFull ? "default" : "pointer",
                    opacity: isFull ? 0.4 : 1,
                  }}
                >
                  {album.image_url
                    ? <img src={album.image_url} alt={album.name} style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                    : <div style={{ width: 44, height: 44, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{album.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {album.artists?.join(", ")}
                      {album.release_date && ` · ${album.release_date.slice(0, 4)}`}
                    </div>
                  </div>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    border: `2px solid ${isSelected ? ACCENT_A : "var(--border)"}`,
                    background: isSelected ? ACCENT_A : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}>
                    {isSelected && <span style={{ fontSize: 12, color: "#000", fontWeight: 800 }}>✓</span>}
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

  useEffect(() => {
    setLoading(true);
    api.getUserTaste(userId)
      .then(setTaste)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  function handleSavePins(newAlbums) {
    setTaste((prev) => prev ? { ...prev, pinned_albums: newAlbums } : prev);
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Music Taste
          </h3>
          {isOwner && (
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
    </>
  );
}
