import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT = "#d97a3b";

// Mirrors the localStorage key used by ForYouPage so that removing/adding
// here also keeps the per-device cache in sync (matters for logged-out
// fallback and for the "Clear not-interested list" hint count).
const DISLIKED_KEY = "contour_disliked_v1";

function readLocalDisliked() {
  try { return JSON.parse(localStorage.getItem(DISLIKED_KEY) || "[]"); } catch { return []; }
}
function writeLocalDisliked(ids) {
  localStorage.setItem(DISLIKED_KEY, JSON.stringify(ids.slice(0, 50)));
}

export function DislikedArtistsPage() {
  const { user, loading: authLoading } = useAuth();
  const [dislikes, setDislikes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Add UI
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api.listArtistDislikes()
      .then((items) => setDislikes(items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  // Debounced live search — same UX as the For You preview cards.
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) { setResults([]); return; }
    searchTimeoutRef.current = setTimeout(() => {
      setSearching(true);
      api.searchArtists(trimmed)
        .then((r) => setResults(r ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [query]);

  async function addArtist(artist) {
    // Optimistic insert — the POST is idempotent so a duplicate is harmless.
    setDislikes((prev) => {
      if (prev.some((a) => a.id === artist.id)) return prev;
      return [{ id: artist.id, name: artist.name, image_url: artist.image_url }, ...prev];
    });
    setQuery("");
    setResults([]);
    writeLocalDisliked([artist.id, ...readLocalDisliked().filter((a) => a !== artist.id)]);
    api.addArtistDislike(artist.id).catch(() => {});
  }

  async function removeArtist(id) {
    setDislikes((prev) => prev.filter((a) => a.id !== id));
    writeLocalDisliked(readLocalDisliked().filter((a) => a !== id));
    api.removeArtistDislike(id).catch(() => {});
  }

  async function clearAll() {
    if (!confirm(`Remove all ${dislikes.length} disliked artists? They'll be eligible to appear in For You again.`)) return;
    setDislikes([]);
    writeLocalDisliked([]);
    api.clearArtistDislikes().catch(() => {});
  }

  if (authLoading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (!user) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
        Sign in to manage your disliked artists.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px 60px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 6 }}>Disliked artists</h1>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 22 }}>
        These artists won't appear in your For You feed. They can still appear
        in search, on charts, and in friends' activity. Remove an artist to
        let them back into your recommendations.
      </p>

      {/* Add a new dislike — search Spotify by name */}
      <div style={{ marginBottom: 24, position: "relative" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for an artist to block…"
          style={{
            width: "100%", padding: "11px 14px", fontSize: 14,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", color: "var(--text)", outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => e.currentTarget.style.borderColor = ACCENT}
          onBlur={(e) => e.currentTarget.style.borderColor = "var(--border)"}
        />

        {(results.length > 0 || (searching && query.trim().length >= 2)) && (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 10,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", maxHeight: 320, overflowY: "auto",
            boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
          }}>
            {searching && results.length === 0 && (
              <div style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>Searching…</div>
            )}
            {results.map((a) => {
              const already = dislikes.some((d) => d.id === a.id);
              return (
                <button
                  key={a.id}
                  disabled={already}
                  onClick={() => addArtist(a)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 12px", border: "none",
                    background: "transparent", color: "var(--text)",
                    cursor: already ? "default" : "pointer", textAlign: "left",
                    opacity: already ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => { if (!already) e.currentTarget.style.background = "var(--surface2)"; }}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  {a.image_url
                    ? <img src={a.image_url} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
                  }
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{a.name}</span>
                  <span style={{ fontSize: 11, color: already ? "var(--text-muted)" : ACCENT, fontWeight: 700 }}>
                    {already ? "Already blocked" : "Block"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Existing dislikes */}
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
      ) : dislikes.length === 0 ? (
        <div style={{
          padding: "40px 20px", textAlign: "center", color: "var(--text-muted)",
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
        }}>
          You haven't blocked any artists. Tap "Not interested" on a For You card to block one.
        </div>
      ) : (
        <>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 10,
          }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {dislikes.length} {dislikes.length === 1 ? "artist" : "artists"} blocked
            </span>
            <button
              onClick={clearAll}
              style={{
                fontSize: 12, padding: "5px 10px", borderRadius: "var(--radius-sm)",
                background: "none", border: "1px solid var(--border)",
                color: "var(--text-muted)", cursor: "pointer",
              }}
            >
              Clear all
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dislikes.map((a) => (
              <div key={a.id} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 14px",
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
              }}>
                <Link to={`/artist/${a.id}`} style={{ flexShrink: 0 }}>
                  {a.image_url
                    ? <img src={a.image_url} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                    : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface2)" }} />
                  }
                </Link>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/artist/${a.id}`} style={{
                    fontSize: 14, fontWeight: 600, color: "var(--text)", textDecoration: "none",
                  }}>
                    {a.name}
                  </Link>
                </div>
                <button onClick={() => removeArtist(a.id)} style={{
                  padding: "6px 12px", borderRadius: "var(--radius-sm)", fontSize: 12,
                  background: "none", border: "1px solid var(--border)",
                  color: "var(--text-muted)", cursor: "pointer",
                }}>
                  Unblock
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
