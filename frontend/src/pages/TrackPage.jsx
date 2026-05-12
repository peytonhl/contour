import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { TrajectoryChart } from "../components/TrajectoryChart.jsx";
import { ReviewSection } from "../components/ReviewSection.jsx";
import { EraAdjustedStat } from "../components/EraAdjustedStat.jsx";
import { PreStreamingBanner } from "../components/PreStreamingBanner.jsx";
import { ShareButton } from "../components/ShareButton.jsx";
import { WantToListenButton } from "../components/WantToListenButton.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { analytics } from "../services/analytics.js";

const ACCENT = "#34d399";
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
            <span>Gold — 500K units</span>
            <span>Platinum — 1M units</span>
            <span>Diamond — 10M units</span>
          </div>
        </div>
      )}
    </span>
  );
}

function StatBlock({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</span>
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
          ? `Releases from ${year} predate widespread streaming adoption — historical data is often absent from our sources.`
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

  if (loading) return <div style={{ padding: 80, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Loading…</div>;
  if (error) return <div style={{ padding: 80, textAlign: "center", color: "var(--danger)", fontSize: 14 }}>Error: {error}</div>;
  if (!track) return null;

  const topCert = trajectory?.riaa_milestones?.at(-1);

  return (
    <div className="hero-page" style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column" }}>

      {/* ── Hero ── */}
      <div className="entity-hero" style={{
        padding: "36px 28px 32px",
        background: `linear-gradient(180deg, ${ACCENT}10 0%, transparent 100%)`,
        borderBottom: "1px solid var(--border)",
      }}>
        <div className="hero-row" style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
          {track.image_url
            ? <img src={track.image_url} alt={track.name} className="hero-img" style={{ width: 172, height: 172, borderRadius: 10, objectFit: "cover", flexShrink: 0, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }} />
            : <div className="hero-img" style={{ width: 172, height: 172, borderRadius: 10, background: "var(--surface2)", flexShrink: 0 }} />
          }
          <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minWidth: 0 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>Track</div>
              <h1 style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.02em", marginBottom: 6 }}>
                {track.name}
                {track.explicit && <span style={{ marginLeft: 10, fontSize: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 3, padding: "2px 6px", color: "var(--text-muted)", verticalAlign: "middle", fontWeight: 700, letterSpacing: "0.06em" }}>E</span>}
              </h1>
              <div style={{ fontSize: 15, color: "var(--text-muted)" }}>
                {track.artists?.map((artist, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    {track.artist_ids?.[i]
                      ? <Link to={`/artist/${track.artist_ids[i]}`} style={{ color: ACCENT, fontWeight: 600 }}>{artist}</Link>
                      : <span style={{ fontWeight: 600 }}>{artist}</span>}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
              <StatBlock label="Album" value={
                track.album_id
                  ? <Link to={`/album/${track.album_id}`} style={{ color: "var(--accent-a)", fontWeight: 600 }}>{track.album_name}</Link>
                  : track.album_name
              } />
              <StatBlock label="Released" value={formatReleaseDate(track.release_date)} />
              <StatBlock label="Duration" value={formatDuration(track.duration_ms)} />
              <EraAdjustedStat
                eraContext={trajectory?.era_context}
                totalStreams={trajectory?.total_streams}
                onOpen={() => analytics.eraAdjustmentViewed("track")}
              />
              {topCert && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>RIAA</span>
                    <RiaaTooltip />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: "rgba(245,158,11,0.12)", color: "var(--gold)", border: "1px solid rgba(245,158,11,0.25)", alignSelf: "flex-start" }}>
                    {topCert.label}
                  </span>
                </div>
              )}
            </div>

            <div className="hero-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
              <button
                onClick={() => document.getElementById("rate-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                style={{ padding: "8px 18px", background: ACCENT, border: "none", borderRadius: 6, color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer", letterSpacing: "0.01em" }}
              >
                ★ Rate
              </button>
              <button
                onClick={() => navigate("/compare")}
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 13, cursor: "pointer", letterSpacing: "0.01em" }}
              >
                Compare
              </button>
              <WantToListenButton entityType="track" entityId={id} />
              <ShareButton title={`${track.name} on Contour`} />
              {track.external_url && (
                <a href={track.external_url} target="_blank" rel="noreferrer"
                  onClick={() => analytics.spotifyLinkClicked("track")}
                  style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 13, display: "inline-flex", alignItems: "center", letterSpacing: "0.01em" }}>
                  Spotify ↗
                </a>
              )}
              {appleMusic?.url && (
                <a href={appleMusic.url} target="_blank" rel="noreferrer"
                  onClick={() => analytics.appleMusicLinkClicked("track")}
                  style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 13, display: "inline-flex", alignItems: "center", letterSpacing: "0.01em" }}>
                  Apple Music ↗
                </a>
              )}
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.name} ${track.artists?.[0] ?? ""}`)}`}
                target="_blank" rel="noreferrer"
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 13, display: "inline-flex", alignItems: "center", letterSpacing: "0.01em" }}
              >
                YouTube ↗
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="entity-body" style={{ padding: "28px 28px", display: "flex", flexDirection: "column", gap: 24 }}>
        <PreStreamingBanner releaseDate={track.release_date} />

        <div id="rate-section" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px", scrollMarginTop: 70 }}>
          <ReviewSection entityType="track" entityId={id} user={user} />
        </div>

        {/* Streaming trajectory — moved below the fold; era-adjustment is contextual, surfaced in the hero stat */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", margin: 0 }}>
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
