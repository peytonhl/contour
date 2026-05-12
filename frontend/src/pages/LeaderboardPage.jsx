import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";
const GOLD = "#f59e0b";
const SILVER = "#9ca3af";
const BRONZE = "#b45309";

const CLASSIFICATION_STYLES = {
  underrated: { label: "Underrated", bg: "#34d39918", border: "#34d39940", color: "#34d399" },
  overrated:  { label: "Overrated",  bg: "#f8717118", border: "#f8717140", color: "#f87171" },
  acclaimed:  { label: "Acclaimed",  bg: "#f59e0b18", border: "#f59e0b40", color: "#f59e0b" },
};

// Only streaming-era decades are included — pre-2010 albums lack Kworb data
const DECADES = ["all", "2020s", "2010s"];

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

function StarRating({ value }) {
  if (!value) return null;
  return (
    <span style={{ fontSize: 11, color: GOLD, fontWeight: 700 }}>
      ★ {value.toFixed(1)}
    </span>
  );
}

function ClassificationBadge({ type }) {
  if (!type || !CLASSIFICATION_STYLES[type]) return null;
  const s = CLASSIFICATION_STYLES[type];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px",
      borderRadius: 20, flexShrink: 0, letterSpacing: "0.04em",
      textTransform: "uppercase",
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

function LeaderboardRow({ entry, sort, onCompare }) {
  const isTop3 = entry.rank <= 3;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link to={`/album/${entry.spotify_id}`} style={{ textDecoration: "none", color: "var(--text)" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 14,
          padding: "10px 16px",
          paddingRight: hovered ? 84 : 16,
          borderBottom: "1px solid var(--border)",
          transition: "background 0.1s",
          background: hovered ? "var(--surface2)" : "transparent",
        }}>
          {/* Rank */}
          <span style={{
            width: 28, textAlign: "right", flexShrink: 0,
            fontSize: isTop3 ? 16 : 13, fontWeight: isTop3 ? 800 : 600,
            color: rankColor(entry.rank), fontVariantNumeric: "tabular-nums",
          }}>
            {entry.rank}
          </span>

          {/* Art */}
          {entry.image_url
            ? <img src={entry.image_url} alt={entry.name} style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
            : <div style={{ width: 44, height: 44, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
          }

          {/* Name + artist + badges */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.name}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {entry.artist} · {entry.release_date?.slice(0, 4)}
              </span>
              <ClassificationBadge type={entry.classification} />
              <StarRating value={entry.avg_rating} />
            </div>
          </div>

          {/* Score */}
          <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
            <span style={{
              fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums",
              color: sort === "era" ? ACCENT_A : "var(--text)",
            }}>
              {formatStreams(sort === "era" ? entry.era_adjusted_streams : entry.streams)}
            </span>
            {sort === "era" && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                {formatStreams(entry.streams)} raw
              </span>
            )}
            {sort === "streams" && entry.multiplier > 1.1 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20,
                background: `${ACCENT_A}18`, border: `1px solid ${ACCENT_A}40`, color: ACCENT_A,
              }}>
                ×{entry.multiplier.toFixed(1)}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Compare button — appears on hover */}
      {hovered && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCompare(entry); }}
          style={{
            position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
            fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
            border: `1px solid ${ACCENT_B}50`, background: `${ACCENT_B}15`, color: ACCENT_B,
            cursor: "pointer", letterSpacing: "0.03em", whiteSpace: "nowrap",
          }}
        >
          Compare
        </button>
      )}
    </div>
  );
}

export function LeaderboardPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("era");
  const [decade, setDecade] = useState("all");
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    api.getLeaderboard(sort, decade)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [sort, decade]);

  function handleCompare(entry) {
    navigate(`/compare?album_a_id=${entry.spotify_id}`);
  }

  const hasClassifications = entries.some(e => e.classification);

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 20px 60px", display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Header */}
      <div>
        <h1 style={{
          fontSize: 28, fontWeight: 800, margin: "0 0 6px",
          background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          All-Time Charts
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>
          {sort === "era"
            ? "The fairest ranking in music: era-adjusted so every generation competes on equal footing."
            : "Ranked by total lifetime plays."}
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Decade tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DECADES.map((d) => (
            <button key={d} onClick={() => setDecade(d)} style={{
              padding: "5px 14px", fontSize: 13, borderRadius: 20,
              fontWeight: decade === d ? 700 : 500,
              background: decade === d ? ACCENT_A : "var(--surface2)",
              color: decade === d ? "#000" : "var(--text-muted)",
              border: decade === d ? "none" : "1px solid var(--border)",
              cursor: "pointer", transition: "all 0.15s",
            }}>
              {d === "all" ? "All Time" : d}
            </button>
          ))}
        </div>

        {/* Sort toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Sort by
          </span>
          <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
            {[["era", "Era Score"], ["streams", "Raw Plays"]].map(([val, lbl]) => (
              <button key={val} onClick={() => setSort(val)} style={{
                padding: "6px 16px", fontSize: 13,
                fontWeight: sort === val ? 700 : 400,
                background: sort === val ? ACCENT_A : "transparent",
                color: sort === val ? "#000" : "var(--text-muted)",
                border: "none", cursor: "pointer", transition: "all 0.15s",
              }}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Classification legend */}
      {hasClassifications && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Community verdict:
          </span>
          {Object.entries(CLASSIFICATION_STYLES).map(([key, s]) => (
            <span key={key} style={{
              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
              background: s.bg, border: `1px solid ${s.border}`, color: s.color,
              textTransform: "uppercase", letterSpacing: "0.04em",
            }}>
              {s.label}
            </span>
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
          {decade === "all" ? "No data yet." : `No albums found from the ${decade}.`}
        </div>
      ) : (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
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
              {sort === "era" ? "Era Score" : "Plays"}
            </span>
          </div>
          {entries.map((entry) => (
            <LeaderboardRow key={entry.spotify_id} entry={entry} sort={sort} onCompare={handleCompare} />
          ))}
        </div>
      )}

      {/* Explainer */}
      <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7, margin: 0 }}>
        <strong style={{ color: "var(--text)" }}>Era Score</strong> multiplies raw plays by how much larger Spotify's audience is today vs. when the album released,
        making this the first chart where a 2012 classic and a 2024 hit compete fairly.{" "}
        <strong style={{ color: "var(--text)" }}>Underrated / Overrated</strong> badges appear once enough community ratings exist to compare against stream rank.
        Hover any row to compare that album against another.
      </p>
    </div>
  );
}
