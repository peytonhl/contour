import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api.js";
import { ComparisonWidget } from "../components/ComparisonWidget.jsx";
import { ReviewSection } from "../components/ReviewSection.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

function formatStreams(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString();
}

function formatFollowers(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M followers`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K followers`;
  return `${n} followers`;
}

export function ArtistPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [artist, setArtist] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [sort, setSort] = useState("date");
  const [favorited, setFavorited] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.getArtist(id),
      api.getArtistAlbums(id),
      api.getArtistFavorite(id),
    ])
      .then(([artistData, albumData, favData]) => {
        setArtist(artistData);
        setAlbums(albumData);
        setFavorited(favData.favorited);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleToggleFavorite() {
    if (!user) return;
    setFavLoading(true);
    try {
      const res = await api.toggleArtistFavorite(id);
      setFavorited(res.favorited);
    } finally {
      setFavLoading(false);
    }
  }

  const sorted = [...albums].sort((a, b) => {
    if (sort === "streams") return (b.streams ?? -1) - (a.streams ?? -1);
    return b.release_date.localeCompare(a.release_date);
  });

  const totalStreams = albums.reduce((sum, a) => sum + (a.streams ?? 0), 0);

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (error) return <div style={{ padding: 60, textAlign: "center", color: "var(--danger)" }}>Error: {error}</div>;
  if (!artist) return null;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Hero */}
      <div className="hero-row" style={{ display: "flex", gap: 24, alignItems: "center" }}>
        {artist.image_url
          ? <img src={artist.image_url} alt={artist.name} style={{ width: 120, height: 120, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
          : <div style={{ width: 120, height: 120, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
        }
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>Artist</div>
          <h1 style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>{artist.name}</h1>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "var(--text-muted)" }}>
            {formatFollowers(artist.followers) && <span>{formatFollowers(artist.followers)}</span>}
            {artist.genres?.slice(0, 3).map((g) => (
              <span key={g} style={{ padding: "2px 10px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 20 }}>{g}</span>
            ))}
          </div>
          {totalStreams > 0 && (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              <strong style={{ color: "var(--accent-a)" }}>{formatStreams(totalStreams)}</strong> total streams across {albums.length} releases
            </div>
          )}
          {user && (
            <button
              onClick={handleToggleFavorite}
              disabled={favLoading}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600,
                background: favorited ? "rgba(167,139,250,0.15)" : "var(--surface2)",
                border: `1px solid ${favorited ? "var(--accent-a)" : "var(--border)"}`,
                color: favorited ? "var(--accent-a)" : "var(--text-muted)",
                cursor: favLoading ? "default" : "pointer", alignSelf: "flex-start",
                transition: "all 0.15s",
              }}
            >
              {favorited ? "♥ Favorited" : "♡ Favorite Artist"}
            </button>
          )}
        </div>
      </div>

      {/* Discography */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Discography</h2>
          <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 7, overflow: "hidden", border: "1px solid var(--border)" }}>
            {[["date", "Latest"], ["streams", "Most Streamed"]].map(([val, lbl]) => (
              <button key={val} onClick={() => setSort(val)} style={{
                padding: "5px 14px", fontSize: 12, fontWeight: sort === val ? 700 : 400,
                background: sort === val ? "var(--accent-a)" : "transparent",
                color: sort === val ? "#000" : "var(--text-muted)",
                border: "none", cursor: "pointer", transition: "all 0.15s",
              }}>{lbl}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
          {sorted.map((album) => (
            <Link key={album.id} to={`/album/${album.id}`} style={{ textDecoration: "none", color: "var(--text)" }}>
              <div style={{
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
                overflow: "hidden", transition: "border-color 0.15s, transform 0.15s",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent-a)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = "none"; }}
              >
                {album.image_url
                  ? <img src={album.image_url} alt={album.name} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                  : <div style={{ width: "100%", aspectRatio: "1", background: "var(--surface2)" }} />
                }
                <div style={{ padding: "10px 12px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {album.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{album.release_date?.slice(0, 4)}</div>
                  <div style={{ fontSize: 12, color: "var(--accent-a)", marginTop: 4, fontWeight: 600 }}>
                    {album.streams ? formatStreams(album.streams) : (
                      <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                        {album.enrichment_status === "pending" ? "enriching…" : "—"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Ratings & Reviews */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Ratings & Reviews</h2>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
          <ReviewSection entityType="artist" entityId={id} user={user} />
        </div>
      </div>

      {/* Compare albums from this artist */}
      {albums.length >= 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Compare</h2>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 20px" }}>
            <ComparisonWidget
              initialAlbumA={sorted[0] ? { id: sorted[0].id, name: sorted[0].name, artists: [artist.name], image_url: sorted[0].image_url } : null}
              initialAlbumB={sorted[1] ? { id: sorted[1].id, name: sorted[1].name, artists: [artist.name], image_url: sorted[1].image_url } : null}
            />
          </div>
        </div>
      )}
    </div>
  );
}
