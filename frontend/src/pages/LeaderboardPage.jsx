import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { ChartsTabs } from "../components/ChartsTabs.jsx";
import { ACCENT_A, ACCENT_B, GOLD } from "../theme.js";
const SILVER = "#9ca3af";
const BRONZE = "#b45309";

const CLASSIFICATION_STYLES = {
  underrated: { label: "Underrated", bg: "#6a90b518", border: "#6a90b540", color: "#6a90b5" },
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
      fontSize: 11, fontWeight: 600, padding: "2px 8px",
      borderRadius: "var(--radius-xl)", flexShrink: 0,
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

// Editorial hero for the #1 entry. Deliberately not modeled on TrendingPage's
// HeroAlbumSpotlight: Trending's hero treats the album as cinematic
// protagonist (large cover + headline + tagline pulls the eye), which is the
// right tone for "what's hot this week." Leaderboard is a different surface —
// an all-time chart whose unique value is era-adjusted scoring — so the hero
// here leads with the *stat*, not the artwork. The album is credited
// underneath as the holder of the number, not the subject of a poster.
//
// Practical effect: a user landing on /charts after /trending immediately
// reads them as different page types instead of "more of the same."
function LeaderboardChampionHero({ entry, sort, onCompare }) {
  if (!entry) return null;

  const isEra = sort === "era";
  const value = isEra ? entry.era_adjusted_streams : entry.streams;
  const valueLabel = isEra ? "Era-adjusted streams" : "Total plays";
  const showMultiplier = entry.multiplier && entry.multiplier > 1.05;

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding: "28px 24px 22px",
      display: "flex", flexDirection: "column", gap: 18,
    }}>
      {/* Stat block — the page's signature visual */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{
          fontFamily: "var(--font-display)", fontStyle: "italic",
          fontSize: 14, color: ACCENT_A,
        }}>
          Currently leading
        </span>
        <span style={{
          fontSize: 12, fontWeight: 500, color: "var(--text-muted)",
        }}>
          {valueLabel}
        </span>
        <span style={{
          fontFamily: "var(--font-display)",
          fontSize: 76, fontWeight: 400, color: "var(--text)",
          letterSpacing: "-0.02em", lineHeight: 0.95,
          fontVariantNumeric: "tabular-nums", marginTop: 2,
        }}>
          {formatStreams(value)}
        </span>
        {isEra && showMultiplier && (
          <span style={{
            fontSize: 13, color: "var(--text-muted)", marginTop: 4,
            fontVariantNumeric: "tabular-nums",
          }}>
            from {formatStreams(entry.streams)} raw ·{" "}
            <span style={{ color: ACCENT_A, fontWeight: 600 }}>×{entry.multiplier.toFixed(2)} scale</span>
          </span>
        )}
      </div>

      {/* Album credit row */}
      <Link
        to={`/album/${entry.spotify_id}`}
        style={{
          display: "flex", alignItems: "center", gap: 14,
          padding: "12px 0 0",
          borderTop: "1px solid var(--border)",
          textDecoration: "none", color: "var(--text)",
        }}
      >
        {entry.image_url
          ? <img src={entry.image_url} alt="" style={{
              width: 60, height: 60, borderRadius: "var(--radius-md)",
              objectFit: "cover", flexShrink: 0, boxShadow: "var(--shadow-1)",
            }} />
          : <div style={{
              width: 60, height: 60, borderRadius: "var(--radius-md)",
              background: "var(--surface2)", flexShrink: 0,
            }} />
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 20,
            color: "var(--text)", lineHeight: 1.15,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {entry.name}
          </div>
          <div style={{
            fontSize: 13, color: "var(--text-muted)", marginTop: 2,
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.artist} · {entry.release_date?.slice(0, 4)}
            </span>
            <ClassificationBadge type={entry.classification} />
            <StarRating value={entry.avg_rating} />
          </div>
        </div>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCompare(entry); }}
          style={{
            fontSize: 12, fontWeight: 700, padding: "6px 14px",
            borderRadius: "var(--radius-xl)",
            border: `1px solid ${ACCENT_B}50`, background: `${ACCENT_B}15`, color: ACCENT_B,
            cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          Compare
        </button>
      </Link>
    </div>
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
            ? <img src={entry.image_url} alt={entry.name} loading="lazy" decoding="async" style={{ width: 44, height: 44, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 }} />
            : <div style={{ width: 44, height: 44, borderRadius: "var(--radius-sm)", background: "var(--surface2)", flexShrink: 0 }} />
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
                fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: "var(--radius-xl)",
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
            fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: "var(--radius-xl)",
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

      <ChartsTabs />

      {/* Header */}
      <div style={{ marginTop: -8 }}>
        <h1 style={{
          fontSize: 40, fontWeight: 400, margin: "0 0 8px",
          color: "var(--text)",
        }}>
          All-time charts
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0, lineHeight: 1.55, maxWidth: 540 }}>
          {sort === "era"
            ? "Streams weighted by the size of Spotify's audience when the album dropped, so a 2012 release isn't punished for being early."
            : "Ranked by total lifetime plays."}
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Decade tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DECADES.map((d) => (
            <button key={d} onClick={() => setDecade(d)} style={{
              padding: "5px 14px", fontSize: 13, borderRadius: "var(--radius-xl)",
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
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
            Sort by
          </span>
          <div style={{ display: "flex", background: "var(--surface2)", borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border)" }}>
            {[["era", "Era score"], ["streams", "Raw plays"]].map(([val, lbl]) => (
              <button key={val} onClick={() => setSort(val)} style={{
                padding: "6px 16px", fontSize: 13,
                fontWeight: sort === val ? 700 : 400,
                background: sort === val ? ACCENT_A : "transparent",
                color: sort === val ? "#fff" : "var(--text-muted)",
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
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
            Community verdict:
          </span>
          {Object.entries(CLASSIFICATION_STYLES).map(([key, s]) => (
            <span key={key} style={{
              fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: "var(--radius-xl)",
              background: s.bg, border: `1px solid ${s.border}`, color: s.color,
            }}>
              {s.label}
            </span>
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Counting plays…</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
          {decade === "all" ? "No data yet." : `No albums found from the ${decade}.`}
        </div>
      ) : (
        <>
          {/* Editorial hero — the #1 entry is given the magazine-stat
              treatment so the page reads as different from /trending. The
              row also appears in the list below at rank 1, dropped to avoid
              showing the same album twice. */}
          <LeaderboardChampionHero entry={entries[0]} sort={sort} onCompare={handleCompare} />

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "10px 16px", borderBottom: "1px solid var(--border)",
              background: "var(--surface2)",
            }}>
              <span style={{ width: 28, flexShrink: 0 }} />
              <span style={{ width: 44, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>
                Album
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", flexShrink: 0 }}>
                {sort === "era" ? "Era score" : "Plays"}
              </span>
            </div>
            {entries.slice(1).map((entry) => (
              <LeaderboardRow key={entry.spotify_id} entry={entry} sort={sort} onCompare={handleCompare} />
            ))}
          </div>
        </>
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
