import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api.js";
import { ComparisonChart } from "../components/ComparisonChart.jsx";
import { AlbumCard } from "../components/AlbumCard.jsx";

const ACCENT_A = "#d97a3b";
const ACCENT_B = "#6a90b5";
const ACCENT_C = "#fb923c";

// Share the comparison as a card image via the Vercel-OG renderer. Mirrors
// the review-card share flow: try Web Share Level 2 (file share via
// navigator.share({ files })) first, fall back to URL share, then
// clipboard. Works on iOS 14.3+, Android Chrome 89+, and both Capacitor
// WebViews — no platform-specific code.
async function shareComparisonCard(comparisonId, label) {
  const reviewUrl = `${window.location.origin}/compare/${comparisonId}`;
  const cardUrl   = `${window.location.origin}/api/og/comparison?id=${comparisonId}`;

  if (navigator.canShare && navigator.share) {
    try {
      const res = await fetch(cardUrl);
      if (res.ok) {
        const blob = await res.blob();
        const file = new File([blob], `contour-comparison-${comparisonId}.png`, { type: blob.type || "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: label, url: reviewUrl });
          return "shared";
        }
      }
    } catch { /* fall through */ }
  }

  if (navigator.share) {
    try { await navigator.share({ url: reviewUrl, text: label }); return "shared"; }
    catch { /* fall through */ }
  }
  try {
    await navigator.clipboard.writeText(reviewUrl);
    return "copied";
  } catch {
    return "failed";
  }
}

function ShareCardButton({ id, label }) {
  const [state, setState] = useState("idle"); // idle | sharing | copied
  async function onClick() {
    setState("sharing");
    const result = await shareComparisonCard(id, label);
    setState(result === "copied" ? "copied" : "idle");
    if (result === "copied") setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button
      onClick={onClick}
      disabled={state === "sharing"}
      style={{
        padding: "8px 16px",
        background: state === "copied" ? "var(--surface2)" : ACCENT_A,
        border: "none",
        borderRadius: "var(--radius-sm)",
        color: state === "copied" ? "var(--text-muted)" : "#000",
        fontSize: 13, fontWeight: 700,
        cursor: state === "sharing" ? "default" : "pointer",
        opacity: state === "sharing" ? 0.6 : 1,
      }}
    >
      {state === "copied" ? "Link copied" : state === "sharing" ? "Preparing…" : "Share card"}
    </button>
  );
}

export function SavedComparisonPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getComparison(id)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (error) return <div style={{ padding: 60, textAlign: "center", color: "var(--danger)" }}>Not found</div>;
  if (!data) return null;

  const { result } = data;
  const hasThreeWay = !!result.album_c;
  const shareLabel = `${data.name_a} vs ${data.name_b}${data.name_c ? ` vs ${data.name_c}` : ""} on Contour`;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>
            {data.name_a} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>vs</span> {data.name_b}
            {data.name_c && (
              <>
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> vs</span> {data.name_c}
              </>
            )}
          </h1>
          {data.created_at && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Saved {new Date(data.created_at).toLocaleDateString()}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ShareCardButton id={id} label={shareLabel} />
          <Link to="/compare" style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", fontSize: 13, textDecoration: "none" }}>
            Run a new comparison
          </Link>
        </div>
      </div>

      <ComparisonChart
        data={result}
        nameA={result.album_a.name}
        nameB={result.album_b.name}
        nameC={result.album_c?.name}
        disclaimer={result.data_disclaimer}
      />

      <div className={hasThreeWay ? "compare-grid-3" : "compare-grid"}>
        <AlbumCard meta={result.album_a} accentColor={ACCENT_A}
          detailLink={result.album_a.entity_type === "track" ? `/track/${result.album_a.id}` : `/album/${result.album_a.id}`} />
        <AlbumCard meta={result.album_b} accentColor={ACCENT_B}
          detailLink={result.album_b.entity_type === "track" ? `/track/${result.album_b.id}` : `/album/${result.album_b.id}`} />
        {result.album_c && (
          <AlbumCard meta={result.album_c} accentColor={ACCENT_C}
            detailLink={result.album_c.entity_type === "track" ? `/track/${result.album_c.id}` : `/album/${result.album_c.id}`} />
        )}
      </div>
    </div>
  );
}
