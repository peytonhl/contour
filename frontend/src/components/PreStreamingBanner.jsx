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
                Released in {year}, before Spotify's 2008 launch. Any trajectory is modeled from
                when this {year < 1990 ? "classic" : "release"} entered the streaming era, so the chart
                starts in 2008, not {year}.
              </>
            : <>
                Released in {year}, when Spotify was still in its infancy. Historical streaming data
                from this period is often sparse or unavailable.
              </>
          }
        </span>
      </div>
    </div>
  );
}
