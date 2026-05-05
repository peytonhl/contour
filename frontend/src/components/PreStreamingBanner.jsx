/**
 * Shown on album/track pages when the release predates digital streaming (before 2006).
 * The trajectory is still modeled from Spotify's launch, but the banner contextualises
 * why the chart starts mid-career rather than at release.
 */
export function PreStreamingBanner({ releaseDate }) {
  if (!releaseDate) return null;
  const year = parseInt(releaseDate.slice(0, 4), 10);
  if (isNaN(year) || year >= 2006) return null;

  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 12,
      padding: "14px 18px",
      background: "rgba(251, 146, 60, 0.08)",
      border: "1px solid rgba(251, 146, 60, 0.3)",
      borderRadius: 10,
    }}>
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>📼</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#fb923c" }}>Pre-Streaming Era</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
          This {year < 1990 ? "classic" : "release"} predates Spotify ({year} vs. Spotify's 2008 launch).
          The trajectory below is modeled from when the album entered the streaming era, not its original release date —
          so the chart begins in 2008, not {year}.
          Raw stream totals will be lower than a comparable modern release simply because less of its commercial life
          overlapped with streaming.
        </span>
      </div>
    </div>
  );
}
