import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";
const GOLD = "#f59e0b";
const SILVER = "#9ca3af";
const BRONZE = "#b45309";

function formatStreams(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString();
}

function rankColor(rank) {
  if (rank === 1) return GOLD;
  if (rank === 2) return SILVER;
  if (rank === 3) return BRONZE;
  return "var(--text-muted)";
}

function MultiplierBadge({ value }) {
  if (!value || value <= 1.1) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 7px",
      borderRadius: 20, flexShrink: 0,
      background: `${ACCENT_A}18`,
      border: `1px solid ${ACCENT_A}40`,
      color: ACCENT_A,
    }}>
      ×{value.toFixed(1)}
    </span>
  );
}

function LeaderboardRow({ entry, sort }) {
  const isTop3 = entry.rank <= 3;
  return (
    <Link
      to={`/album/${entry.spotify_id}`}
      style={{ textDecoration: "none", color: "var(--text)" }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 14,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          transition: "background 0.1s",
          background: "transparent",
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        {/* Rank */}
        <span style={{
          width: 28, textAlign: "right", flexShrink: 0,
          fontSize: isTop3 ? 16 : 13,
          fontWeight: isTop3 ? 800 : 600,
          color: rankColor(entry.rank),
          fontVariantNumeric: "tabular-nums",
        }}>
          {entry.rank}
        </span>

        {/* Art */}
        {entry.image_url
          ? <img src={entry.image_url} alt={entry.name} style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
          : <div style={{ width: 44, height: 44, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
        }

        {/* Name + artist */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.artist} · {entry.release_date?.slice(0, 4)}
          </div>
        </div>

        {/* Era score / raw streams */}
        <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          <span style={{
            fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums",
            color: sort === "era" ? ACCENT_A : "var(--text)",
          }}>
            {sort === "era"
              ? formatStreams(entry.era_adjusted_streams)
              : formatStreams(entry.streams)}
          </span>
          {sort === "era" && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {formatStreams(entry.streams)} raw
            </span>
          )}
          {sort === "streams" && entry.multiplier > 1.1 && (
            <MultiplierBadge value={entry.multiplier} />
          )}
        </div>
      </div>
    </Link>
  );
}

export function LeaderboardPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("era");

  useEffect(() => {
    setLoading(true);
    api.getLeaderboard(sort)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [sort]);

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 20px 60px", display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{
          fontSize: 28, fontWeight: 800, margin: 0,
          background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          Charts
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>
          {sort === "era"
            ? "Ranked by era-adjusted streams — what each album would have if released today."
            : "Ranked by raw total streams from Kworb."}
        </p>
      </div>

      {/* Sort toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>Sort by</span>
        <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
          {[["era", "Era Score"], ["streams", "Raw Streams"]].map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setSort(val)}
              style={{
                padding: "6px 16px", fontSize: 13,
                fontWeight: sort === val ? 700 : 400,
                background: sort === val ? ACCENT_A : "transparent",
                color: sort === val ? "#000" : "var(--text-muted)",
                border: "none", cursor: "pointer", transition: "all 0.15s",
              }}
            >
              {lbl}
            </button>
          ))}
        </div>

        {sort === "era" && (
          <span style={{
            fontSize: 11, color: ACCENT_A, padding: "3px 10px",
            background: `${ACCENT_A}12`, border: `1px solid ${ACCENT_A}30`,
            borderRadius: 20, fontWeight: 600,
          }}>
            era-adjusted
          </span>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
          No data yet. Visit some album pages to populate the leaderboard.
        </div>
      ) : (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {/* Column headers */}
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "8px 16px", borderBottom: "1px solid var(--border)",
            background: "var(--surface2)",
          }}>
            <span style={{ width: 28, flexShrink: 0 }} />
            <span style={{ width: 44, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Album
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", flexShrink: 0 }}>
              {sort === "era" ? "Era Score" : "Streams"}
            </span>
          </div>

          {entries.map((entry) => (
            <LeaderboardRow key={entry.spotify_id} entry={entry} sort={sort} />
          ))}
        </div>
      )}

      {/* Explainer */}
      <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7, margin: 0 }}>
        <strong style={{ color: "var(--text)" }}>Era Score</strong> multiplies raw streams by how much larger Spotify's audience is today compared to when the album released.
        A ×5 multiplier means Spotify had 5× fewer users at release — so those streams were 5× harder to accumulate.{" "}
        Only albums with confirmed stream data from Kworb appear here.
      </p>
    </div>
  );
}
