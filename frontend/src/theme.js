// Brand color constants — single JS-land source of truth.
//
// These mirror the CSS custom properties defined in index.css. They exist in
// JS because lots of style objects use template-literal tricks like
// `${ACCENT_A}18` (hex + alpha) that a CSS var can't express cleanly without
// `color-mix()`, which we'd rather not gate on browser support yet.
//
// CRITICAL: keep these in sync with index.css. The two source-of-truth files
// are this one and index.css's `:root` block. If you change a brand color,
// change it in both places. This file replaces ~20 prior locations that each
// redeclared these constants — a pattern that bit us when a stale `develop`
// branch ended up with `ACCENT_A = "#a78bfa"` (Tailwind violet) and shipped
// for a session before being caught.

// Primary brand — warm amber, pulled from the Contour logo.
export const ACCENT_A = "#d97a3b";

// Secondary brand — dusty cobalt. Used in three established patterns:
//   (1) Entity-B in Compare's side-by-side trajectory chart (primary use).
//   (2) Track-type when paired against album-type — `ENTITY_COLOR = { album:
//       ACCENT_A, track: ACCENT_B, artist: ACCENT_C }`. Used in
//       FollowingTab, GlobalReviewsFeed, ListDetailPage, BacklogTabContent,
//       ProfilePage row links.
//   (3) Save / wishlist / "posted" status semantics — distinct from amber
//       which means "rate / action." See WantToListenButton, TrendingPage
//       backlog count, ForYouPage "Saved ✓" / "Review posted ✓".
// Also appears in the ACCENT_A → ACCENT_B brand gradient (warm→cool pairing)
// used in hero CTAs, avatar rings, and progress bars.
//
// NOT to be used for: arbitrary text accent, hover tints, generic info
// affordances, or as a fourth one-off "type" color (e.g. users-as-type).
// When unsure, prefer var(--text-muted) for chrome and ACCENT_A for brand.
export const ACCENT_B = "#6a90b5";

// Tertiary — orange, used only for Compare's optional side C overlay.
export const ACCENT_C = "#fb923c";

// Star ratings + RIAA milestones.
export const GOLD = "#f59e0b";

// Errors, destructive actions, "blocked / hidden" indicators.
export const DANGER = "#f87171";
