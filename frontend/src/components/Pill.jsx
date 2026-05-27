import { ACCENT_A } from "../theme.js";

// ── Pill ──────────────────────────────────────────────────────────────────────
//
// Single-source pill primitive. Replaces dozens of locally-defined `padding:
// "5px 14px", fontSize: 13, borderRadius: pill, ...` style objects that had
// drifted into 3+ subtly different size/weight combinations across
// Leaderboard, Trending, and ForYou settings.
//
// `selected` flips between the brand-amber filled state and the quiet
// outlined state. `size` opts into a denser variant when a pill cluster
// needs to fit alongside other dense chrome (Trending window picker).
//
// Renders as a button by default. Pass `as="a"` (or any element name) for
// link-styled pills — the wrapping styles are identical.
export function Pill({
  selected = false,
  size = "md",        // "sm" | "md"
  onClick,
  children,
  as: Tag = "button",
  type = "button",
  style,
  ...rest
}) {
  const dense = size === "sm";
  return (
    <Tag
      onClick={onClick}
      type={Tag === "button" ? type : undefined}
      style={{
        padding: dense ? "5px 12px" : "6px 14px",
        fontSize: dense ? 12 : 13,
        fontWeight: selected ? 700 : 500,
        borderRadius: "var(--radius-pill)",
        background: selected ? ACCENT_A : "var(--surface2)",
        color: selected ? "#000" : "var(--text-muted)",
        border: selected ? "1px solid transparent" : "1px solid var(--border)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background var(--motion-base) var(--ease), color var(--motion-base) var(--ease), border-color var(--motion-base) var(--ease)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// ── PillGroup ─────────────────────────────────────────────────────────────────
//
// Horizontal cluster of Pills. Just a flex row — wraps on narrow viewports.
// `gap` defaults to 6 to match the existing decade/window picker rhythm.
export function PillGroup({ children, gap = 6, style, ...rest }) {
  return (
    <div
      style={{
        display: "flex",
        gap,
        flexWrap: "wrap",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
