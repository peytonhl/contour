import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { UnifiedSearch } from "./UnifiedSearch.jsx";
import { AlbumCard } from "./AlbumCard.jsx";
import { ComparisonChart } from "./ComparisonChart.jsx";
import { EditionPicker } from "./EditionPicker.jsx";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";
const POLL_INTERVAL = 4000;

// Tag an existing album object (from props) with _type so it fits the unified selection shape
function tagAlbum(album) {
  return album ? { ...album, _type: "album" } : null;
}

export function ComparisonWidget({ initialAlbumA = null, initialAlbumB = null, preloadedAlbumAId = null, preloadedAlbumBId = null }) {
  const [selectionA, setSelectionA] = useState(tagAlbum(initialAlbumA));
  const [selectionB, setSelectionB] = useState(tagAlbum(initialAlbumB));
  const [editionsA, setEditionsA] = useState(initialAlbumA ? [initialAlbumA.id] : []);
  const [editionsB, setEditionsB] = useState(initialAlbumB ? [initialAlbumB.id] : []);

  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [error, setError] = useState(null);
  const [enriching, setEnriching] = useState(false);

  const pollRef = useRef(null);

  // Fetch and pre-fill slots from URL query param IDs (from leaderboard Compare button or suggested matchups)
  useEffect(() => {
    if (!preloadedAlbumAId) return;
    api.getAlbum(preloadedAlbumAId).then((meta) => {
      if (meta) { setSelectionA({ ...meta, _type: "album" }); setEditionsA([meta.id]); }
    }).catch(() => {});
  }, [preloadedAlbumAId]);

  useEffect(() => {
    if (!preloadedAlbumBId) return;
    api.getAlbum(preloadedAlbumBId).then((meta) => {
      if (meta) { setSelectionB({ ...meta, _type: "album" }); setEditionsB([meta.id]); }
    }).catch(() => {});
  }, [preloadedAlbumBId]);

  // Update slots when initialAlbumA/B props change (e.g. artist page pre-fills)
  useEffect(() => {
    if (initialAlbumA) { setSelectionA(tagAlbum(initialAlbumA)); setEditionsA([initialAlbumA.id]); }
  }, [initialAlbumA?.id]);
  useEffect(() => {
    if (initialAlbumB) { setSelectionB(tagAlbum(initialAlbumB)); setEditionsB([initialAlbumB.id]); }
  }, [initialAlbumB?.id]);

  // Reset editions when selection changes type or identity
  function handleSelectA(item) {
    setSelectionA(item);
    setEditionsA(item?._type === "album" ? [item.id] : []);
    setComparison(null);
    setSavedId(null);
  }
  function handleSelectB(item) {
    setSelectionB(item);
    setEditionsB(item?._type === "album" ? [item.id] : []);
    setComparison(null);
    setSavedId(null);
  }

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
    if (!selectionA || !selectionB) return;
    setLoading(true);
    setError(null);
    setSavedId(null);
    try {
      const data = await api.compare(selectionA.id, selectionB.id, {
        editionIdsA: selectionA._type === "album" && editionsA.length ? editionsA : null,
        editionIdsB: selectionB._type === "album" && editionsB.length ? editionsB : null,
        trackIdA: selectionA._type === "track" ? selectionA.id : null,
        trackIdB: selectionB._type === "track" ? selectionB.id : null,
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
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  const canCompare = selectionA && selectionB && !loading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Search slots */}
      <div className="compare-grid">
        {[
          { sel: selectionA, onSelect: handleSelectA, editions: editionsA, setEditions: setEditionsA, accent: ACCENT_A, label: "A" },
          { sel: selectionB, onSelect: handleSelectB, editions: editionsB, setEditions: setEditionsB, accent: ACCENT_B, label: "B" },
        ].map(({ sel, onSelect, editions, setEditions, accent, label }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <UnifiedSearch
              label={`Side ${label}`}
              accentColor={accent}
              selected={sel}
              onSelect={onSelect}
            />
            {/* Edition picker only for album selections */}
            {sel?._type === "album" && (
              <EditionPicker
                album={sel}
                accentColor={accent}
                onEditionsChange={setEditions}
              />
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={runComparison}
          disabled={!canCompare}
          style={{
            padding: "12px 28px",
            background: "linear-gradient(135deg, var(--accent-a), var(--accent-b))",
            border: "none", borderRadius: 8, color: "#000", fontWeight: 700, fontSize: 14,
            opacity: canCompare ? 1 : 0.4, cursor: canCompare ? "pointer" : "default",
          }}
        >
          Compare
        </button>

        {comparison && !loading && (
          savedId ? (
            <Link
              to={`/compare/${savedId}`}
              style={{
                padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)",
                borderRadius: 8, color: ACCENT_A, fontSize: 13, fontWeight: 600, textDecoration: "none",
              }}
            >
              Shareable link ↗
            </Link>
          ) : (
            <button
              onClick={saveComparison}
              disabled={saving}
              style={{
                padding: "10px 18px", background: "var(--surface2)", border: "1px solid var(--border)",
                borderRadius: 8, color: "var(--text-muted)", fontSize: 13, cursor: "pointer",
              }}
            >
              {saving ? "Saving…" : "Share"}
            </button>
          )
        )}

        {enriching && (
          <span style={{ fontSize: 12, color: ACCENT_B, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
            Enriching stream counts…
          </span>
        )}
      </div>

      {error && (
        <div style={{
          padding: "14px 16px", background: "rgba(248,113,113,0.1)",
          border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8,
          color: "var(--danger)", fontSize: 13,
        }}>
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
          <ComparisonChart
            data={comparison}
            nameA={comparison.album_a.name}
            nameB={comparison.album_b.name}
            disclaimer={comparison.data_disclaimer}
          />
          <div className="compare-grid">
            <AlbumCard
              meta={comparison.album_a}
              accentColor={ACCENT_A}
              enriching={enriching}
              detailLink={comparison.album_a.entity_type === "track" ? `/track/${comparison.album_a.id}` : `/album/${comparison.album_a.id}`}
            />
            <AlbumCard
              meta={comparison.album_b}
              accentColor={ACCENT_B}
              enriching={enriching}
              detailLink={comparison.album_b.entity_type === "track" ? `/track/${comparison.album_b.id}` : `/album/${comparison.album_b.id}`}
            />
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
