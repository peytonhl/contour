import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api.js";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";

function formatStreams(n) {
  if (!n && n !== 0) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B streams`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M streams`;
  return null;
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("albums"); // "albums" | "tracks" | "artists"
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();
  const debounceRef = useRef(null);

  function handleInput(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const fn = mode === "albums" ? api.searchAlbums : mode === "tracks" ? api.searchTracks : api.searchArtists;
        setResults(await fn(q));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  }

  function handleModeChange(newMode) {
    setMode(newMode);
    setResults([]);
    if (query.trim()) {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setSearching(true);
        try {
          const fn = newMode === "albums" ? api.searchAlbums : newMode === "tracks" ? api.searchTracks : api.searchArtists;
          setResults(await fn(query));
        } catch {
          setResults([]);
        } finally {
          setSearching(false);
        }
      }, 0);
    }
  }

  function handleSelect(item) {
    navigate(mode === "albums" ? `/album/${item.id}` : mode === "tracks" ? `/track/${item.id}` : `/artist/${item.id}`);
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "60px 24px 40px", display: "flex", flexDirection: "column", gap: 32, alignItems: "center" }}>

      {/* Hero text */}
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{
          fontSize: 36, fontWeight: 800, lineHeight: 1.15,
          background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          Explore Music
        </h1>
        <p style={{ fontSize: 15, color: "var(--text-muted)", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
          Search for an album, track, or artist to see stream trajectories, community ratings, and reviews.
        </p>
      </div>

      {/* Search box */}
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 0 }}>
        {/* Mode toggle + input */}
        <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: results.length > 0 ? "10px 10px 0 0" : 10, overflow: "hidden" }}>
          {/* Toggle */}
          <div style={{ display: "flex", borderRight: "1px solid var(--border)", flexShrink: 0 }}>
            {[["albums", "Albums"], ["tracks", "Tracks"], ["artists", "Artists"]].map(([val, lbl]) => (
              <button
                key={val}
                onClick={() => handleModeChange(val)}
                style={{
                  padding: "14px 16px", fontSize: 12, fontWeight: mode === val ? 700 : 400,
                  background: mode === val ? "var(--surface2)" : "transparent",
                  color: mode === val ? "var(--text)" : "var(--text-muted)",
                  border: "none", cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
          <input
            autoFocus
            value={query}
            onChange={handleInput}
            placeholder={mode === "albums" ? "Search albums…" : mode === "tracks" ? "Search tracks…" : "Search artists…"}
            style={{
              flex: 1, padding: "14px 16px", fontSize: 15,
              background: "transparent", border: "none", outline: "none",
              color: "var(--text)",
            }}
          />
          {searching && (
            <div style={{ display: "flex", alignItems: "center", paddingRight: 16, color: "var(--text-muted)", fontSize: 12 }}>
              …
            </div>
          )}
        </div>

        {/* Results dropdown */}
        {results.length > 0 && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
            {results.map((item, i) => (
              <button
                key={item.id}
                onClick={() => handleSelect(item)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 14,
                  padding: "10px 16px", background: "transparent", border: "none",
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  cursor: "pointer", textAlign: "left", color: "var(--text)",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                {item.image_url
                  ? <img src={item.image_url} alt={item.name} style={{ width: 40, height: 40, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 40, height: 40, borderRadius: 5, background: "var(--surface2)", flexShrink: 0 }} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {Array.isArray(item.artists) ? item.artists.join(", ") : item.artists}
                    {item.release_date && ` · ${item.release_date.slice(0, 4)}`}
                    {formatStreams(item.streams) && ` · ${formatStreams(item.streams)}`}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>→</span>
              </button>
            ))}
          </div>
        )}

        {query && !searching && results.length === 0 && (
          <div style={{ padding: "16px", background: "var(--surface)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 10px 10px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
            No results for "{query}"
          </div>
        )}
      </div>
    </div>
  );
}
