import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { UnifiedSearch } from "./UnifiedSearch.jsx";
import { AlbumCard } from "./AlbumCard.jsx";
import { ComparisonChart } from "./ComparisonChart.jsx";
import { EditionPicker } from "./EditionPicker.jsx";

const ACCENT_A = "#d97a3b";
const ACCENT_B = "#6a90b5";
const ACCENT_C = "#fb923c"; // orange — third overlay series
const POLL_INTERVAL = 4000;

// Tag an existing album object (from props) with _type so it fits the unified selection shape
function tagAlbum(album) {
  return album ? { ...album, _type: "album" } : null;
}

export function ComparisonWidget({
  initialAlbumA = null,
  initialAlbumB = null,
  preloadedAlbumAId = null,
  preloadedAlbumBId = null,
  preloadedAlbumCId = null,
}) {
  const [selectionA, setSelectionA] = useState(tagAlbum(initialAlbumA));
  const [selectionB, setSelectionB] = useState(tagAlbum(initialAlbumB));
  const [selectionC, setSelectionC] = useState(null);
  const [editionsA, setEditionsA] = useState(initialAlbumA ? [initialAlbumA.id] : []);
  const [editionsB, setEditionsB] = useState(initialAlbumB ? [initialAlbumB.id] : []);
  const [editionsC, setEditionsC] = useState([]);

  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [error, setError] = useState(null);
  const [enriching, setEnriching] = useState(false);

  const pollRef = useRef(null);
  const autoRunRef = useRef(false); // prevent double-firing auto-run

  // Fetch and pre-fill slots from URL query param IDs — sequential to avoid Spotify rate-limiting
  useEffect(() => {
    autoRunRef.current = false;
    setComparison(null);
    setSavedId(null);
    // Clear all slots immediately so stale selections don't trigger the auto-run
    // before the new albums finish loading
    setSelectionA(null);
    setSelectionB(null);
    setSelectionC(null);

    if (!preloadedAlbumAId) return;

    let cancelled = false;

    async function loadPreloaded() {
      // Fetch A first, then B, then C — never in parallel so Spotify doesn't rate-limit follow-up calls
      try {
        const metaA = await api.getAlbum(preloadedAlbumAId);
        if (!cancelled && metaA) {
          setSelectionA({ ...metaA, _type: "album" });
          setEditionsA([metaA.id]);
        }
      } catch { /* silently skip */ }

      if (!preloadedAlbumBId) return;

      try {
        const metaB = await api.getAlbum(preloadedAlbumBId);
        if (!cancelled && metaB) {
          setSelectionB({ ...metaB, _type: "album" });
          setEditionsB([metaB.id]);
        }
      } catch { /* silently skip */ }

      if (!preloadedAlbumCId) return;

      try {
        const metaC = await api.getAlbum(preloadedAlbumCId);
        if (!cancelled && metaC) {
          setSelectionC({ ...metaC, _type: "album" });
          setEditionsC([metaC.id]);
        }
      } catch { /* silently skip */ }
    }

    loadPreloaded();
    return () => { cancelled = true; };
  }, [preloadedAlbumAId, preloadedAlbumBId, preloadedAlbumCId]);

  // Update slots when initialAlbumA/B props change (e.g. artist page pre-fills)
  useEffect(() => {
    if (initialAlbumA) { setSelectionA(tagAlbum(initialAlbumA)); setEditionsA([initialAlbumA.id]); }
  }, [initialAlbumA?.id]);
  useEffect(() => {
    if (initialAlbumB) { setSelectionB(tagAlbum(initialAlbumB)); setEditionsB([initialAlbumB.id]); }
  }, [initialAlbumB?.id]);

  // Auto-run comparison when slots are filled from URL params. We wait for C
  // to finish loading too when it was requested, otherwise it'd be missing
  // from the auto-run result.
  useEffect(() => {
    if (!preloadedAlbumAId || !preloadedAlbumBId) return; // only auto-run for full preloads
    if (!selectionA || !selectionB) return;               // wait until both loaded
    if (preloadedAlbumCId && !selectionC) return;         // also wait for C if requested
    if (autoRunRef.current) return;                       // don't re-run on subsequent changes
    autoRunRef.current = true;
    setLoading(true);
    setError(null);
    api.compare(selectionA.id, selectionB.id, selectionC?.id ?? null, {
      editionIdsA: [selectionA.id],
      editionIdsB: [selectionB.id],
      editionIdsC: selectionC ? [selectionC.id] : null,
    })
      .then(setComparison)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectionA?.id, selectionB?.id, selectionC?.id]);

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
  function handleSelectC(item) {
    setSelectionC(item);
    setEditionsC(item?._type === "album" ? [item.id] : []);
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
        const fetchC = comparison.album_c
          ? (comparison.album_c.entity_type === "track"
              ? api.getTrackStreams(comparison.album_c.id)
              : api.getStreams(comparison.album_c.id))
          : Promise.resolve({ enrichment_status: "done" });
        const [sa, sb, sc] = await Promise.all([fetchA, fetchB, fetchC]);
        if (sa.enrichment_status !== "pending" && sb.enrichment_status !== "pending" && sc.enrichment_status !== "pending") {
          clearInterval(pollRef.current);
          const fresh = await api.compare(
            comparison.album_a.id,
            comparison.album_b.id,
            comparison.album_c?.id ?? null,
            {
              editionIdsA: comparison.album_a.entity_type === "album" && editionsA.length ? editionsA : null,
              editionIdsB: comparison.album_b.entity_type === "album" && editionsB.length ? editionsB : null,
              editionIdsC: comparison.album_c && comparison.album_c.entity_type === "album" && editionsC.length ? editionsC : null,
              trackIdA: comparison.album_a.entity_type === "track" ? comparison.album_a.id : null,
              trackIdB: comparison.album_b.entity_type === "track" ? comparison.album_b.id : null,
              trackIdC: comparison.album_c?.entity_type === "track" ? comparison.album_c.id : null,
            },
          );
          setComparison(fresh);
          setEnriching(false);
        }
      } catch {
        clearInterval(pollRef.current);
        setEnriching(false);
      }
    }, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [comparison?.enrichment_pending, comparison?.album_a?.id, comparison?.album_b?.id, comparison?.album_c?.id]);

  async function runComparison() {
    if (!selectionA || !selectionB) return;
    setLoading(true);
    setError(null);
    setSavedId(null);
    try {
      const data = await api.compare(selectionA.id, selectionB.id, selectionC?.id ?? null, {
        editionIdsA: selectionA._type === "album" && editionsA.length ? editionsA : null,
        editionIdsB: selectionB._type === "album" && editionsB.length ? editionsB : null,
        editionIdsC: selectionC && selectionC._type === "album" && editionsC.length ? editionsC : null,
        trackIdA: selectionA._type === "track" ? selectionA.id : null,
        trackIdB: selectionB._type === "track" ? selectionB.id : null,
        trackIdC: selectionC?._type === "track" ? selectionC.id : null,
      });
      analytics.comparisonCreated();
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
        name_c: comparison.album_c?.name ?? null,
      });
      setSavedId(id);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  const canCompare = selectionA && selectionB && !loading;
  const hasThreeWay = !!comparison?.album_c;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Search slots — three columns on desktop, stacked on mobile (via .compare-grid-3). */}
      <div className="compare-grid-3">
        {[
          { sel: selectionA, onSelect: handleSelectA, editions: editionsA, setEditions: setEditionsA, accent: ACCENT_A, label: "A" },
          { sel: selectionB, onSelect: handleSelectB, editions: editionsB, setEditions: setEditionsB, accent: ACCENT_B, label: "B" },
          { sel: selectionC, onSelect: handleSelectC, editions: editionsC, setEditions: setEditionsC, accent: ACCENT_C, label: "C", optional: true },
        ].map(({ sel, onSelect, editions, setEditions, accent, label, optional }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <UnifiedSearch
              label={optional ? `Side ${label} (optional)` : `Side ${label}`}
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
            nameC={comparison.album_c?.name}
            disclaimer={comparison.data_disclaimer}
          />
          <div className={hasThreeWay ? "compare-grid-3" : "compare-grid"}>
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
            {comparison.album_c && (
              <AlbumCard
                meta={comparison.album_c}
                accentColor={ACCENT_C}
                enriching={enriching}
                detailLink={comparison.album_c.entity_type === "track" ? `/track/${comparison.album_c.id}` : `/album/${comparison.album_c.id}`}
              />
            )}
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
