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
import { NoChartData } from "../components/NoChartData.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { analytics } from "../services/analytics.js";
import { ACCENT_A as ACCENT } from "../theme.js";

const DISCLAIMER = "Stream trajectory is a modeled approximation calibrated to the known total stream count. Exact day-by-day data requires Luminate licensing.";

function formatStreams(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString();
}

function formatDuration(ms) {
  if (!ms) return null;
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
          borderRadius: "var(--radius)", padding: "12px 14px",
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

// StatBlock + NoChartData were defined inline here. StatBlock was unused
// (defined, never rendered) and NoChartData was duplicated with the TrackPage
// version. Both were extracted: NoChartData moved to components/NoChartData.jsx,
// StatBlock deleted.

export function AlbumPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [album, setAlbum] = useState(null);
  const [trajectory, setTrajectory] = useState(null);
  const [tracklist, setTracklist] = useState([]);
  const [appleMusic, setAppleMusic] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setAppleMusic(null);
    api.getAlbum(id)
      .then((albumData) => {
        setAlbum(albumData);
        return Promise.allSettled([
          api.getAlbumTrajectory(id),
          api.getAlbumTracklist(id),
          api.getAppleMusicLink("album", id),
        ]);
      })
      .then(([trajResult, trackResult, appleResult]) => {
        if (trajResult.status === "fulfilled") setTrajectory(trajResult.value);
        if (trackResult.status === "fulfilled") setTracklist(trackResult.value);
        // Apple Music match returns 404 when unconfigured or unmatched — that's
        // the signal to keep the button hidden. Any other failure is silent too.
        if (appleResult.status === "fulfilled") setAppleMusic(appleResult.value);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <EntityHeroSkeleton />;
  if (error) return <div style={{ padding: 80, textAlign: "center", color: "var(--danger)", fontSize: 14 }}>Error: {error}</div>;
  if (!album) return null;

  const topCert = trajectory?.riaa_milestones?.at(-1);
  // Prefer the Apple Music 1200×1200 render when matched — sharper than
  // Spotify's 640×640 ceiling on high-DPR mobile. Falls back to Spotify
  // until the Apple Music lookup resolves (or stays Spotify if no match).
  const heroImage = appleMusic?.artwork_url || album.image_url;

  return (
    <div className="hero-page" style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column" }}>

      {/* ── Hero ──
          Blurred album art fills the backdrop to give the page its color
          identity (the way Spotify / Apple Music do it). A dark vignette
          fades the backdrop into the page bg so body content reads cleanly.
          All content inside the hero sits at z-index 2 above the backdrop. */}
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
            ? <img src={heroImage} alt={album.name} className="hero-img" decoding="async" fetchpriority="high" style={{
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
            {/* Eyebrow: artist credit, deemphasized so the title dominates */}
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", fontWeight: 600 }}>
              {album.artists?.map((artist, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  {album.artist_ids?.[i]
                    ? <Link to={`/artist/${album.artist_ids[i]}`} style={{ color: "var(--text)" }}>{artist}</Link>
                    : <span style={{ color: "var(--text)" }}>{artist}</span>}
                </span>
              ))}
            </div>

            {/* Title — text-4xl, the page identity */}
            <h1 style={{
              fontSize: "var(--text-4xl)", fontWeight: 800,
              lineHeight: 1.05, letterSpacing: "-0.025em",
              margin: 0,
            }}>{album.name}</h1>

            {/* Meta row: release date + RIAA (when present), compact inline */}
            <div style={{
              display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap",
              fontSize: "var(--text-sm)", color: "var(--text-muted)",
              marginTop: "var(--space-1)",
            }}>
              <span>{formatReleaseDate(album.release_date)}</span>
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

        {/* Celebrated stat — big, the differentiated value of this app.
            zIndex bumped from 2 → 10: EraAdjustedStat's "?" popover sits
            BELOW the celebrated number via top:calc(100% + 8px), which
            overlaps the hero-actions row directly underneath. With
            both wrappers at zIndex:2, the later-DOM hero-actions wins
            and the popover rendered UNDER the Rate/Want-to-listen/etc.
            buttons (reported 2026-05-17 with a screenshot showing the
            popover text bleeding through the button pills). The
            popover's own zIndex:200 only escapes within its parent's
            stacking context, not against sibling contexts at the same
            level — so the fix has to be on the wrapper here. */}
        <div style={{ position: "relative", zIndex: 10, marginTop: "var(--space-5)" }}>
          <EraAdjustedStat
            eraContext={trajectory?.era_context}
            totalStreams={trajectory?.total_streams}
            onOpen={() => analytics.eraAdjustmentViewed("album")}
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
          <WantToListenButton entityType="album" entityId={id} />
          <button
            onClick={() => navigate(`/compare`)}
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
          <ShareButton surface="album" title={`${album.name} on Contour`} />
        </div>

        {/* Listen on — quiet platform deeplinks */}
        {(album.external_url || appleMusic?.url) && (
          <div className="hero-listen-row" style={{
            position: "relative", zIndex: 2,
            display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center",
            marginTop: "var(--space-3)",
          }}>
            <span style={{
              fontSize: "var(--text-xs)", fontWeight: 600,
              color: "var(--text-dim)",
              marginRight: "var(--space-1)",
            }}>
              Listen on
            </span>
            {album.external_url && (
              <a href={album.external_url} target="_blank" rel="noreferrer"
                onClick={() => analytics.spotifyLinkClicked("album")}
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
                onClick={() => analytics.appleMusicLinkClicked("album")}
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
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${album.name} ${album.artists?.[0] ?? ""}`)}`}
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
        )}
      </div>

      {/* ── Body ── */}
      <div className="entity-body" style={{
        padding: "var(--space-6) var(--space-5)",
        display: "flex", flexDirection: "column", gap: "var(--space-5)",
      }}>
        <PreStreamingBanner releaseDate={album.release_date} />

        <div id="rate-section" style={{
          background: "var(--surface)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-5) var(--space-5)",
          scrollMarginTop: 70,
        }}>
          <ReviewSection entityType="album" entityId={id} user={user} />
        </div>

        {tracklist.length > 0 && (
          <div style={{
            background: "var(--surface)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
          }}>
            <div style={{
              padding: "var(--space-3) var(--space-5)",
              fontFamily: "var(--font-display)",
              fontSize: 18, fontWeight: 400, color: "var(--text)",
            }}>
              Tracklist
            </div>
            {tracklist.map((track, i) => (
              <Link
                key={track.id}
                to={`/track/${track.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: "var(--space-4)",
                  padding: "var(--space-3) var(--space-5)",
                  textDecoration: "none", color: "var(--text)",
                  transition: "background var(--motion-fast) var(--ease)",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ width: 22, textAlign: "right", fontSize: "var(--text-sm)", color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{track.track_number}</span>
                <span style={{ flex: 1, fontSize: "var(--text-base)", fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {track.name}
                  {track.explicit && <span style={{ marginLeft: 8, fontSize: 9, background: "var(--surface3)", borderRadius: "var(--radius-sm)", padding: "1px 4px", color: "var(--text-muted)", verticalAlign: "middle", letterSpacing: "0.04em", fontWeight: 700 }}>E</span>}
                </span>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{formatDuration(track.duration_ms)}</span>
              </Link>
            ))}
          </div>
        )}

        {/* Streaming trajectory — moved below the fold; era-adjustment is contextual, surfaced in the hero stat */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, color: "var(--text)", margin: 0 }}>
            Streaming trajectory
          </h2>
          {trajectory?.trajectory?.length > 0 ? (
            <TrajectoryChart
              trajectory={trajectory.trajectory}
              milestones={trajectory.riaa_milestones}
              accentColor="var(--accent-a)"
              disclaimer={trajectory.stream_source !== "kworb" ? DISCLAIMER : undefined}
            />
          ) : (
            <NoChartData releaseDate={album.release_date} entityLabel="album" />
          )}
        </div>
      </div>
    </div>
  );
}
