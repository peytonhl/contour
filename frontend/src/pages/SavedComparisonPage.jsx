import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api.js";
import { ComparisonChart } from "../components/ComparisonChart.jsx";
import { AlbumCard } from "../components/AlbumCard.jsx";
import { CardPreviewModal } from "../components/CardPreviewModal.jsx";
import { ACCENT_A, ACCENT_B, ACCENT_C } from "../theme.js";
import { albumPath, trackPath, savedComparePath } from "../constants/routes.js";

// "Share card" button — opens the CardPreviewModal which renders the
// generated comparison PNG inline and dispatches share/save through
// @capacitor/share on native (reliable) or Web Share Level 2 on web.
// Replaces the older direct-share-on-tap flow which silently fell back
// to URL share on iOS Capacitor (canShare({ files }) false-negative).
function ShareCardButton({ id, label }) {
  const [open, setOpen] = useState(false);
  const reviewUrl = `${window.location.origin}${savedComparePath(id)}`;
  const cardUrl   = `${window.location.origin}/api/og/comparison?id=${id}`;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: "8px 16px",
          background: ACCENT_A,
          border: "none",
          borderRadius: "var(--radius-sm)",
          color: "#000",
          fontSize: 13, fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Share card
      </button>
      <CardPreviewModal
        open={open}
        onClose={() => setOpen(false)}
        cardUrl={cardUrl}
        shareUrl={reviewUrl}
        shareText={label}
        fileName={`contour-comparison-${id}.png`}
      />
    </>
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
          detailLink={result.album_a.entity_type === "track" ? trackPath(result.album_a.id) : albumPath(result.album_a.id)} />
        <AlbumCard meta={result.album_b} accentColor={ACCENT_B}
          detailLink={result.album_b.entity_type === "track" ? trackPath(result.album_b.id) : albumPath(result.album_b.id)} />
        {result.album_c && (
          <AlbumCard meta={result.album_c} accentColor={ACCENT_C}
            detailLink={result.album_c.entity_type === "track" ? trackPath(result.album_c.id) : albumPath(result.album_c.id)} />
        )}
      </div>
    </div>
  );
}
