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

// Chat bubble — used for the "reply" notification type. Replaces the
// OS-fragmented 💬 emoji that was rendering inconsistently across iOS,
// Android WebView, and Windows browsers.
export function ChatBubbleIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...baseProps}>
      <path d="M21 11.5 c0 4.4 -4 8 -9 8 c -1.4 0 -2.7 -0.3 -3.9 -0.8 L3 20.5 l1.4 -4.5 C3.5 14.7 3 13.2 3 11.5 c0 -4.4 4 -8 9 -8 s9 3.6 9 8 z" />
    </svg>
  );
}

// Bell — notifications. Previously lived as a local helper in Layout.jsx;
// extracted so the NotificationsPage empty state can drop its 🔔 emoji.
export function BellIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...baseProps} strokeWidth={1.5}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
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

// Five-point star — used for rating affordances. `filled` switches between an
// outlined star (rating empty) and a solid one (rating set / hovered). Both
// variants share the same path so swapping doesn't shift layout. Replaces
// the literal "★" glyph that rendered as Apple Color Emoji on iOS and a
// flat geometric shape on most desktop fonts.
export function StarIcon({ size = 16, filled = false }) {
  const path = "M12 2.5 L14.85 8.65 L21.5 9.5 L16.6 14.1 L17.9 20.7 L12 17.4 L6.1 20.7 L7.4 14.1 L2.5 9.5 L9.15 8.65 Z";
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}
    >
      <path d={path} />
    </svg>
  );
}

// Gear / settings — replaces the literal "⚙" glyph that renders as color
// emoji on iOS and a geometric shape on desktop. Hand-traced spokes so the
// shape reads at small sizes (16-22px) without becoming a blob.
export function GearIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} {...baseProps} strokeWidth={1.6}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// X / close — replaces "✕" / "×" literals across modals and dismiss buttons.
// Sized to match other icons rather than the typographic ✕ which drifts
// vertically vs. neighboring SVG/text.
export function CloseIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...baseProps} strokeWidth={2}>
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  );
}

// Overflow ⋯ — three dots, used for per-item action menus. Replaces literal
// "···" which is a typographic ellipsis whose dot spacing/weight varies by
// OS font. SVG keeps them consistent and a single tap target.
export function OverflowIcon({ size = 18 }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}
    >
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

// Plus — used for "Add to list", "New comparison", and other affordances
// that currently render the bare "+" glyph (which varies in stroke weight
// across OS fonts and gets misaligned at small sizes).
export function PlusIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} {...baseProps} strokeWidth={2}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
