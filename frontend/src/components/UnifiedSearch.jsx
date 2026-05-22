import { useState, useRef, useEffect } from "react";
import { api } from "../services/api.js";
import { ACCENT_A as ACCENT_ALBUM, ACCENT_B as ACCENT_TRACK } from "../theme.js";

function formatDuration(ms) {
  if (!ms) return null;
  const m = Math.floor(ms / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${m}:${s}`;
}

const styles = {
  wrapper: { display: "flex", flexDirection: "column", gap: 6, position: "relative" },
  input: {
    width: "100%", padding: "10px 14px",
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)", color: "var(--text)", fontSize: 14,
    outline: "none", transition: "border-color 0.15s", boxSizing: "border-box",
  },
  dropdown: {
    position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: "var(--radius)", overflow: "hidden", zIndex: 100,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)", maxHeight: 380, overflowY: "auto",
  },
  item: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 12px", cursor: "pointer", transition: "background 0.1s",
  },
  sectionHeader: {
    padding: "6px 12px 4px",
    fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
    color: "var(--text-muted)", borderTop: "1px solid var(--border)",
  },
  selectedBadge: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "8px 10px", background: "var(--surface2)",
    border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
  },
  typePill: {
    fontFamily: "var(--font-display)", fontStyle: "italic",
    fontSize: 12, flexShrink: 0,
  },
};

export function UnifiedSearch({ label, accentColor, selected, onSelect }) {
  const [query, setQuery] = useState("");
  const [albums, setAlbums] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const currentQueryRef = useRef(""); // tracks the latest debounced query to discard stale responses
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
    if (!val.trim()) {
      currentQueryRef.current = "";
      setAlbums([]); setTracks([]); setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      currentQueryRef.current = val;
      setLoading(true);
      try {
        const results = await api.search(val).catch(() => ({ users: [], albums: [], tracks: [] }));
        if (currentQueryRef.current !== val) return;
        const a = (results.albums || []).slice(0, 8);
        const t = (results.tracks || []).slice(0, 5);
        setAlbums(a);
        setTracks(t);
        setOpen(a.length > 0 || t.length > 0);
      } finally {
        if (currentQueryRef.current === val) setLoading(false);
      }
    }, 300);
  }

  function handleSelect(item) {
    onSelect(item); // item has ._type = "album" | "track"
    setQuery("");
    setAlbums([]);
    setTracks([]);
    setOpen(false);
  }

  const hasResults = albums.length > 0 || tracks.length > 0;

  return (
    <div style={styles.wrapper} ref={wrapperRef}>
      <span style={{ fontSize: 13, fontWeight: 600, color: accentColor }}>
        {label}
      </span>

      {selected ? (
        // Selected state — show badge
        <div style={{ ...styles.selectedBadge, borderColor: accentColor + "66" }}>
          {selected.image_url
            ? <img src={selected.image_url} alt="" style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 }} />
            : <div style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", background: "var(--surface2)", flexShrink: 0 }} />
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: accentColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selected.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selected.artists?.join(", ")}
              {selected._type === "track" && selected.album_name ? ` · ${selected.album_name}` : ""}
            </div>
          </div>
          <span style={{
            ...styles.typePill,
            background: selected._type === "track" ? `${ACCENT_TRACK}20` : `${ACCENT_ALBUM}20`,
            color: selected._type === "track" ? ACCENT_TRACK : ACCENT_ALBUM,
            border: `1px solid ${selected._type === "track" ? ACCENT_TRACK : ACCENT_ALBUM}40`,
          }}>
            {selected._type}
          </span>
          <button
            onClick={() => onSelect(null)}
            aria-label="Clear selection"
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, lineHeight: 1, padding: "0 2px", cursor: "pointer", flexShrink: 0 }}
          >×</button>
        </div>
      ) : (
        // Search input + dropdown
        <div style={{ position: "relative" }}>
          <input
            style={{ ...styles.input, borderColor: open ? accentColor : "var(--border)" }}
            placeholder="Search albums or tracks…"
            value={query}
            onChange={handleChange}
            onFocus={() => hasResults && setOpen(true)}
          />
          {loading && (
            <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-muted)" }}>…</span>
          )}

          {open && hasResults && (
            <div style={styles.dropdown}>
              {/* Albums section */}
              {albums.length > 0 && (
                <>
                  <div style={{ ...styles.sectionHeader, borderTop: "none" }}>Albums</div>
                  {albums.map((album) => (
                    <div
                      key={album.id}
                      style={styles.item}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                      onMouseDown={() => handleSelect({ ...album, _type: "album" })}
                    >
                      {album.image_url
                        ? <img src={album.image_url} alt="" style={{ width: 40, height: 40, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 40, height: 40, borderRadius: "var(--radius-sm)", background: "var(--surface2)", flexShrink: 0 }} />
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{album.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {album.artists?.join(", ")} · {album.release_date?.slice(0, 4)}
                        </div>
                      </div>
                      <span style={{ ...styles.typePill, color: ACCENT_ALBUM }}>
                        album
                      </span>
                    </div>
                  ))}
                </>
              )}

              {/* Tracks section */}
              {tracks.length > 0 && (
                <>
                  <div style={styles.sectionHeader}>Tracks</div>
                  {tracks.map((track) => (
                    <div
                      key={track.id}
                      style={styles.item}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                      onMouseDown={() => handleSelect({ ...track, _type: "track" })}
                    >
                      {track.image_url
                        ? <img src={track.image_url} alt="" style={{ width: 40, height: 40, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 40, height: 40, borderRadius: "var(--radius-sm)", background: "var(--surface2)", flexShrink: 0 }} />
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {track.artists?.join(", ")} · {track.album_name}
                          {track.duration_ms ? ` · ${formatDuration(track.duration_ms)}` : ""}
                        </div>
                      </div>
                      <span style={{ ...styles.typePill, color: ACCENT_TRACK }}>
                        track
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
