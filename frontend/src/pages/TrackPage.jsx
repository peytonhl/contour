import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { TrajectoryChart } from "../components/TrajectoryChart.jsx";
import { ReviewSection } from "../components/ReviewSection.jsx";
import { EraAdjustedStat } from "../components/EraAdjustedStat.jsx";
import { PreStreamingBanner } from "../components/PreStreamingBanner.jsx";
import { ShareButton } from "../components/ShareButton.jsx";
import { WantToListenButton } from "../components/WantToListenButton.jsx";
import { SpotifyIcon, AppleMusicIcon, YouTubeIcon } from "../components/PlatformIcons.jsx";
import { EntityHeroSkeleton } from "../components/Skeleton.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { analytics } from "../services/analytics.js";

const ACCENT = "#6a90b5";
const DISCLAIMER = "Stream trajectory is a modeled approximation calibrated to the known total stream count. Exact day-by-day data requires Luminate licensing.";

function formatStreams(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString();
}

function formatDuration(ms) {
  if (!ms) return "—";
  const m = Math.floor(ms / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${m}:${s}`;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function formatReleaseDate(dateStr) {
  if (!dateStr) return "—";
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parseInt(parts[2], 10)} ${MONTHS[parseInt(parts[1], 10) - 1]} ${parts[0]}`;
  if (parts.length === 2) return `${MONTHS[parseInt(parts[1], 10) - 1]} ${parts[0]}`;
  return parts[0];
}

function RiaaTooltip() {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: 4 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span style={{
        fontSize: 10, width: 15, height: 15, borderRadius: "50%",
        background: "rgba(255,255,255,0.1)", color: "var(--text-muted)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "default", fontWeight: 800, border: "1px solid var(--border)",
      }}>i</span>
      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)",
          background: "var(--surface2)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "12px 14px",
          fontSize: 12, lineHeight: 1.55, color: "var(--text)",
          width: 230, zIndex: 200, boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
          pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>RIAA Certification</div>
          <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>
            Awarded by the RIAA based on certified units (streams + downloads + physical sales).
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, color: "var(--gold)", fontWeight: 600 }}>
            <span>Gold · 500K units</span>
            <span>Platinum · 1M units</span>
            <span>Diamond · 10M units</span>
          </div>
        </div>
      )}
    </span>
  );
}

function StatBlock({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{value ?? "—"}</span>
    </div>
  );
}

function NoChartData({ releaseDate }) {
  const year = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) : null;
  const isEarlyEra = year && year < 2013;
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
      padding: "52px 24px", display: "flex", flexDirection: "column",
      alignItems: "center", gap: 12, textAlign: "center",
    }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
        {isEarlyEra
          ? <><path d="M1 6l5 5 5-5 5 5 5-5"/><path d="M1 12l5 5 5-5 5 5 5-5"/></>
          : <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>
        }
      </svg>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-muted)" }}>No streaming data available</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 420, lineHeight: 1.6, opacity: 0.75 }}>
        {isEarlyEra
          ? `Releases from ${year} predate widespread streaming adoption. Historical data is often absent from our sources.`
          : "Streaming data isn't available for this track yet. It may not be indexed by our data sources."}
      </div>
    </div>
  );
}

