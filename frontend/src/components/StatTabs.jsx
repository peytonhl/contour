const ACCENT = "#a78bfa";

/**
 * Letterboxd-style profile nav: each tab cell shows a large count above a
 * small uppercase label. Tabs without a `count` (e.g. Taste) render just the
 * label. Active tab gets the accent bottom-border.
 *
 * Replaces the previous redundant "stats row above + tabs row below"
 * pattern — the cells themselves ARE the tabs.
 *
 * Props:
 *   tabs:    [{ key, label, count? }]
 *   active:  the currently selected key
 *   onChange: (key) => void
 */
export function StatTabs({ tabs, active, onChange }) {
  return (
    <div
      role="tablist"
      className="stat-tabs"
      style={{
        display: "flex",
        gap: 0,
        borderBottom: "1px solid var(--border)",
        // Desktop: flat row, no wrap. Mobile-specific overrides live in
        // index.css via the `.stat-tabs` class (flex-wrap + reduced
        // per-tab width so 5+ tabs fit in two rows instead of overflowing
        // off-screen the way the previous `overflowX: auto` did).
      }}
    >
      {tabs.map(({ key, label, count }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className="stat-tab-button"
            style={{
              flex: "0 0 auto",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 4,
              padding: count === undefined ? "16px 18px" : "10px 18px",
              minHeight: 56, minWidth: 64,
              background: "none", border: "none", cursor: "pointer",
              color: isActive ? "var(--text)" : "var(--text-muted)",
              borderBottom: `2px solid ${isActive ? ACCENT : "transparent"}`,
              transition: "color 0.12s, border-color 0.12s",
              whiteSpace: "nowrap",
            }}
          >
            {count !== undefined && (
              <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em" }}>
                {count}
              </span>
            )}
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
