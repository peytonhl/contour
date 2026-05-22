import { AlertIcon } from "./Icons";

const styles = {
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  header: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
  },
  art: {
    width: 64,
    height: 64,
    borderRadius: "var(--radius-sm)",
    objectFit: "cover",
    flexShrink: 0,
  },
  artPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: "var(--radius-sm)",
    background: "var(--surface2)",
    flexShrink: 0,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.3,
    marginBottom: 3,
  },
  artist: {
    fontSize: 13,
    color: "var(--text-muted)",
  },
  divider: {
    height: 1,
    background: "var(--border)",
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "10px 16px",
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
  },
  statValue: {
    fontSize: 14,
    fontWeight: 600,
  },
  certBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: "var(--radius-xl)",
    background: "rgba(245, 158, 11, 0.15)",
    color: "var(--gold)",
    border: "1px solid rgba(245, 158, 11, 0.3)",
  },
  warning: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    fontSize: 11,
    color: "var(--text-muted)",
    fontStyle: "italic",
    padding: "6px 10px",
    background: "var(--surface2)",
    borderRadius: "var(--radius-sm)",
    lineHeight: 1.5,
  },
};

function formatStreams(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export function AlbumCard({ meta, accentColor, enriching, detailLink }) {
  if (!meta) return null;

  const topCert = meta.riaa_milestones?.at(-1);
  const showEnriching = enriching && meta.stream_source !== "kworb";

  return (
    <div style={{ ...styles.card, borderColor: accentColor + "44" }}>
      <div style={styles.header}>
        {meta.image_url ? (
          <img src={meta.image_url} alt={meta.name} loading="lazy" decoding="async" style={styles.art} />
        ) : (
          <div style={styles.artPlaceholder} />
        )}
        <div style={styles.titleBlock}>
          {detailLink
            ? <a href={detailLink} style={{ ...styles.title, color: accentColor, textDecoration: "none" }}>{meta.name}</a>
            : <div style={{ ...styles.title, color: accentColor }}>{meta.name}</div>
          }
          <div style={styles.artist}>
            {meta.artists?.join(", ")}
            {meta.entity_type === "track" && meta.album_name && (
              <span style={{ opacity: 0.7 }}> · {meta.album_name}</span>
            )}
          </div>
        </div>
      </div>

      <div style={styles.divider} />

      <div style={styles.stats}>
        <div style={styles.stat}>
          <span style={styles.statLabel}>Released</span>
          <span style={styles.statValue}>{meta.release_date}</span>
        </div>
        {meta.entity_type === "track" ? (
          <div style={styles.stat}>
            <span style={styles.statLabel}>Duration</span>
            <span style={styles.statValue}>{meta.duration_ms ? `${Math.floor(meta.duration_ms/60000)}:${String(Math.floor((meta.duration_ms%60000)/1000)).padStart(2,"0")}` : "—"}</span>
          </div>
        ) : (
          <div style={styles.stat}>
            <span style={styles.statLabel}>Label</span>
            <span style={styles.statValue}>{meta.label ?? "—"}</span>
          </div>
        )}
        <div style={styles.stat}>
          <span style={styles.statLabel}>Total Streams</span>
          <span style={{ ...styles.statValue, display: "flex", alignItems: "center", gap: 6 }}>
            {formatStreams(meta.total_streams)}
            {showEnriching && (
              <span style={{ fontSize: 10, color: "#6a90b5", fontWeight: 600, background: "rgba(106,144,181,0.12)", padding: "1px 6px", borderRadius: "var(--radius-sm)" }}>
                enriching…
              </span>
            )}
          </span>
        </div>
        <div style={styles.stat}>
          <span style={styles.statLabel}>Source</span>
          <span style={styles.statValue}>{meta.stream_source}</span>
        </div>
        {topCert && (
          <div style={styles.stat}>
            <span style={styles.statLabel}>RIAA</span>
            <span style={styles.certBadge}>⬡ {topCert.label}</span>
          </div>
        )}
      </div>

      {meta.stream_warning && (
        <div style={styles.warning}>
          <span style={{ flexShrink: 0, marginTop: 1, lineHeight: 0 }}>
            <AlertIcon size={12} />
          </span>
          <span>{meta.stream_warning}</span>
        </div>
      )}
    </div>
  );
}
