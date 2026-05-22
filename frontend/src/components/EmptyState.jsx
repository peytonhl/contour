import { Link } from "react-router-dom";
import { ACCENT_A } from "../theme.js";

// Shared empty-state block. Use this for full "this surface has no content"
// states (e.g., empty Ratings tab, empty notifications, empty followed-feed).
// For one-liner inline placeholders ("No ratings yet" next to a star row), use
// <EmptyHint> from Skeleton.jsx instead — they serve different purposes:
//
//   <EmptyState>  ← full block, optional title + CTA, centered
//   <EmptyHint>   ← single muted line, sits inside an existing container
//
// Props:
//   icon         optional ReactNode — typically an SVG from Icons.jsx
//   title        optional string — serif headline, sentence case
//   description  required string or ReactNode — supporting copy, text-muted
//   ctaLabel     optional string — renders a CTA button/link if also passed `to` or `onClick`
//   ctaTo        optional string — react-router target (renders <Link>)
//   ctaOnClick   optional function — click handler (renders <button>)
//   children     optional — rendered below the CTA, for cases that need extra
//                affordances (e.g., "and here are some suggested users").
//
// `ctaTo` and `ctaOnClick` are mutually exclusive; ctaTo wins if both are set.
export function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  ctaTo,
  ctaOnClick,
  children,
}) {
  const ctaStyle = {
    padding: "8px 18px",
    background: `${ACCENT_A}18`,
    border: `1px solid ${ACCENT_A}66`,
    borderRadius: "var(--radius-xl)",
    color: ACCENT_A,
    fontSize: 13,
    fontWeight: 700,
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
    fontFamily: "inherit",
  };
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 12, padding: "40px 20px", textAlign: "center",
    }}>
      {icon && (
        <div style={{ color: "var(--text-muted)", opacity: 0.7 }}>{icon}</div>
      )}
      {title && (
        <p style={{
          fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400,
          color: "var(--text)", margin: 0, lineHeight: 1.2,
        }}>
          {title}
        </p>
      )}
      {description && (
        <p style={{
          color: "var(--text-muted)", fontSize: "var(--text-sm)",
          margin: 0, maxWidth: 420, lineHeight: 1.55,
        }}>
          {description}
        </p>
      )}
      {ctaLabel && ctaTo && (
        <Link to={ctaTo} style={ctaStyle}>{ctaLabel}</Link>
      )}
      {ctaLabel && !ctaTo && ctaOnClick && (
        <button onClick={ctaOnClick} style={ctaStyle}>{ctaLabel}</button>
      )}
      {children}
    </div>
  );
}
