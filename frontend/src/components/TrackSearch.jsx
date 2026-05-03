import { useState, useRef, useEffect } from "react";
import { api } from "../services/api.js";

function formatDuration(ms) {
  if (!ms) return null;
  const m = Math.floor(ms / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${m}:${s}`;
}

const styles = {
  wrapper: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" },
  inputRow: { position: "relative" },
  input: { width: "100%", padding: "10px 14px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 14, outline: "none", transition: "border-color 0.15s" },
  dropdown: { position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", zIndex: 100, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", maxHeight: 320, overflowY: "auto" },
  dropdownItem: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer", transition: "background 0.1s" },
  thumb: { width: 40, height: 40, borderRadius: 4, objectFit: "cover", flexShrink: 0, background: "var(--surface2)" },
  thumbPlaceholder: { width: 40, height: 40, borderRadius: 4, background: "var(--surface2)", flexShrink: 0 },
  itemText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  itemName: { fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  itemSub: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  selectedBadge: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, marginTop: 4 },
  badgeThumb: { width: 32, height: 32, borderRadius: 4, objectFit: "cover" },
  clearBtn: { marginLeft: "auto", background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, lineHeight: 1, padding: "0 2px", cursor: "pointer" },
};

export function TrackSearch({ label, accentColor, onSelect, selected }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.searchTracks(val);
        setResults(data);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  }

  function handleSelect(track) {
    onSelect(track);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div style={styles.wrapper} ref={wrapperRef}>
      <span style={{ ...styles.label, color: accentColor }}>{label}</span>

      {selected ? (
        <div style={{ ...styles.selectedBadge, borderColor: accentColor + "66" }}>
          {selected.image_url ? (
            <img src={selected.image_url} alt="" style={styles.badgeThumb} />
          ) : (
            <div style={{ ...styles.badgeThumb, background: "var(--surface2)" }} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: accentColor }}>{selected.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {selected.artists?.join(", ")} · {selected.album_name}
            </div>
          </div>
          <button style={styles.clearBtn} onClick={() => onSelect(null)} title="Clear">×</button>
        </div>
      ) : (
        <div style={styles.inputRow}>
          <input
            style={{ ...styles.input, borderColor: open ? accentColor : "var(--border)" }}
            placeholder="Search artist + song…"
            value={query}
            onChange={handleChange}
            onFocus={() => results.length > 0 && setOpen(true)}
          />
          {open && results.length > 0 && (
            <div style={styles.dropdown}>
              {results.map((track) => (
                <div
                  key={track.id}
                  style={styles.dropdownItem}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  onMouseDown={() => handleSelect(track)}
                >
                  {track.image_url ? (
                    <img src={track.image_url} alt="" style={styles.thumb} />
                  ) : (
                    <div style={styles.thumbPlaceholder} />
                  )}
                  <div style={styles.itemText}>
                    <span style={styles.itemName}>{track.name}</span>
                    <span style={styles.itemSub}>
                      {track.artists?.join(", ")} · {track.album_name} · {track.release_date?.slice(0, 4)}
                      {track.duration_ms ? ` · ${formatDuration(track.duration_ms)}` : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {loading && (
            <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-muted)" }}>…</span>
          )}
        </div>
      )}
    </div>
  );
}
