import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ACCENT_A as ACCENT } from "../theme.js";
import { ROUTES } from "../constants/routes.js";

function fmt(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

/**
 * Era-adjustment stat for album/track hero rows.
 * Renders the total-streams headline plus an inline era-adjusted comparison with a "?" popover.
 *
 * `variant`:
 *   - "default"  → compact form used in stat-block rows.
 *   - "hero"     → celebrated form for the page hero: large number, bold label, era
 *                  comparison rendered as a soft accent pill below.
 */
export function EraAdjustedStat({ eraContext, totalStreams, onOpen, variant = "default" }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function toggle() {
    setOpen((prev) => {
      if (!prev && onOpen) onOpen();
      return !prev;
    });
  }

  const hasEra = eraContext && totalStreams && eraContext.multiplier && eraContext.multiplier > 1.05;
  const currentYear = new Date().getFullYear();

  if (variant === "hero") {
    // Hero treatment: the era-adjusted number is the page's signature stat,
    // so it gets the serif headline weight. Raw plays drop to a smaller line
    // underneath. When there's no era data (recent release or missing
    // context), fall back to showing raw plays as the headline.
    const headlineNumber = hasEra ? eraContext.era_adjusted_streams : totalStreams;
    const headlineLabel = hasEra ? "Era-adjusted streams" : "Total streams";
    return (
      <div style={{
        display: "flex", flexDirection: "column", gap: "var(--space-1)",
        alignItems: "center", textAlign: "center",
      }}>
        <span style={{
          fontSize: "var(--text-xs)", fontWeight: 600, letterSpacing: "0.01em",
          color: "var(--text-dim)",
        }}>
          {headlineLabel}
        </span>
        <span style={{
          fontFamily: "var(--font-display)",
          fontSize: 76, fontWeight: 400, color: "var(--text)",
          letterSpacing: "-0.02em", lineHeight: 0.95,
          fontVariantNumeric: "tabular-nums",
        }}>
          {fmt(headlineNumber)}
        </span>
        {hasEra && (
          <span ref={wrapRef} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
            <span style={{
              fontSize: "var(--text-sm)", color: "var(--text-muted)",
              fontVariantNumeric: "tabular-nums",
            }}>
              from {fmt(totalStreams)} raw · <span style={{ color: ACCENT, fontWeight: 600 }}>×{eraContext.multiplier} scale</span>
            </span>
            <button
              onClick={toggle}
              aria-label="What is era-adjusted?"
              aria-expanded={open}
              style={{
                all: "unset",
                fontSize: 11, width: 18, height: 18, borderRadius: "50%",
                background: "rgba(217,122,59,0.18)", color: ACCENT,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontWeight: 700,
              }}
            >
              ?
            </button>
            {open && (
              <div
                role="dialog"
                className="glass"
                style={{
                  position: "absolute", top: "calc(100% + 8px)", left: 0,
                  borderRadius: "var(--radius-lg)", padding: "var(--space-4) var(--space-4)",
                  fontSize: "var(--text-sm)", lineHeight: 1.55, color: "var(--text)",
                  width: 280, zIndex: 200, boxShadow: "var(--shadow-2)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "var(--space-2)", color: ACCENT, fontSize: "var(--text-sm)" }}>
                  Era-adjusted streams
                </div>
                <div style={{ color: "var(--text-muted)", marginBottom: "var(--space-3)" }}>
                  Released in <strong style={{ color: "var(--text)" }}>{eraContext.release_year}</strong>{" "}
                  when Spotify had <strong style={{ color: "var(--text)" }}>{eraContext.release_mau}M</strong> monthly listeners,
                  a fraction of today's audience.
                </div>
                <div style={{ color: "var(--text-muted)", marginBottom: "var(--space-3)" }}>
                  Scaled to <strong style={{ color: "var(--text)" }}>{eraContext.current_mau}M</strong> {currentYear} listeners,
                  this release would have <strong style={{ color: ACCENT }}>~{fmt(eraContext.era_adjusted_streams)}</strong> streams
                  ({eraContext.multiplier}× scale).
                </div>
                <div style={{ color: "var(--text-dim)", marginBottom: "var(--space-3)", fontStyle: "italic" }}>
                  A modeled estimate, not recorded historical data.
                </div>
                <Link
                  to={ROUTES.METHODOLOGY}
                  style={{ color: ACCENT, fontWeight: 600, fontSize: "var(--text-sm)", textDecoration: "none" }}
                  onClick={() => setOpen(false)}
                >
                  Read the methodology
                </Link>
              </div>
            )}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>
        Total streams
      </span>
      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
        {fmt(totalStreams)}
      </span>
      {hasEra && (
        <span ref={wrapRef} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5, marginTop: 1 }}>
          <span style={{ fontSize: 11, color: ACCENT, fontWeight: 600 }}>
            ≈ {fmt(eraContext.era_adjusted_streams)} era-adjusted
          </span>
          <button
            onClick={toggle}
            aria-label="What is era-adjusted?"
            aria-expanded={open}
            style={{
              all: "unset",
              fontSize: 10, width: 15, height: 15, borderRadius: "50%",
              background: "rgba(217,122,59,0.12)", color: ACCENT,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontWeight: 800,
              border: `1px solid rgba(217,122,59,0.35)`,
            }}
          >
            ?
          </button>
          {open && (
            <div
              role="dialog"
              style={{
                position: "absolute", top: "calc(100% + 8px)", left: 0,
                background: "var(--surface2)", border: "1px solid var(--border)",
                borderRadius: "var(--radius)", padding: "14px 16px",
                fontSize: 12, lineHeight: 1.55, color: "var(--text)",
                width: 280, zIndex: 200, boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8, color: ACCENT, fontSize: 13 }}>
                Era-adjusted streams
              </div>
              <div style={{ color: "var(--text-muted)", marginBottom: 10 }}>
                Released in <strong style={{ color: "var(--text)" }}>{eraContext.release_year}</strong>{" "}
                when Spotify had <strong style={{ color: "var(--text)" }}>{eraContext.release_mau}M</strong> monthly listeners,
                a fraction of today's audience.
              </div>
              <div style={{ color: "var(--text-muted)", marginBottom: 10 }}>
                Scaled to <strong style={{ color: "var(--text)" }}>{eraContext.current_mau}M</strong> {currentYear} listeners,
                this release would have <strong style={{ color: ACCENT }}>~{fmt(eraContext.era_adjusted_streams)}</strong> streams
                ({eraContext.multiplier}× scale).
              </div>
              <div style={{ color: "var(--text-dim)", marginBottom: 10, fontStyle: "italic" }}>
                A modeled estimate, not recorded historical data.
              </div>
              <Link
                to={ROUTES.METHODOLOGY}
                style={{ color: ACCENT, fontWeight: 600, fontSize: 12, textDecoration: "none" }}
                onClick={() => setOpen(false)}
              >
                Read the methodology
              </Link>
            </div>
          )}
        </span>
      )}
    </div>
  );
}
