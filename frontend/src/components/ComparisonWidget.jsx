import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { AlbumSearch } from "./AlbumSearch.jsx";
import { TrackSearch } from "./TrackSearch.jsx";
import { AlbumCard } from "./AlbumCard.jsx";
import { ComparisonChart } from "./ComparisonChart.jsx";
import { EditionPicker } from "./EditionPicker.jsx";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";
const POLL_INTERVAL = 4000;

export function ComparisonWidget({ initialAlbumA = null, initialAlbumB = null }) {
  const [modeA, setModeA] = useState("album");
  const [modeB, setModeB] = useState("album");
  const [albumA, setAlbumA] = useState(initialAlbumA);
  const [albumB, setAlbumB] = useState(initialAlbumB);
  const [trackA, setTrackA] = useState(null);
  const [trackB, setTrackB] = useState(null);
  const [editionsA, setEditionsA] = useState(initialAlbumA ? [initialAlbumA.id] : []);
  const [editionsB, setEditionsB] = useState(initialAlbumB ? [initialAlbumB.id] : []);

  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [error, setError] = useState(null);
  const [enriching, setEnriching] = useState(false);

  const pollRef = useRef(null);

  // Update slots when initialAlbumA/B props change (e.g. artist page pre-fills)
  useEffect(() => {
    if (initialAlbumA) { setAlbumA(initialAlbumA); setEditionsA([initialAlbumA.id]); }
  }, [initialAlbumA?.id]);
  useEffect(() => {
    if (initialAlbumB) { setAlbumB(initialAlbumB); setEditionsB([initialAlbumB.id]); }
  }, [initialAlbumB?.id]);

  useEffect(() => {
    if (!comparison?.enrichment_pending) {
      clearInterval(pollRef.current);
      setEnriching(false);
      return;
    }
    setEnriching(true);
    pollRef.current = setInterval(async () => {
      try {
        const fetchA = comparison.album_a.entity_type === "track"
          ? api.getTrackStreams(comparison.album_a.id)
          : api.getStreams(comparison.album_a.id);
        const fetchB = comparison.album_b.entity_type === "track"
          ? api.getTrackStreams(comparison.album_b.id)
          : api.getStreams(comparison.album_b.id);
        const [sa, sb] = await Promise.all([fetchA, fetchB]);
        if (sa.enrichment_status !== "pending" && sb.enrichment_status !== "pending") {
          clearInterval(pollRef.current);
          const fresh = await api.compare(comparison.album_a.id, comparison.album_b.id, {
            editionIdsA: comparison.album_a.entity_type === "album" && editionsA.length ? editionsA : null,
            editionIdsB: comparison.album_b.entity_type === "album" && editionsB.length ? editionsB : null,
            trackIdA: comparison.album_a.entity_type === "track" ? comparison.album_a.id : null,
            trackIdB: comparison.album_b.entity_type === "track" ? comparison.album_b.id : null,
          });
          setComparison(fresh);
          setEnriching(false);
        }
      } catch {
        clearInterval(pollRef.current);
        setEnriching(false);
      }
    }, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [comparison?.enrichment_pending, comparison?.album_a?.id, comparison?.album_b?.id]);

  async function runComparison() {
    const entityA = modeA === "track" ? trackA : albumA;
    const entityB = modeB === "track" ? trackB : albumB;
    if (!entityA || !entityB) return;
    setLoading(true);
    setError(null);
    setSavedId(null);
    try {
      const data = await api.compare(entityA.id, entityB.id, {
        editionIdsA: modeA === "album" && editionsA.length ? editionsA : null,
        editionIdsB: modeB === "album" && editionsB.length ? editionsB : null,
        trackIdA: modeA === "track" ? entityA.id : null,
        trackIdB: modeB === "track" ? entityB.id : null,
      });
      setComparison(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveComparison() {
    if (!comparison) return;
    setSaving(true);
    try {
      const { id } = await api.saveComparison({
        result: comparison,
        name_a: comparison.album_a.name,
        name_b: comparison.album_b.name,
      });
      setSavedId(id);
    } catch {
      // silently fail — share button just won't show a link
    } finally {
      setSaving(false);
    }
  }

  const entityA = modeA === "track" ? trackA : albumA;
  const entityB = modeB === "track" ? trackB : albumB;
  const canCompare = entityA && entityB && !loading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Search slots */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[
          { mode: modeA, setMode: setModeA, album: albumA, setAlbum: setAlbumA, track: trackA, setTrack: setTrackA, setEditions: setEditionsA, accent: ACCENT_A, label: "A" },
          { mode: modeB, setMode: setModeB, album: albumB, setAlbum: setAlbumB, track: trackB, setTrack: setTrackB, setEditions: setEditionsB, accent: ACCENT_B, label: "B" },
        ].map(({ mode, setMode, album, setAlbum, track, setTrack, setEditions, accent, label }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 7, overflow: "hidden", border: "1px solid var(--border)", alignSelf: "flex-start" }}>
              {["album", "track"].map((m) => (
                <button key={m} onClick={() => { setMode(m); setAlbum(null); setTrack(null); setEditions([]); }} style={{
                  padding: "5px 14px", fontSize: 12, fontWeight: mode === m ? 700 : 400,
                  background: mode === m ? accent : "transparent",
                  color: mode === m ? "#000" : "var(--text-muted)",
                  border: "none", cursor: "pointer", textTransform: "capitalize", transition: "all 0.15s",
                }}>{m}</button>
              ))}
            </div>
            {mode === "album" ? (
              <>
                <AlbumSearch label={`Album ${label}`} accentColor={accent} selected={album}
                  onSelect={(a) => { setAlbum(a); setEditions(a ? [a.id] : []); }} />
                <EditionPicker album={album} accentColor={accent} onEditionsChange={setEditions} />
              </>
            ) : (
              <TrackSearch label={`Track ${label}`} accentColor={accent} selected={track} onSelect={setTrack} />
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={runComparison} disabled={!canCompare} style={{
          padding: "12px 28px",
          background: "linear-gradient(135deg, var(--accent-a), var(--accent-b))",
          border: "none", borderRadius: 8, color: "#000", fontWeight: 700, fontSize: 14,
          opacity: canCompare ? 1 : 0.4, cursor: canCompare ? "pointer" : "default",
        }}>Compare</button>

        {comparison && !loading && (
          savedId ? (
            <Link to={`/compare/${savedId}`} style={{
              padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)",
              borderRadius: 8, color: "var(--accent-a)", fontSize: 13, fontWeight: 600,
            }}>
              Shareable link ↗
            </Link>
          ) : (
            <button onClick={saveComparison} disabled={saving} style={{
              padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)",
              borderRadius: 8, color: "var(--text-muted)", fontSize: 13, cursor: "pointer",
            }}>
              {saving ? "Saving…" : "Share"}
            </button>
          )
        )}

        {enriching && (
          <span style={{ fontSize: 12, color: ACCENT_B, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
            Enriching stream counts from Kworb…
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: "14px 16px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, color: "var(--danger)", fontSize: 13 }}>
          Error: {error}
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: 40, color: "var(--text-muted)", fontSize: 14 }}>
          Building comparison…
        </div>
      )}

      {comparison && !loading && (
        <>
          <ComparisonChart data={comparison} nameA={comparison.album_a.name} nameB={comparison.album_b.name} disclaimer={comparison.data_disclaimer} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <AlbumCard meta={comparison.album_a} accentColor={ACCENT_A} enriching={enriching}
              detailLink={comparison.album_a.entity_type === "track" ? `/track/${comparison.album_a.id}` : `/album/${comparison.album_a.id}`} />
            <AlbumCard meta={comparison.album_b} accentColor={ACCENT_B} enriching={enriching}
              detailLink={comparison.album_b.entity_type === "track" ? `/track/${comparison.album_b.id}` : `/album/${comparison.album_b.id}`} />
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
