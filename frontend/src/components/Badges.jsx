import { Link } from "react-router-dom";

// ── Badge definitions ─────────────────────────────────────────────────────────
export const BADGE_DEFS = [
  { key: "critics",      emoji: "✍️",  label: "Top Critic",     color: "#d97a3b", title: "Top 5 most reviews written" },
  { key: "influencers",  emoji: "⬆️",  label: "Influential",    color: "#6a90b5", title: "Top 5 most upvotes received" },
  { key: "connectors",   emoji: "👥",  label: "Most Followed",  color: "#fb923c", title: "Top 5 most followers" },
];

/**
 * Given the badges object from the API, return which badge keys this userId holds.
 * badges = { critics: [{id,...}], influencers: [...], connectors: [...] }
 */
export function getBadgesForUser(badges, userId) {
  if (!badges || !userId) return [];
  return BADGE_DEFS.filter((def) =>
    (badges[def.key] ?? []).some((u) => u.id === userId)
  );
}

export function BadgeChips({ badges, userId, size = "sm" }) {
  const held = getBadgesForUser(badges, userId);
  if (!held.length) return null;
  const fs = size === "sm" ? 10 : 12;
  const pad = size === "sm" ? "2px 7px" : "3px 10px";
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {held.map((b) => (
        <span
          key={b.key}
          title={b.title}
          style={{
            fontSize: fs, fontWeight: 700, padding: pad,
            borderRadius: 20,
            background: `${b.color}18`,
            border: `1px solid ${b.color}50`,
            color: b.color,
            whiteSpace: "nowrap",
          }}
        >
          {b.emoji} {b.label}
        </span>
      ))}
    </span>
  );
}

/**
 * Compact "Community Top 5" leaderboard — critics, influencers, connectors.
 * Used as a collapsible utility on the Community / Global Reviews surface.
 */
export function BadgeLeaderboard({ badges }) {
  if (!badges) return null;
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "16px 18px",
      marginBottom: 20,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 14 }}>
        Community Top 5
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {BADGE_DEFS.map((def) => {
          const list = badges[def.key] ?? [];
          if (!list.length) return null;
          return (
            <div key={def.key}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 13 }}>{def.emoji}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: def.color, letterSpacing: "0.04em", textTransform: "uppercase" }}>{def.label}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {list.map((u, i) => (
                  <Link key={u.id} to={`/user/${u.id}`} style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", width: 14, flexShrink: 0 }}>#{i + 1}</span>
                    {u.image_url
                      ? <img src={u.image_url} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                      : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
                    }
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.display_name}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{u.score}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
