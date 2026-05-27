import { ACCENT_A } from "../theme.js";

// ── ToggleGroup ───────────────────────────────────────────────────────────────
//
// Segmented control. Replaces a recurring inline-styled pattern that diverged
// across surfaces — Leaderboard's "Sort by" toggle used 6px/13px/white-on-
// amber, ForYou settings' Language toggle used 7px/12px/black-on-amber, etc.
// All collapse to this single contract:
//
//   <ToggleGroup
//     value={sort}
//     onChange={setSort}
//     options={[
//       { value: "era",     label: "Era score" },
//       { value: "streams", label: "Raw plays" },
//     ]}
//   />
//
// Visual: rounded surface2 container, 1px border, each option a flex:1
// button. Active option gets ACCENT_A bg + black text. Black-on-amber
// matches the Pill primitive and the decade chips so the same "selected"
// signal is consistent everywhere.
//
// `size` opts into a denser variant for embedded use (ForYou settings panel)
// where the toggle sits inside a tighter chrome.
//
// Optional `label` renders a small left-aligned caption above the group —
// folds the previous "Sort by" + container pattern into a single component.
export function ToggleGroup({
  value,
  onChange,
  options,
  size = "md",        // "sm" | "md"
  label,
  style,
}) {
  const dense = size === "sm";
  const itemPadding = dense ? "6px 10px" : "6px 16px";
  const itemFontSize = dense ? 12 : 13;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
      {label && (
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
          {label}
        </span>
      )}
      <div style={{
        display: "inline-flex",
        background: "var(--surface2)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        border: "1px solid var(--border)",
        padding: 2,
        gap: 2,
        alignSelf: "flex-start",
      }}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              style={{
                padding: itemPadding,
                fontSize: itemFontSize,
                fontWeight: active ? 700 : 500,
                background: active ? ACCENT_A : "transparent",
                color: active ? "#000" : "var(--text-muted)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                transition: "background var(--motion-base) var(--ease), color var(--motion-base) var(--ease)",
                whiteSpace: "nowrap",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
