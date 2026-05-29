import { useState, useEffect, useRef } from "react";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { UnifiedSearch } from "./UnifiedSearch.jsx";
import { AlbumCard } from "./AlbumCard.jsx";
import { ComparisonChart } from "./ComparisonChart.jsx";
import { EditionPicker } from "./EditionPicker.jsx";
import { CardPreviewModal } from "./CardPreviewModal.jsx";
import { logSilentError } from "../utils/observability.js";
import { ACCENT_A, ACCENT_B, ACCENT_C, DANGER } from "../theme.js";
import { albumPath, trackPath, savedComparePath } from "../constants/routes.js";
const POLL_INTERVAL = 4000;

// Turn a raw thrown-error message into something a user can act on. The most
// common compare failures are transient — a browser-level "Failed to fetch"
// (network blip / gateway hiccup / dropped connection) or our own request
// timeout, both usually a brief Spotify rate-limit on the backend. Surface a
// reassuring, retry-oriented message for those instead of the raw string.
function friendlyError(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("failed to fetch") || m.includes("timed out") || m.includes("networkerror") || m.includes("load failed")) {
    return "Couldn't reach the server just now — this is usually a brief hiccup. Give it a moment and try again.";
  }
  if (m.includes("not found") || m.includes("404")) {
    return "Couldn't pull stream data for one of these picks yet. Try again in a moment, or swap in a different album or track.";
  }
  if (m.includes("before 2006") || m.includes("422")) {
    return message; // these 422s are already user-friendly copy from the backend
  }
  return `Something went wrong building this comparison (${message}). Try again.`;
}

// Tag an existing album object (from props) with _type so it fits the unified selection shape
function tagAlbum(album) {
  return album ? { ...album, _type: "album" } : null;
}

