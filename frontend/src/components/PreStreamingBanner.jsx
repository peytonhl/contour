/**
 * Shown on album/track pages when the release predates or predates widespread streaming.
 *
 * Tiers:
 *  < 2006  — Pre-Streaming Era (predates Spotify entirely)
 *  2006–2012 — Early Streaming Era (Spotify existed but had tiny user base; data is sparse)
 *  >= 2013 — no banner
 */
export function PreStreamingBanner({ releaseDate }) {
  if (!releaseDate) return null;
  const year = parseInt(releaseDate.slice(0, 4), 10);
  if (isNaN(year) || year >= 2013) return null;

  const isPreStreaming = year < 2006;

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
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{isPreStreaming ? "📼" : "📡"}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#fb923c" }}>
          {isPreStreaming ? "Pre-Streaming Era" : "Early Streaming Era"}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
          {isPreStreaming
            ? <>
                This {year < 1990 ? "classic" : "release"} predates Spotify ({year} vs. Spotify's 2008 launch).
                Any trajectory is modeled from when the track entered the streaming era, not its original release date.
                Raw stream totals will be lower than a comparable modern release simply because less of its commercial
                life overlapped with streaming.
              </>
            : <>
                Released in {year}, this track arrived when Spotify had a fraction of its current user base
                (Spotify launched in the US in 2011 and didn't reach 100M users until 2016).
                Streaming data from this period is often incomplete or unavailable — chart data may be missing.
              </>
          }
        </span>
      </div>
    </div>
  );
}
