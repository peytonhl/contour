// Empty-state card shown on Album / Track pages when the trajectory chart
// has no data to render. Two reasons we hit this:
//
//   1. The release predates widespread streaming (~pre-2013). The streaming
//      curve doesn't exist; the era multiplier still applies via decay model.
//      We surface a warmer, more honest "this predates the chart" framing
//      so the page doesn't read as broken.
//
//   2. The release is too new / hasn't been indexed yet. Trajectory may
//      come online later; the rating can already happen.
//
// Was previously duplicated across AlbumPage and TrackPage with two slightly
// different copy variants. Consolidated to one source of truth, with an
// optional `entityLabel` to keep the copy accurate ("this album" vs
// "this track").
export function NoChartData({ releaseDate, entityLabel = "release" }) {
  const year = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) : null;
  const isEarlyEra = year && year < 2013;
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
      padding: "52px 24px", display: "flex", flexDirection: "column",
      alignItems: "center", gap: 12, textAlign: "center",
    }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
        {isEarlyEra
          ? <><path d="M1 6l5 5 5-5 5 5 5-5"/><path d="M1 12l5 5 5-5 5 5 5-5"/></>
          : <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>
        }
      </svg>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, color: "var(--text)" }}>
        {isEarlyEra ? "This one predates the chart." : "No trajectory yet."}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 420, lineHeight: 1.65 }}>
        {isEarlyEra
          ? `Releases from ${year} predate widespread streaming, so the day-by-day curve isn't in our sources. The era adjustment still applies — it's why older ${entityLabel}s get a fair shot.`
          : `We haven't indexed a trajectory for this ${entityLabel} yet. Check back in a few days, or rate it now and the page will catch up.`}
      </div>
    </div>
  );
}
