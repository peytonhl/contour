import { NavLink } from "react-router-dom";
import { ACCENT_A } from "../theme.js";

// Shared tab bar rendered at the top of /search, /trending, and /charts so
// the three pages feel like one surface with three views. Each tab is a
// NavLink — bookmarkable URLs, browser back/forward works naturally.
//
// The "Search" tab uses `end` to avoid matching against /search/ subroutes
// that may exist in the future.
const TABS = [
  { to: "/search",   label: "Search",   end: true },
  { to: "/trending", label: "Trending", end: false },
  { to: "/charts",   label: "Charts",   end: false },
];

export function ChartsTabs() {
  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        borderBottom: "1px solid var(--border)",
        marginBottom: 20,
      }}
    >
      {TABS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          style={({ isActive }) => ({
            padding: "12px 16px",
            fontSize: 14,
            fontWeight: isActive ? 700 : 500,
            color: isActive ? "var(--text)" : "var(--text-muted)",
            borderBottom: isActive ? `2px solid ${ACCENT_A}` : "2px solid transparent",
            marginBottom: -1,
            textDecoration: "none",
            transition: "color 0.12s",
          })}
        >
          {label}
        </NavLink>
      ))}
    </div>
  );
}
