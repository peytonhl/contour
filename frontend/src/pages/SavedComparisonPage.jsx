import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../services/api.js";
import { ComparisonChart } from "../components/ComparisonChart.jsx";
import { AlbumCard } from "../components/AlbumCard.jsx";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";
const ACCENT_C = "#fb923c";

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
        <Link to="/compare" style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", fontSize: 13 }}>
          Run a new comparison
        </Link>
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