export function TrackPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [track, setTrack] = useState(null);
  const [trajectory, setTrajectory] = useState(null);
  const [appleMusic, setAppleMusic] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setAppleMusic(null);
    api.getTrack(id)
      .then((trackData) => {
        setTrack(trackData);
        return Promise.allSettled([
          api.getTrackTrajectory(id),
          api.getAppleMusicLink("track", id),
        ]);
      })
      .then(([trajResult, appleResult]) => {
        if (trajResult.status === "fulfilled") setTrajectory(trajResult.value);
        if (appleResult.status === "fulfilled") setAppleMusic(appleResult.value);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <EntityHeroSkeleton />;
  if (error) return <div style={{ padding: 80, textAlign: "center", color: "var(--danger)", fontSize: 14 }}>Error: {error}</div>;
  if (!track) return null;

  const topCert = trajectory?.riaa_milestones?.at(-1);
  // Prefer Apple Music's 1200×1200 cover when matched — sharper than
  // Spotify's 640×640 ceiling on high-DPR mobile. Falls back to Spotify
  // until the Apple Music lookup resolves (or stays Spotify if no match).
  const heroImage = appleMusic?.artwork_url || track.image_url;

  return (
    <div className="hero-page" style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column" }}>

      {/* ── Hero ── */}
      <div className="entity-hero" style={{
        position: "relative",
        padding: "var(--space-7) var(--space-5) var(--space-5)",
        overflow: "hidden",
      }}>
        {heroImage && (
          <>
            <div aria-hidden style={{
              position: "absolute", inset: -40, zIndex: 0,
              backgroundImage: `url(${heroImage})`,
              backgroundSize: "cover", backgroundPosition: "center",
              filter: "blur(60px) saturate(1.5) brightness(0.55)",
              transform: "scale(1.3)",
            }} />
            <div aria-hidden style={{
              position: "absolute", inset: 0, zIndex: 1,
              background: "linear-gradient(180deg, rgba(8,8,10,0.18) 0%, rgba(8,8,10,0.55) 55%, var(--bg) 100%)",
            }} />
          </>
        )}

        <div className="hero-row" style={{
          position: "relative", zIndex: 2,
          display: "flex", gap: "var(--space-5)", alignItems: "flex-end",
        }}>
          {heroImage
            ? <img src={heroImage} alt={track.name} className="hero-img" decoding="async" fetchpriority="high" style={{
                width: 200, height: 200, borderRadius: "var(--radius-lg)",
                objectFit: "cover", flexShrink: 0,
                boxShadow: "var(--shadow-hero)",
              }} />
            : <div className="hero-img" style={{
                width: 200, height: 200, borderRadius: "var(--radius-lg)",
                background: "var(--surface2)", flexShrink: 0,
              }} />
          }
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.1em",
              textTransform: "uppercase", color: "var(--text-dim)",
            }}>Track</div>

            <h1 style={{
              fontSize: "var(--text-4xl)", fontWeight: 800,
              lineHeight: 1.05, letterSpacing: "-0.025em",
              margin: 0,
            }}>
              {track.name}
              {track.explicit && <span style={{ marginLeft: 10, fontSize: "var(--text-xs)", background: "var(--surface3)", borderRadius: 4, padding: "2px 6px", color: "var(--text-muted)", verticalAlign: "middle", fontWeight: 700, letterSpacing: "0.06em" }}>E</span>}
            </h1>

            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", fontWeight: 600 }}>
              {track.artists?.map((artist, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  {track.artist_ids?.[i]
                    ? <Link to={`/artist/${track.artist_ids[i]}`} style={{ color: "var(--text)" }}>{artist}</Link>
                    : <span style={{ color: "var(--text)" }}>{artist}</span>}
                </span>
              ))}
            </div>

            {/* Meta row: album · release · duration · RIAA */}
            <div style={{
              display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap",
              fontSize: "var(--text-sm)", color: "var(--text-muted)",
              marginTop: "var(--space-1)",
            }}>
              {track.album_name && (
                <>
                  {track.album_id
                    ? <Link to={`/album/${track.album_id}`} style={{ color: "var(--text-muted)" }}>{track.album_name}</Link>
                    : <span>{track.album_name}</span>}
                  <span style={{ opacity: 0.4 }}>·</span>
                </>
              )}
              <span>{formatReleaseDate(track.release_date)}</span>
              {track.duration_ms && (
                <>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span>{formatDuration(track.duration_ms)}</span>
                </>
              )}
              {topCert && (
                <>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: "var(--gold)", fontWeight: 700 }}>RIAA {topCert.label}</span>
                    <RiaaTooltip />
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Celebrated stat */}
        <div style={{ position: "relative", zIndex: 2, marginTop: "var(--space-5)" }}>
          <EraAdjustedStat
            eraContext={trajectory?.era_context}
            totalStreams={trajectory?.total_streams}
            onOpen={() => analytics.eraAdjustmentViewed("track")}
            variant="hero"
          />
        </div>

        {/* Primary action row */}
        <div className="hero-actions" style={{
          position: "relative", zIndex: 2,
          display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap",
          marginTop: "var(--space-5)",
        }}>
          <button
            onClick={() => document.getElementById("rate-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            style={{
              padding: "var(--space-3) var(--space-5)",
              background: "var(--accent)", border: "none",
              borderRadius: "var(--radius-pill)",
              color: "#000", fontWeight: 700, fontSize: "var(--text-sm)",
              cursor: "pointer", letterSpacing: "0.01em",
              display: "inline-flex", alignItems: "center", gap: "var(--space-1)",
            }}
          >
            ★ Rate
          </button>
          <WantToListenButton entityType="track" entityId={id} />
          <button
            onClick={() => navigate("/compare")}
            style={{
              padding: "var(--space-3) var(--space-4)",
              background: "var(--surface3)", border: "none",
              borderRadius: "var(--radius-pill)",
              color: "var(--text-muted)", fontSize: "var(--text-sm)",
              cursor: "pointer", letterSpacing: "0.01em",
            }}
          >
            Compare
          </button>
          <ShareButton surface="track" title={`${track.name} on Contour`} />
        </div>

        {/* Listen on row */}
        <div className="hero-listen-row" style={{
          position: "relative", zIndex: 2,
          display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center",
          marginTop: "var(--space-3)",
        }}>
          <span style={{
            fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", color: "var(--text-dim)",
            marginRight: "var(--space-1)",
          }}>
            Listen on
          </span>
          {track.external_url && (
            <a href={track.external_url} target="_blank" rel="noreferrer"
              onClick={() => analytics.spotifyLinkClicked("track")}
              style={{
                padding: "var(--space-1) var(--space-3)",
                background: "var(--surface3)", border: "none",
                borderRadius: "var(--radius-pill)",
                color: "var(--text-muted)", fontSize: "var(--text-xs)",
                textDecoration: "none",
                display: "inline-flex", alignItems: "center", gap: 5,
              }}>
              <SpotifyIcon /> Spotify
            </a>
          )}
          {appleMusic?.url && (
            <a href={appleMusic.url} target="_blank" rel="noreferrer"
              onClick={() => analytics.appleMusicLinkClicked("track")}
              style={{
                padding: "var(--space-1) var(--space-3)",
                background: "var(--surface3)", border: "none",
                borderRadius: "var(--radius-pill)",
                color: "var(--text-muted)", fontSize: "var(--text-xs)",
                textDecoration: "none",
                display: "inline-flex", alignItems: "center", gap: 5,
              }}>
              <AppleMusicIcon /> Apple Music
            </a>
          )}
          <a
            href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.name} ${track.artists?.[0] ?? ""}`)}`}
            target="_blank" rel="noreferrer"
            style={{
              padding: "var(--space-1) var(--space-3)",
              background: "var(--surface3)", border: "none",
              borderRadius: "var(--radius-pill)",
              color: "var(--text-muted)", fontSize: "var(--text-xs)",
              textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 5,
            }}
          >
            <YouTubeIcon /> YouTube
          </a>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="entity-body" style={{
        padding: "var(--space-6) var(--space-5)",
        display: "flex", flexDirection: "column", gap: "var(--space-5)",
      }}>
        <PreStreamingBanner releaseDate={track.release_date} />

        <div id="rate-section" style={{
          background: "var(--surface)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-5) var(--space-5)",
          scrollMarginTop: 70,
        }}>
          <ReviewSection entityType="track" entityId={id} user={user} />
        </div>

        {/* Streaming trajectory — moved below the fold; era-adjustment is contextual, surfaced in the hero stat */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, color: "var(--text)", margin: 0 }}>
            Streaming trajectory
          </h2>
          {trajectory?.trajectory?.length > 0 ? (
            <TrajectoryChart
              trajectory={trajectory.trajectory}
              milestones={trajectory.riaa_milestones}
              accentColor="var(--accent-b)"
              disclaimer={trajectory.stream_source !== "kworb" ? DISCLAIMER : undefined}
            />
          ) : (
            <NoChartData releaseDate={track.release_date} />
          )}
        </div>
      </div>
    </div>
  );
}
