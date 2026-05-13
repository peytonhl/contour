import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api.js";
import { ReviewSection } from "../components/ReviewSection.jsx";
import { ShareButton } from "../components/ShareButton.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { analytics } from "../services/analytics.js";

const ACCENT_A = "#a78bfa";

// ── Formatters ────────────────────────────────────────────────────────────────
function formatStreams(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString();
}

function formatFollowers(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

function formatDuration(ms) {
  if (!ms) return "—";
  const m = Math.floor(ms / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${m}:${s}`;
}

// ── Known For cards (IMDb-style, top 4 by Spotify popularity) ────────────────
function KnownForSection({ tracks }) {
  // Spotify returns top tracks already sorted by popularity — take first 4
  const picks = tracks.slice(0, 4);
  if (!picks.length) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Known For</h2>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 12,
      }}>
        {picks.map((track) => (
          <Link
            key={track.id}
            to={`/track/${track.id}`}
            style={{ textDecoration: "none", color: "var(--text)" }}
          >
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                overflow: "hidden",
                transition: "border-color 0.15s, transform 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = ACCENT_A;
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.transform = "none";
              }}
            >
              {/* Square album art */}
              {track.image_url
                ? <img src={track.image_url} alt={track.name} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                : <div style={{ width: "100%", aspectRatio: "1", background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🎵</div>
              }
              <div style={{ padding: "10px 12px 12px" }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, lineHeight: 1.3,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {track.name}
                </div>
                {track.album_name && (
                  <div style={{
                    fontSize: 11, color: "var(--text-muted)", marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {track.album_name}
                  </div>
                )}
                {track.release_date && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                    {track.release_date.slice(0, 4)}
                  </div>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function TopTrackRow({ track, rank }) {
  return (
    <Link
      to={`/track/${track.id}`}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "10px 16px",
        textDecoration: "none", color: "var(--text)",
        borderRadius: 8,
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      {/* Rank */}
      <span style={{ width: 20, textAlign: "right", fontSize: 13, color: "var(--text-muted)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
        {rank}
      </span>

      {/* Art */}
      {track.image_url
        ? <img src={track.image_url} alt={track.name} style={{ width: 42, height: 42, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />
        : <div style={{ width: 42, height: 42, borderRadius: 5, background: "var(--surface2)", flexShrink: 0 }} />
      }

      {/* Name + album */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {track.name}
          {track.explicit && (
            <span style={{ marginLeft: 6, fontSize: 9, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 4px", color: "var(--text-muted)", verticalAlign: "middle", fontWeight: 600 }}>E</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
          {track.album_name}
        </div>
      </div>

      {/* Duration */}
      <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
        {formatDuration(track.duration_ms)}
      </span>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function ArtistPage() {
  const { id } = useParams();
  const { user } = useAuth();

  const [artist, setArtist] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [topTracks, setTopTracks] = useState([]);
  const [sort, setSort] = useState("date");
  const [favorited, setFavorited] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [albumsLoading, setAlbumsLoading] = useState(true);
  const [albumsEmpty, setAlbumsEmpty] = useState(false);
  const [showAllAlbums, setShowAllAlbums] = useState(false);

  async function loadAlbums() {
    setAlbumsLoading(true);
    setAlbumsEmpty(false);
    try {
      const data = await api.getArtistAlbums(id);
      setAlbums(data);
      setAlbumsEmpty(data.length === 0);
    } catch {
      setAlbumsEmpty(true);
    } finally {
      setAlbumsLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    setAlbums([]);
    setAlbumsLoading(true);
    setAlbumsEmpty(false);

    // Load artist info + favorites + top tracks together (these rarely fail)
    Promise.all([
      api.getArtist(id),
      api.getArtistFavorite(id),
      api.getArtistTopTracks(id).catch(() => []),
    ])
      .then(([artistData, favData, tracksData]) => {
        setArtist(artistData);
        setFavorited(favData.favorited);
        setTopTracks(tracksData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    // Albums fetch is independent — has its own loading/retry state
    loadAlbums();
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
    if (sort === "era") return (b.era_adjusted_streams ?? -1) - (a.era_adjusted_streams ?? -1);
    return b.release_date.localeCompare(a.release_date);
  });

  const totalStreams = albums.reduce((sum, a) => sum + (a.streams ?? 0), 0);
  const totalEraAdjusted = albums.reduce((sum, a) => sum + (a.era_adjusted_streams ?? a.streams ?? 0), 0);
  const topAlbum = [...albums].sort((a, b) => (b.streams ?? -1) - (a.streams ?? -1))[0];

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (error) return <div style={{ padding: 60, textAlign: "center", color: "var(--danger)" }}>Error: {error}</div>;
  if (!artist) return null;

  return (
    <div className="hero-page" style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 32 }}>

      {/* ── Hero ── */}
      <div className="hero-row" style={{ display: "flex", gap: 28, alignItems: "center" }}>
        {/* Photo */}
        {artist.image_url
          ? <img src={artist.image_url} alt={artist.name} style={{ width: 140, height: 140, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
          : <div style={{ width: 140, height: 140, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
        }

        {/* Info */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minWidth: 0 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Artist</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1 }}>{artist.name}</h1>
              {totalEraAdjusted > totalStreams * 1.1 && totalEraAdjusted > 0 && (
                <span
                  title="Era Score: combined catalog streams adjusted for Spotify's user base at each release's era"
                  style={{
                    fontSize: 11, fontWeight: 700,
                    padding: "3px 10px", borderRadius: 999,
                    background: "rgba(167,139,250,0.12)",
                    color: ACCENT_A,
                    border: `1px solid rgba(167,139,250,0.35)`,
                    whiteSpace: "nowrap",
                  }}
                >
                  Era Score: {formatStreams(totalEraAdjusted)}
                </span>
              )}
            </div>
          </div>

          {/* Followers + genres */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {formatFollowers(artist.followers) && (
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                <strong style={{ color: "var(--text)" }}>{formatFollowers(artist.followers)}</strong> Spotify followers
              </span>
            )}
            {artist.genres?.slice(0, 3).map((g) => (
              <span key={g} style={{ fontSize: 12, padding: "2px 10px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 20, color: "var(--text-muted)" }}>{g}</span>
            ))}
          </div>

          {/* Total streams */}
          {totalStreams > 0 && (
            <div style={{ fontSize: 14, color: "var(--text-muted)" }}>
              <strong style={{ color: ACCENT_A, fontSize: 16 }}>{formatStreams(totalStreams)}</strong>
              {" "}combined catalog streams · {albums.length} release{albums.length !== 1 ? "s" : ""}
            </div>
          )}

          {/* Action buttons */}
          <div className="hero-actions" style={{ display: "flex", gap: 10, marginTop: 2, flexWrap: "wrap" }}>
            {user && (
              <button
                onClick={handleToggleFavorite}
                disabled={favLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600,
                  background: favorited ? "rgba(167,139,250,0.15)" : "var(--surface2)",
                  border: `1px solid ${favorited ? ACCENT_A : "var(--border)"}`,
                  color: favorited ? ACCENT_A : "var(--text-muted)",
                  cursor: favLoading ? "default" : "pointer",
                  transition: "all 0.15s",
                }}
              >
                {favorited ? "♥ Favorited" : "♡ Add to Favorites"}
              </button>
            )}
            <ShareButton surface="artist" title={`${artist.name} on Contour`} />
            {artist.external_url && (
              <a href={artist.external_url} target="_blank" rel="noreferrer"
                onClick={() => analytics.spotifyLinkClicked("artist")}
                style={{ display: "inline-flex", alignItems: "center", padding: "8px 18px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", fontSize: 13 }}>
                Open in Spotify ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats bar ── */}
      {(totalStreams > 0 || albums.length > 0) && (
        <div style={{
          display: "flex", gap: 0,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
          overflow: "hidden",
        }}>
          {[
            { label: "Catalog Streams", value: totalStreams > 0 ? formatStreams(totalStreams) : null },
            { label: "Releases", value: albums.length > 0 ? albums.length : null },
            topAlbum?.streams ? { label: "Top Release", value: topAlbum.name.length > 20 ? topAlbum.name.slice(0, 18) + "…" : topAlbum.name } : null,
          ].filter(Boolean).map((stat, i, arr) => (
            <div key={stat.label} style={{
              flex: 1, padding: "16px 20px", textAlign: "center",
              borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
            }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Known For (top 4 by Spotify popularity — no extra API calls) ── */}
      {topTracks.length > 0 && <KnownForSection tracks={topTracks} />}

      {/* ── Popular Tracks (full ranked list) ── */}
      {topTracks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Popular Tracks</h2>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", padding: "6px 0" }}>
            {topTracks.map((track, i) => (
              <TopTrackRow key={track.id} track={track} rank={i + 1} />
            ))}
          </div>
        </div>
      )}

      {/* ── Discography ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Discography</h2>
          {!albumsLoading && !albumsEmpty && (
            <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 7, overflow: "hidden", border: "1px solid var(--border)", flexShrink: 0 }}>
              {[
                ["date",    "Latest",  "Sorted by release date, newest first"],
                ["streams", "Streams", "Raw stream count from Spotify (or Last.fm scrobbles). Favors newer releases since Spotify's audience was much smaller before 2018."],
                ["era",     "Era Score", "Stream count adjusted for when the album came out. Older albums are multiplied up to account for Spotify having fewer users at the time, so you can compare a 2012 album to a 2024 album fairly."],
              ].map(([val, lbl, tip]) => (
                <div key={val} style={{ position: "relative" }} className={`sort-btn-wrap sort-btn-wrap-${val}`}>
                  <button
                    onClick={() => { setSort(val); setShowAllAlbums(false); }}
                    style={{
                      padding: "5px 14px", fontSize: 12, fontWeight: sort === val ? 700 : 400,
                      background: sort === val ? ACCENT_A : "transparent",
                      color: sort === val ? "#000" : "var(--text-muted)",
                      border: "none", cursor: "pointer", transition: "all 0.15s",
                    }}
                    title={tip}
                  >{lbl}</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {albumsLoading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
            Loading discography…
          </div>
        ) : albumsEmpty ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
            padding: "36px 24px", textAlign: "center",
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
          }}>
            <div style={{ fontSize: 28 }}>⚠️</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              Couldn't load discography
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 340, lineHeight: 1.5 }}>
              Spotify's API is temporarily rate-limited. This usually clears in a few minutes.
            </div>
            <button
              onClick={loadAlbums}
              style={{
                marginTop: 4, padding: "8px 22px", borderRadius: 7, fontSize: 13, fontWeight: 600,
                background: "var(--surface2)", border: "1px solid var(--border)",
                color: "var(--text)", cursor: "pointer", transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = ACCENT_A}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {(showAllAlbums ? sorted : sorted.slice(0, 5)).map((album) => (
                <Link key={album.id} to={`/album/${album.id}`} style={{ textDecoration: "none", color: "var(--text)" }}>
                  <div style={{
                    background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
                    overflow: "hidden", transition: "border-color 0.15s, transform 0.15s",
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT_A; e.currentTarget.style.transform = "translateY(-2px)"; }}
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
                      <div style={{ fontSize: 12, color: ACCENT_A, marginTop: 4, fontWeight: 600 }}>
                        {album.streams ? (
                          sort === "era" && album.era_adjusted_streams
                            ? formatStreams(album.era_adjusted_streams)
                            : formatStreams(album.streams)
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                            {album.enrichment_status === "pending" ? "loading…" : "—"}
                          </span>
                        )}
                      </div>
                      {sort === "era" && album.multiplier > 1.1 && (
                        <div style={{ fontSize: 10, fontWeight: 700, marginTop: 3, color: ACCENT_A, opacity: 0.75 }}>
                          ×{album.multiplier.toFixed(1)} era adj.
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            {sorted.length > 5 && (
              <button
                onClick={() => setShowAllAlbums(v => !v)}
                style={{
                  marginTop: 4, width: "100%", padding: "10px", borderRadius: 8,
                  background: "var(--surface)", border: "1px solid var(--border)",
                  color: "var(--text-muted)", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", transition: "border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT_A; e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                {showAllAlbums ? "Show less" : `See all ${sorted.length} releases`}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Ratings & Reviews ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Ratings & Reviews</h2>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
          <ReviewSection entityType="artist" entityId={id} user={user} />
        </div>
      </div>

      {/* ── Compare ── */}
      {albums.length >= 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Compare Albums</h2>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px" }}>
            {/* Lazy import to avoid increasing initial bundle */}
            <CompareSection sorted={sorted} artistName={artist.name} />
          </div>
        </div>
      )}

    </div>
  );
}

// Split out so ComparisonWidget doesn't load until it's needed
import { ComparisonWidget } from "../components/ComparisonWidget.jsx";
function CompareSection({ sorted, artistName }) {
  return (
    <ComparisonWidget
      initialAlbumA={sorted[0] ? { id: sorted[0].id, name: sorted[0].name, artists: [artistName], image_url: sorted[0].image_url } : null}
      initialAlbumB={sorted[1] ? { id: sorted[1].id, name: sorted[1].name, artists: [artistName], image_url: sorted[1].image_url } : null}
    />
  );
}
