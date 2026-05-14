// Shared monoline icon set. All icons:
//   - render at the size passed in (default 16), on a 24-unit viewBox
//   - paint via `currentColor` so the parent's color flows through
//   - use a 1.5px stroke with round caps / joins for visual consistency
//
// This is deliberately *not* a third-party icon library. A hand-curated set
// keeps the visual language coherent with Contour's editorial-serif feel
// where a generic geometric library (Lucide, Heroicons) would not.

const baseProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  style: { flexShrink: 0, display: "inline-block", verticalAlign: "middle" },
};

// Pen / writing — "Top Critic" badge.
export function PenIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="M15.5 3.5 L20.5 8.5" />
      <path d="M14 5 L4 15 L3 21 L9 20 L19 10 Z" />
    </svg>
  );
}

// Trending-up line + arrow corner — "Influential" badge (rising upvotes).
export function TrendingUpIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="M3 17 L9 11 L13 15 L21 7" />
      <path d="M15 7 L21 7 L21 13" />
    </svg>
  );
}

// Two figures — "Most Followed" badge.
export function UsersIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20 c0 -3.3 2.7 -6 6 -6 s6 2.7 6 6" />
      <circle cx="16.5" cy="9" r="2.3" />
      <path d="M16.5 14 c2.5 0 4.5 2 4.5 4.5" />
    </svg>
  );
}

// Triangle alert — replaces the OS-fragmented ⚠ emoji wherever it appeared.
export function AlertIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="M12 3 L22 20 L2 20 Z" />
      <line x1="12" y1="10" x2="12" y2="14.5" />
      <circle cx="12" cy="17.2" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
