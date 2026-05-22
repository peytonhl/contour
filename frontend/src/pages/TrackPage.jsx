import { useState, useEffect, useRef } from "react";
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

// StatBlock + NoChartData were defined inline. StatBlock was unused.
// NoChartData was extracted to components/NoChartData.jsx and given the
// brand-aligned copy + serif headline that AlbumPage already used (the
// flat "No streaming data available" string was the older variant). The
// shared component accepts `entityLabel="track"` to keep the copy precise.

/**
 * Inline 30s preview player. Mirrors the audio plumbing from
 * `ForYouPage.jsx`'s swipe-deck cards: a REAL `<audio>` element in the
 * DOM (not `new Audio()`), keyed on track.id so React fully replaces it
 * when navigating between tracks, with `preload="none"` so we don't
 * download the clip until the user actually taps play.
 *
 * Why the DOM-attached element matters: iOS WKWebView only honors
 * user-gesture playback privileges for `<audio>` elements that are
 * already in the document tree at gesture time. Detached `new Audio()`
 * instances silently reject `play()` on first tap.
 *
 * When `previewUrl` is absent, falls back to a "no preview available"
 * line with a Spotify-link affordance — same UX as the For You feed.
 */
function TrackPreviewPlayer({ trackId, previewUrl, externalUrl }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // Reset playback state when the track changes (URL prop swap)
  useEffect(() => {
    setPlaying(false);
    setProgress(0);
  }, [trackId, previewUrl]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play()
        .then(() => setPlaying(true))
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[contour] preview play() rejected:", err?.name, err?.message);
        });
    }
  }

  if (!previewUrl) {
    return (
      <div style={{
        background: "var(--surface)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-4) var(--space-5)",
        display: "flex", alignItems: "center", gap: "var(--space-3)",
        color: "var(--text-muted)", fontSize: "var(--text-sm)",
      }}>
        <span style={{
          width: 44, height: 44, borderRadius: "50%",
          background: "var(--surface3)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        </span>
        <span style={{ flex: 1 }}>Preview unavailable for this track.</span>
        {externalUrl && (
          <a href={externalUrl} target="_blank" rel="noreferrer"
            style={{
              fontSize: "var(--text-xs)", fontWeight: 700,
              color: "var(--accent)", textDecoration: "none",
              whiteSpace: "nowrap",
            }}>
            Open in Spotify
          </a>
        )}
      </div>
    );
  }

  return (
    <div style={{
      background: "var(--surface)",
      borderRadius: "var(--radius-lg)",
      padding: "var(--space-4) var(--space-5)",
      display: "flex", alignItems: "center", gap: "var(--space-4)",
    }}>
      <audio
        key={trackId}
        ref={audioRef}
        src={previewUrl}
        preload="none"
        playsInline
        onTimeUpdate={(e) => {
          const cur = e.currentTarget.currentTime;
          if (cur >= 30) {
            e.currentTarget.pause();
            setPlaying(false);
            setProgress(1);
            return;
          }
          setProgress(cur / 30);
        }}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onError={(e) => {
          const err = e.currentTarget.error;
          // eslint-disable-next-line no-console
          console.warn(
            "[contour] preview audio failed to load:",
            { code: err?.code, message: err?.message, src: e.currentTarget.src },
          );
          setPlaying(false);
        }}
      />
      <button
        onClick={toggle}
        aria-label={playing ? "Pause preview" : "Play 30-second preview"}
        style={{
          width: 48, height: 48, borderRadius: "50%",
          background: "var(--accent)",
          border: "none", cursor: "pointer", flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "#000",
          boxShadow: "0 2px 12px rgba(217,122,59,0.35)",
        }}
      >
        {playing
          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
        }
      </button>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{
          height: 4, borderRadius: 2,
          background: "rgba(255,255,255,0.08)", overflow: "hidden",
        }}>
          <div style={{
            width: `${Math.round(progress * 100)}%`, height: "100%",
            background: "var(--accent)",
            transition: "width 0.1s linear",
          }} />
        </div>
        <span style={{
          fontSize: "var(--text-xs)", color: "var(--text-dim)",
          letterSpacing: "0.04em",
        }}>
          30-second preview
        </span>
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
              fontSize: "var(--text-sm)", fontWeight: 500,
              color: "var(--text-dim)",
            }}>Track</div>

            <h1 style={{
              fontSize: "var(--text-4xl)", fontWeight: 800,
              lineHeight: 1.05, letterSpacing: "-0.025em",
              margin: 0,
            }}>
              {track.name}
              {track.explicit && <span style={{ marginLeft: 10, fontSize: "var(--text-xs)", background: "var(--surface3)", borderRadius: "var(--radius-sm)", padding: "2px 6px", color: "var(--text-muted)", verticalAlign: "middle", fontWeight: 700, letterSpacing: "0.06em" }}>E</span>}
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

        {/* Celebrated stat.
            zIndex 10 (not the hero default of 2) so EraAdjustedStat's
            "?" popover renders ABOVE the hero-actions row immediately
            below. Without this the popover's zIndex:200 is trapped
            inside its parent's zIndex:2 stacking context and the
            Rate/Want-to-listen buttons paint over it. See AlbumPage
            for the longer note. */}
        <div style={{ position: "relative", zIndex: 10, marginTop: "var(--space-5)" }}>
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
            fontSize: "var(--text-sm)", fontWeight: 500,
            color: "var(--text-dim)",
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

        {/* Inline 30s preview — sits ABOVE the rate section so the user can
            hear the track before tapping a star. Spotify dropped preview_url
            for most tracks in late 2023; the backend backfills missing
            previews via Deezer's public API (see _attach_preview_url in
            routers/tracks.py). When neither source has a clip, the player
            renders a "preview unavailable" line instead of disappearing —
            keeps the layout stable across tracks. */}
        <TrackPreviewPlayer
          trackId={id}
          previewUrl={track.preview_url}
          externalUrl={track.external_url}
        />

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
              accentColor="var(--accent-a)"
              disclaimer={trajectory.stream_source !== "kworb" ? DISCLAIMER : undefined}
            />
          ) : (
            <NoChartData releaseDate={track.release_date} entityLabel="track" />
          )}
        </div>
      </div>
    </div>
  );
}