// Saves the current comparison on click, then opens CardPreviewModal pointing
// at the OG renderer. Same UX SavedComparisonPage uses (preview the PNG, then
// share/save). Replaces the older two-state "Share" / "Shareable link ↗" flow
// where a successful save just swapped a small pill nobody noticed, and any
// failure produced nothing-happens-on-tap. Errors are surfaced inline rather
// than swallowed — the modal does the rest. The button takes the full
// comparison object so it can build the share label and pass the saved id
// down to the modal.
function ShareCardButton({ comparison, disabled }) {
  const [savedId, setSavedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);

  async function onClick() {
    if (busy || disabled) return;
    setError(null);
    if (savedId) { setOpen(true); return; }
    setBusy(true);
    try {
      const { id } = await api.saveComparison({
        result: comparison,
        name_a: comparison.album_a.name,
        name_b: comparison.album_b.name,
        name_c: comparison.album_c?.name ?? null,
      });
      analytics.comparisonShared(comparison.album_c ? 3 : 2);
      setSavedId(id);
      setOpen(true);
    } catch (e) {
      setError(e?.message || "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const label =
    `${comparison.album_a.name} vs ${comparison.album_b.name}` +
    (comparison.album_c ? ` vs ${comparison.album_c.name}` : "") +
    " on Contour";

  return (
    <>
      <button
        onClick={onClick}
        disabled={disabled || busy}
        style={{
          padding: "12px 20px",
          background: ACCENT_A,
          border: "none", borderRadius: "var(--radius-md)",
          color: "#000", fontWeight: 700, fontSize: 14,
          cursor: (disabled || busy) ? "default" : "pointer",
          opacity: (disabled || busy) ? 0.6 : 1,
        }}
      >
        {busy ? "Generating…" : "Share card"}
      </button>
      {error && (
        <span style={{ color: "var(--danger)", fontSize: 12 }}>
          {error}
        </span>
      )}
      {savedId && (
        <CardPreviewModal
          open={open}
          onClose={() => setOpen(false)}
          cardUrl={`${window.location.origin}/api/og/comparison?id=${savedId}`}
          shareUrl={`${window.location.origin}${savedComparePath(savedId)}`}
          shareText={label}
          fileName={`contour-comparison-${savedId}.png`}
        />
      )}
    </>
  );
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
  const [error, setError] = useState(null);
  const [enriching, setEnriching] = useState(false);

  const pollRef = useRef(null);
  const autoRunRef = useRef(false); // prevent double-firing auto-run

  // Fetch and pre-fill slots from URL query param IDs — sequential to avoid Spotify rate-limiting
  useEffect(() => {
    autoRunRef.current = false;
    setComparison(null);
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
      } catch (e) {
        logSilentError("compare_preload_album_a", e, { album_id: preloadedAlbumAId });
      }

      if (!preloadedAlbumBId) return;

      try {
        const metaB = await api.getAlbum(preloadedAlbumBId);
        if (!cancelled && metaB) {
          setSelectionB({ ...metaB, _type: "album" });
          setEditionsB([metaB.id]);
        }
      } catch (e) {
        logSilentError("compare_preload_album_b", e, { album_id: preloadedAlbumBId });
      }

      if (!preloadedAlbumCId) return;

      try {
        const metaC = await api.getAlbum(preloadedAlbumCId);
        if (!cancelled && metaC) {
          setSelectionC({ ...metaC, _type: "album" });
          setEditionsC([metaC.id]);
        }
      } catch (e) {
        logSilentError("compare_preload_album_c", e, { album_id: preloadedAlbumCId });
      }
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
  }
  function handleSelectB(item) {
    setSelectionB(item);
    setEditionsB(item?._type === "album" ? [item.id] : []);
    setComparison(null);
  }
  function handleSelectC(item) {
    setSelectionC(item);
    setEditionsC(item?._type === "album" ? [item.id] : []);
    setComparison(null);
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
            border: "none", borderRadius: "var(--radius-md)", color: "#000", fontWeight: 700, fontSize: 14,
            opacity: canCompare ? 1 : 0.4, cursor: canCompare ? "pointer" : "default",
          }}
        >
          Compare
        </button>

        {/* Share card — visible once a comparison exists and isn't still
            enriching (sharing a half-rendered trajectory would be a worse
            artifact than no share). The button saves the comparison on
            click and opens CardPreviewModal with the OG-rendered PNG. */}
        {comparison && !loading && (
          <ShareCardButton
            key={`${comparison.album_a.id}|${comparison.album_b.id}|${comparison.album_c?.id ?? ""}`}
            comparison={comparison}
            disabled={enriching}
          />
        )}

        {enriching && (
          <span style={{ fontSize: 12, color: ACCENT_B, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
            Enriching stream counts…
          </span>
        )}
      </div>

      {error && !loading && (
        <div style={{
          padding: "14px 16px", background: `${DANGER}1a`,
          border: `1px solid ${DANGER}4d`, borderRadius: "var(--radius-md)",
          color: "var(--danger)", fontSize: 13,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ lineHeight: 1.5 }}>{friendlyError(error)}</div>
          {canCompare && (
            <div>
              <button
                onClick={runComparison}
                style={{
                  padding: "8px 18px", background: "transparent",
                  border: `1px solid ${DANGER}`, borderRadius: "var(--radius-sm)",
                  color: "var(--danger)", fontWeight: 600, fontSize: 13, cursor: "pointer",
                }}
              >
                Try again
              </button>
            </div>
          )}
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
              detailLink={comparison.album_a.entity_type === "track" ? trackPath(comparison.album_a.id) : albumPath(comparison.album_a.id)}
            />
            <AlbumCard
              meta={comparison.album_b}
              accentColor={ACCENT_B}
              enriching={enriching}
              detailLink={comparison.album_b.entity_type === "track" ? trackPath(comparison.album_b.id) : albumPath(comparison.album_b.id)}
            />
            {comparison.album_c && (
              <AlbumCard
                meta={comparison.album_c}
                accentColor={ACCENT_C}
                enriching={enriching}
                detailLink={comparison.album_c.entity_type === "track" ? trackPath(comparison.album_c.id) : albumPath(comparison.album_c.id)}
              />
            )}
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
