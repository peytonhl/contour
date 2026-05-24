// Client-side route paths — single source of truth for everything that
// builds a URL into the React app (Links, navigate(), share URLs, etc).
//
// Two exports:
//   - ROUTES: an object of static path strings (no parameters)
//   - One named builder per parameterized route (albumPath, userPath, …)
//
// Why this file exists:
//   Before centralization there were ~140 hardcoded route literals scattered
//   across ~40 files (per the 2026-05-24 centralization audit, Category 5).
//   The most insidious symptom was the /user/:id callsites — some wrapped
//   the id in encodeURIComponent, most didn't. If a user id ever contained
//   /, ?, or # the link silently broke or pointed at the wrong page. Every
//   builder below encodeURIComponent's its parameter so every callsite is
//   safe by default; for current Spotify-style IDs (22-char alphanumeric)
//   and integer list IDs the encoding is a no-op.
//
// What NOT to change here:
//   The route DEFINITIONS in App.jsx (<Route path="...">) are NOT updated
//   from this file. React Router v6 nested routes use relative paths
//   without leading slashes ("search" not "/search"), and the patterns
//   include ":id" placeholders that don't map 1:1 to these builders.
//   App.jsx is a single file — keeping the patterns there is clearer than
//   forcing them through this module. This file is for CALLSITES that
//   navigate TO a route.

// ── Static routes ────────────────────────────────────────────────────────────
// Use as both <Link to={ROUTES.PROFILE}> and navigate(ROUTES.PROFILE).
//
// Note: "/" (home) is intentionally NOT in here. It's used in only a handful
// of navigate("/") calls and the literal "/" is more readable in context
// than ROUTES.HOME. Add it later if the count grows.
export const ROUTES = {
  PROFILE: "/profile",
  FRIENDS: "/friends",
  SEARCH: "/search",
  TRENDING: "/trending",
  CHARTS: "/charts",
  NOTIFICATIONS: "/notifications",
  SETTINGS: "/settings",
  IMPORT: "/import",
  BLOCKS: "/blocks",
  DISLIKED_ARTISTS: "/disliked-artists",
  ADMIN_REPORTS: "/admin/reports",
  PRIVACY: "/privacy",
  TERMS: "/terms",
  METHODOLOGY: "/methodology",

  // ⚠ LOCKED VALUE — DO NOT CHANGE THE STRING ⚠
  //
  // This path is registered as a Sign in with Apple Return URL in Apple
  // Developer Portal (Services ID configuration) as
  // `https://contour-rosy.vercel.app/auth/success`. The frontend builds
  // `${window.location.origin}/auth/success` and hands it to Apple's
  // authorize endpoint as `redirectURI`. If the literal string changes
  // here, the Apple OAuth flow will break with `invalid_redirect_uri`
  // until the Return URL is also updated in Apple's portal AND every
  // origin we sign in from (current prod + future staging) is registered.
  //
  // Renaming the constant (AUTH_SUCCESS → SIGNIN_CALLBACK etc.) is fine
  // — it's only the string value that's locked. See APP_STORE.md
  // line 290 and OPERATIONS.md → domain-change runbook for the full
  // out-of-band update procedure.
  AUTH_SUCCESS: "/auth/success",
};

// ── Builders for parameterized routes ────────────────────────────────────────
// Every builder encodeURIComponent's the id/parameter. Defensive against
// future ID-format changes — current Spotify IDs and integer list IDs are
// URL-safe so encoding is a no-op for them.

export const albumPath        = (id)   => `/album/${encodeURIComponent(id)}`;
export const trackPath        = (id)   => `/track/${encodeURIComponent(id)}`;
export const artistPath       = (id)   => `/artist/${encodeURIComponent(id)}`;
export const userPath         = (id)   => `/user/${encodeURIComponent(id)}`;
export const listPath         = (id)   => `/list/${encodeURIComponent(id)}`;
// Saved comparison detail — the static "/compare" page (builder route) is
// separate and lives in ROUTES if you ever centralize it; this builder is
// for shared/saved comparison links by id.
export const savedComparePath = (id)   => `/compare/${encodeURIComponent(id)}`;
export const tasteMatchPath   = (id)   => `/taste-match/${encodeURIComponent(id)}`;
// Profile with optional tab query param. Falsy tab → plain "/profile".
export const profileTabPath   = (tab)  => tab ? `/profile?tab=${encodeURIComponent(tab)}` : ROUTES.PROFILE;
