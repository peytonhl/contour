const ACCENT_A = "#a78bfa";

function fmt(n) {
  if (!n) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export function EraCallout({ eraContext, totalStreams }) {
  if (!eraContext || !totalStreams) return null;

  const { release_year, release_mau, current_mau, era_adjusted_streams, multiplier } = eraContext;

  // Only show the callout if the era multiplier is meaningful (> 1.5x)
  if (multiplier < 1.5) return null;

  const isOlder = release_year < new Date().getFullYear() - 2;

  return (
    <div style={{
      background: `linear-gradient(135deg, rgba(167,139,250,0.08), rgba(52,211,153,0.05))`,
      border: `1px solid rgba(167,139,250,0.25)`,
      borderRadius: 12,
      padding: "16px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>📊</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT_A, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Era Context
        </span>
      </div>

      {/* Main insight */}
      <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6 }}>
        Released in <strong>{release_year}</strong> when Spotify had{" "}
        <strong>{fmt(release_mau)}M</strong> monthly listeners — only{" "}
        <strong style={{ color: ACCENT_A }}>{Math.round((release_mau / current_mau) * 100)}%</strong>{" "}
        of today's audience.
      </div>

      {/* Adjusted figure */}
      <div style={{
        background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "12px 16px",
        display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: ACCENT_A }}>
          ~{fmt(era_adjusted_streams)}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          equivalent streams at today's scale
        </span>
      </div>

      {/* Explanation */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        {fmt(totalStreams)} actual streams × {multiplier}x scale factor = what this{" "}
        {isOlder ? "classic" : "release"} would achieve if released on today's Spotify
        ({fmt(current_mau)}M monthly listeners).
      </div>
    </div>
  );
}
