import { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../services/api.js";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";
const ACCENT_C = "#fb923c";

function formatStreams(n) {
  if (!n && n !== 0) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B streams`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M streams`;
  return null;
}

const TYPE_LABELS = { album: "Album", track: "Track", artist: "Artist" };
const TYPE_COLORS = { album: ACCENT_A, track: ACCENT_B, artist: ACCENT_C };

function FeaturedCard({ item, type }) {
  const navigate = useNavigate();
  const path = type === "album" ? `/album/${item.id}` : `/track/${item.id}`;
  return (
    <button
      onClick={() => navigate(path)}
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, overflow: "hidden", cursor: "pointer",
        textAlign: "left", transition: "border-color 0.15s, transform 0.15s",
        display: "flex", flexDirection: "column",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = TYPE_COLORS[type]; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = "none"; }}
    >
      {item.image_url
        ? <img src={item.image_url} alt={item.name} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
        : <div style={{ width: "100%", aspectRatio: "1", background: "var(--surface2)" }} />
      }
      <div style={{ padding: "10px 12px", flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>
          {item.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {Array.isArray(item.artists) ? item.artists.join(", ") : item.artists}
        </div>
      </div>
    </button>
  );
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [featured, setFeatured] = useState(null);
  const navigate = useNavigate();
  const debounceRef = useRef(null);

  useEffect(() => {
    api.getFeatured().then(setFeatured).catch(() => {});
  }, []);

  function handleInput(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const [albums, tracks, artists] = await Promise.all([
          api.searchAlbums(q).catch(() => []),
          api.searchTracks(q).catch(() => []),
          api.searchArtists(q).catch(() => []),
        ]);
        const tagged = [
          ...albums.slice(0, 4).map(r => ({ ...r, _type: "album" })),
          ...tracks.slice(0, 4).map(r => ({ ...r, _type: "track" })),
          ...artists.slice(0, 3).map(r => ({ ...r, _type: "artist" })),
        ];
        setResults(tagged);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  }

  function handleSelect(item) {
    if (item._type === "album") navigate(`/album/${item.id}`);
    else if (item._type === "track") navigate(`/track/${item.id}`);
    else navigate(`/artist/${item.id}`);
  }

  const hasResults = results.length > 0;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "60px 24px 40px", display: "flex", flexDirection: "column", gap: 40, alignItems: "center" }}>

      {/* Hero */}
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
      <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{
          display: "flex", background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: hasResults ? "10px 10px 0 0" : 10, overflow: "hidden",
        }}>
          <input
            autoFocus
            value={query}
            onChange={handleInput}
            placeholder="Search albums, tracks, artists…"
            style={{
              flex: 1, padding: "16px 20px", fontSize: 15,
              background: "transparent", border: "none", outline: "none",
              color: "var(--text)",
            }}
          />
          {searching && (
            <div style={{ display: "flex", alignItems: "center", paddingRight: 16, color: "var(--text-muted)", fontSize: 12 }}>…</div>
          )}
        </div>

        {hasResults && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
            {results.map((item, i) => (
              <button
                key={`${item._type}-${item.id}`}
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
                  ? <img src={item.image_url} alt={item.name} style={{ width: 40, height: 40, borderRadius: item._type === "artist" ? "50%" : 5, objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 40, height: 40, borderRadius: item._type === "artist" ? "50%" : 5, background: "var(--surface2)", flexShrink: 0 }} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {Array.isArray(item.artists) ? item.artists.join(", ") : item.artists}
                    {item.release_date && ` · ${item.release_date.slice(0, 4)}`}
                    {formatStreams(item.streams) && ` · ${formatStreams(item.streams)}`}
                  </div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: TYPE_COLORS[item._type], flexShrink: 0,
                  background: `${TYPE_COLORS[item._type]}18`,
                  padding: "2px 8px", borderRadius: 20,
                  border: `1px solid ${TYPE_COLORS[item._type]}40`,
                }}>
                  {TYPE_LABELS[item._type]}
                </span>
              </button>
            ))}
          </div>
        )}

        {query && !searching && results.length === 0 && (
          <div style={{ padding: 16, background: "var(--surface)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 10px 10px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
            No results for "{query}"
          </div>
        )}
      </div>

      {/* Featured — only show when not searching */}
      {!query && featured && (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 32 }}>

          {/* Global Top Tracks */}
          {featured.top_tracks?.length > 0 && (
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, color: "var(--text)" }}>
                🔥 Trending right now
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
                {featured.top_tracks.map((track) => (
                  <FeaturedCard key={track.id} item={track} type="track" />
                ))}
              </div>
            </div>
          )}

          {/* New Releases */}
          {featured.new_releases?.length > 0 && (
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, color: "var(--text)" }}>
                ✨ New releases
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
                {featured.new_releases.map((album) => (
                  <FeaturedCard key={album.id} item={album} type="album" />
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
