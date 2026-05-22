import { useSearchParams } from "react-router-dom";
import { ComparisonWidget } from "../components/ComparisonWidget.jsx";
import { ACCENT_A, ACCENT_B } from "../theme.js";

export function ComparePage() {
  const [searchParams] = useSearchParams();
  const preloadedAlbumAId = searchParams.get("album_a_id");
  const preloadedAlbumBId = searchParams.get("album_b_id");
  const preloadedAlbumCId = searchParams.get("album_c_id");

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px 60px", display: "flex", flexDirection: "column", gap: 32 }}>

      {/* Hero header — only show when no album is pre-seeded */}
      {!preloadedAlbumAId && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 600 }}>
          <h1 style={{
            fontSize: 40, fontWeight: 400, margin: 0,
            color: "var(--text)",
          }}>
            Compare up to three albums
          </h1>
          <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
            Stream trajectories side by side, weighted for era. A 2013 album
            with a ×6 multiplier would have six times its current play count
            if it dropped today.
          </p>
        </div>
      )}

      <ComparisonWidget
        preloadedAlbumAId={preloadedAlbumAId}
        preloadedAlbumBId={preloadedAlbumBId}
        preloadedAlbumCId={preloadedAlbumCId}
      />
    </main>
  );
}
