import { Link } from "react-router-dom";
import { PenIcon, TrendingUpIcon, UsersIcon } from "./Icons";

// ── Badge definitions ─────────────────────────────────────────────────────────
// `Icon` is consumed by BadgeLeaderboard (the Community Top 5 card). On
// individual profiles/feeds we no longer render per-badge chips at all —
// BadgeMark below shows a single editorial mark next to the user's name and
// lists which badges the user holds in a tooltip. Earlier iterations used a
// row of tinted pills (one per badge type, each with its own icon and color);
// that read as gamified shadcn-style chip soup, which was the opposite of the
// editorial-serif feel the rest of the app is going for.
export const BADGE_DEFS = [
  { key: "critics",     Icon: PenIcon,        label: "Top Critic",    title: "Top 5 most reviews written" },
  { key: "influencers", Icon: TrendingUpIcon, label: "Influential",   title: "Top 5 most upvotes received" },
  { key: "connectors",  Icon: UsersIcon,      label: "Most Followed", title: "Top 5 most followers" },
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

/**
 * A single editorial mark — a serif star in brand amber — that sits inline
 * next to a user's display name when they hold ANY community-recognition
 * badge. The specific badges are revealed in the tooltip / aria-label, not
 * shown visually. ★ is U+2605 (Misc Symbols), not an emoji, so it renders
 * consistently across iOS/Android/Windows in the active font.
 *
 *   size="sm"   → 13px, intended for feed-row use beside a 13px name
 *   size="md"   → 20px, intended for profile-hero use beside a 24-26px H1
 */
export function BadgeMark({ badges, userId, size = "sm" }) {
  const held = getBadgesForUser(badges, userId);
  if (!held.length) return null;
  const labels = held.map((b) => b.label).join(" · ");
  const fontSize = size === "md" ? 20 : 13;
  return (
    <span
      title={labels}
      aria-label={`Community recognition: ${labels}`}
      style={{
        fontFamily: "var(--font-display)",
        fontSize,
        color: "var(--accent-a)",
        marginLeft: 6,
        lineHeight: 1,
        cursor: "help",
        verticalAlign: "baseline",
      }}
    >★</span>
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
      borderRadius: "var(--radius-lg)",
      padding: "var(--space-4) 18px",
      marginBottom: "var(--space-5)",
    }}>
      <div style={{
        fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.06em",
        textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 14,
      }}>
        Community Top 5
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {BADGE_DEFS.map((def) => {
          const list = badges[def.key] ?? [];
          if (!list.length) return null;
          return (
            <div key={def.key}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
                color: "var(--accent-a)",
              }}>
                <def.Icon size={13} />
                <span style={{
                  fontSize: "var(--text-xs)", fontWeight: 700,
                  letterSpacing: "0.04em", textTransform: "uppercase",
                }}>
                  {def.label}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {list.map((u, i) => (
                  <Link key={u.id} to={`/user/${u.id}`} style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
                    <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", width: 14, flexShrink: 0 }}>#{i + 1}</span>
                    {u.image_url
                      ? <img src={u.image_url} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                      : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }} />
                    }
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.display_name}</span>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", flexShrink: 0 }}>{u.score}</span>
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
