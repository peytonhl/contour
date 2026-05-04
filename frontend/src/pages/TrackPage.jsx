import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { TrajectoryChart } from "../components/TrajectoryChart.jsx";
import { ReviewSection } from "../components/ReviewSection.jsx";
import { EraCallout } from "../components/EraCallout.jsx";
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
  if (!ms) return "—";
  const m = Math.floor(ms / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${m}:${s}`;
}

function StatBlock({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{value ?? "—"}</span>
    </div>
  );
}

export function TrackPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [track, setTrack] = useState(null);
  const [trajectory, setTrajectory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.getTrack(id),
      api.getTrackTrajectory(id),
    ])
      .then(([trackData, trajData]) => {
        setTrack(trackData);
        setTrajectory(trajData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (error) return <div style={{ padding: 60, textAlign: "center", color: "var(--danger)" }}>Error: {error}</div>;
  if (!track) return null;

  const topCert = trajectory?.riaa_milestones?.at(-1);

  return (
    <div className="hero-page" style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Hero */}
      <div className="hero-row" style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {track.image_url
          ? <img src={track.image_url} alt={track.name} style={{ width: 160, height: 160, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
          : <div style={{ width: 160, height: 160, borderRadius: 10, background: "var(--surface2)", flexShrink: 0 }} />
        }
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minWidth: 0 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Track</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>
              {track.name}
              {track.explicit && <span style={{ marginLeft: 10, fontSize: 11, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", color: "var(--text-muted)", verticalAlign: "middle", fontWeight: 600 }}>EXPLICIT</span>}
            </h1>
            <div style={{ fontSize: 15, color: "var(--text-muted)" }}>
              {track.artists?.map((artist, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  {track.artist_ids?.[i]
                    ? <Link to={`/artist/${track.artist_ids[i]}`} style={{ color: "var(--accent-a)" }}>{artist}</Link>
                    : artist}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            <StatBlock label="Album" value={
              track.album_id
                ? <Link to={`/album/${track.album_id}`} style={{ color: "var(--accent-b)" }}>{track.album_name}</Link>
                : track.album_name
            } />
            <StatBlock label="Released" value={track.release_date} />
            <StatBlock label="Duration" value={formatDuration(track.duration_ms)} />
            <StatBlock label="Total Streams" value={formatStreams(trajectory?.total_streams)} />
            {topCert && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" }}>RIAA</span>
                <span style={{ fontSize: 13, fontWeight: 600, padding: "2px 10px", borderRadius: 20, background: "rgba(245,158,11,0.15)", color: "var(--gold)", border: "1px solid rgba(245,158,11,0.3)", alignSelf: "flex-start" }}>
                  ⬡ {topCert.label}
                </span>
              </div>
            )}
          </div>

          <div className="hero-actions" style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
            <button
              onClick={() => navigate("/compare")}
              style={{ padding: "8px 18px", background: "var(--accent-b)", border: "none", borderRadius: 7, color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              Compare
            </button>
            <ShareButton title={`${track.name} on Contour`} />
            {track.external_url && (
              <a href={track.external_url} target="_blank" rel="noreferrer"
                style={{ padding: "8px 18px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", fontSize: 13, display: "inline-flex", alignItems: "center" }}>
                Spotify ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Era context */}
      <EraCallout eraContext={trajectory?.era_context} totalStreams={trajectory?.total_streams} />

      {/* Ratings & Reviews */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
        <ReviewSection entityType="track" entityId={id} user={user} />
      </div>

      {/* Trajectory */}
      {trajectory && (
        <TrajectoryChart
          trajectory={trajectory.trajectory}
          milestones={trajectory.riaa_milestones}
          accentColor="var(--accent-b)"
          disclaimer={trajectory.stream_source !== "kworb" ? DISCLAIMER : undefined}
        />
      )}
    </div>
  );
}
