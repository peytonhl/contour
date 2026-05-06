import { useSearchParams, Link } from "react-router-dom";
import { ComparisonWidget } from "../components/ComparisonWidget.jsx";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";

// Curated matchups that are interesting era-adjusted
// IDs are Spotify album IDs for albums in the seeded catalog
const SUGGESTED = [
  { label: "folklore vs. Midnights", a: "2fenSS68JI1h4Fo1HkVPNi", b: "151w1FgRZfnKZA9FEcg9Z3" },
  { label: "After Hours vs. Starboy", a: "2jX1778bE1RXvVSIbA5ySh", b: "2ODvWsOgouMbaA5xf0RkJe" },
  { label: "DAMN. vs. good kid m.A.A.d city", a: "4eLPsYPBmXABThSJ821sqY", b: "3scAn2BRULWR9GxMEkQ40S" },
  { label: "÷ vs. x (Ed Sheeran)", a: "1HNkqx9Ahdgi1Ixy2xkKkZ", b: "0QaYcvrXxP0bkJXhAzGKuq" },
  { label: "SOS vs. CTRL (SZA)", a: "6KEstFm8vBIHHWiJ9fgPJg", b: "5fy0X0JmZRZnVa2UEicIOc" },
];

export function ComparePage() {
  const [searchParams] = useSearchParams();
  const preloadedAlbumAId = searchParams.get("album_a_id");
  const preloadedAlbumBId = searchParams.get("album_b_id");

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px 60px", display: "flex", flexDirection: "column", gap: 32 }}>

      {/* Hero header — only show when no album is pre-seeded */}
      {!preloadedAlbumAId && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 600 }}>
          <h1 style={{
            fontSize: 28, fontWeight: 800, margin: 0,
            background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            Compare any two albums
          </h1>
          <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
            See how streaming trajectories stack up when you level the playing field for era.
            A 2013 album with a ×6 multiplier would have 6× more streams if it dropped today.
          </p>
        </div>
      )}

      {/* Suggested matchups — only show when no album pre-seeded */}
      {!preloadedAlbumAId && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Try these
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SUGGESTED.map((s) => (
              <Link
                key={s.label}
                to={`/compare?album_a_id=${s.a}&album_b_id=${s.b}`}
                style={{
                  fontSize: 13, fontWeight: 600, padding: "7px 16px",
                  borderRadius: 20, textDecoration: "none",
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  transition: "border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = ACCENT_A + "80";
                  e.currentTarget.style.color = ACCENT_A;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.color = "var(--text)";
                }}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <ComparisonWidget preloadedAlbumAId={preloadedAlbumAId} preloadedAlbumBId={preloadedAlbumBId} />
    </main>
  );
}
