import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { TrajectoryChart } from "../components/TrajectoryChart.jsx";
import { ReviewSection } from "../components/ReviewSection.jsx";
import { EraCallout } from "../components/EraCallout.jsx";
import { PreStreamingBanner } from "../components/PreStreamingBanner.jsx";
import { ShareButton } from "../components/ShareButton.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

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
  if (parts.length === 3) {
    return `${parseInt(parts[2], 10)} ${MONTHS[parseInt(parts[1], 10) - 1]} ${parts[0]}`;
  }
  if (parts.length === 2) {
    return `${MONTHS[parseInt(parts[1], 10) - 1]} ${parts[0]}`;
  }
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
        background: "rgba(255,255,255,0.12)", color: "var(--text-muted)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "default", fontWeight: 800, lineHeight: 1, border: "1px solid var(--border)",
      }}>i</span>
      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)",
          background: "var(--surface2)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "12px 14px",
          fontSize: 12, lineHeight: 1.55, color: "var(--text)",
          width: 230, zIndex: 200,
          boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
          pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: "var(--text)" }}>RIAA Certification</div>
          <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>
            Awarded by the Recording Industry Association of America based on certified units (streams + downloads + physical sales).
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, color: "var(--gold)", fontWeight: 600 }}>
            <span>⬡ Gold — 500K units</span>
            <span>⬡ Platinum — 1M units</span>
            <span>⬡ Diamond — 10M units</span>
          </div>
        </div>
      )}
    </span>
  );
}

function StatBlock({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{value ?? "—"}</span>
    </div>
  );
}

function NoChartData({ releaseDate }) {
  const year = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) : null;
  const isEarlyEra = year && year < 2013;

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "48px 24px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 12,
      textAlign: "center",
    }}>
      <span style={{ fontSize: 32, opacity: 0.4 }}>{isEarlyEra ? "📡" : "📊"}</span>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-muted)" }}>
        No streaming data available
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 420, lineHeight: 1.6, opacity: 0.75 }}>
        {isEarlyEra
          ? `Streaming chart data isn't available for this album. Releases from ${year} predate widespread streaming adoption, so historical data is often absent from our sources.`
          : "Streaming chart data isn't available for this album yet. This can happen for albums with very few streams or those not yet indexed by our data sources."}
      </div>
    </div>
  );
}

export function AlbumPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [album, setAlbum] = useState(null);
  const [trajectory, setTrajectory] = useState(null);
  const [tracklist, setTracklist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    // Fetch album metadata first (required). Trajectory and tracklist are
    // treated as non-fatal so a Kworb or Spotify hiccup doesn't kill the page.
    api.getAlbum(id)
      .then((albumData) => {
        setAlbum(albumData);
        return Promise.allSettled([
          api.getAlbumTrajectory(id),
          api.getAlbumTracklist(id),
        ]);
      })
      .then(([trajResult, trackResult]) => {
        if (trajResult.status === "fulfilled") setTrajectory(trajResult.value);
        if (trackResult.status === "fulfilled") setTracklist(trackResult.value);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (error) return <div style={{ padding: 60, textAlign: "center", color: "var(--danger)" }}>Error: {error}</div>;
  if (!album) return null;

  const topCert = trajectory?.riaa_milestones?.at(-1);

  return (
    <div className="hero-page" style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Hero */}
      <div className="hero-row" style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {album.image_url
          ? <img src={album.image_url} alt={album.name} style={{ width: 160, height: 160, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
          : <div style={{ width: 160, height: 160, borderRadius: 10, background: "var(--surface2)", flexShrink: 0 }} />
        }
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minWidth: 0 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>{album.name}</h1>
            <div style={{ fontSize: 15, color: "var(--text-muted)" }}>
              {album.artists?.map((artist, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  {album.artist_ids?.[i]
                    ? <Link to={`/artist/${album.artist_ids[i]}`} style={{ color: "var(--accent-a)" }}>{artist}</Link>
                    : artist}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            <StatBlock label="Released" value={formatReleaseDate(album.release_date)} />
            <StatBlock label="Total Streams" value={formatStreams(trajectory?.total_streams)} />
            {topCert && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>RIAA</span>
                  <RiaaTooltip />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, padding: "2px 10px", borderRadius: 20, background: "rgba(245,158,11,0.15)", color: "var(--gold)", border: "1px solid rgba(245,158,11,0.3)", alignSelf: "flex-start" }}>
                  ⬡ {topCert.label}
                </span>
              </div>
            )}
          </div>
          <div className="hero-actions" style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
            <button
              onClick={() => navigate(`/compare`)}
              style={{ padding: "8px 18px", background: "var(--accent-a)", border: "none", borderRadius: 7, color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              Compare
            </button>
            <ShareButton title={`${album.name} on Contour`} />
            {album.external_url && (
              <a href={album.external_url} target="_blank" rel="noreferrer"
                style={{ padding: "8px 18px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", fontSize: 13, display: "inline-flex", alignItems: "center" }}>
                Spotify ↗
              </a>
            )}
            <a
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${album.name} ${album.artists?.[0] ?? ""}`)}`}
              target="_blank"
              rel="noreferrer"
              style={{ padding: "8px 18px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", fontSize: 13, display: "inline-flex", alignItems: "center" }}
            >
              YouTube ↗
            </a>
          </div>
        </div>
      </div>

      {/* Pre-streaming era notice */}
      <PreStreamingBanner releaseDate={album.release_date} />

      {/* Era context */}
      <EraCallout eraContext={trajectory?.era_context} totalStreams={trajectory?.total_streams} />

      {/* Trajectory */}
      {trajectory?.trajectory?.length > 0 ? (
        <TrajectoryChart
          trajectory={trajectory.trajectory}
          milestones={trajectory.riaa_milestones}
          accentColor="var(--accent-a)"
          disclaimer={trajectory.stream_source !== "kworb" ? DISCLAIMER : undefined}
        />
      ) : (
        <NoChartData releaseDate={album.release_date} />
      )}

      {/* Ratings & Reviews */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
        <ReviewSection entityType="album" entityId={id} user={user} />
      </div>

      {/* Tracklist */}
      {tracklist.length > 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Tracklist
          </div>
          {tracklist.map((track, i) => (
            <Link
              key={track.id}
              to={`/track/${track.id}`}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "12px 20px",
                borderBottom: i < tracklist.length - 1 ? "1px solid var(--border)" : "none",
                textDecoration: "none",
                color: "var(--text)",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ width: 24, textAlign: "right", fontSize: 13, color: "var(--text-muted)", flexShrink: 0 }}>{track.track_number}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {track.name}
                {track.explicit && <span style={{ marginLeft: 6, fontSize: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 4px", color: "var(--text-muted)", verticalAlign: "middle" }}>E</span>}
              </span>
              <span style={{ fontSize: 13, color: "var(--text-muted)", flexShrink: 0 }}>{formatDuration(track.duration_ms)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
