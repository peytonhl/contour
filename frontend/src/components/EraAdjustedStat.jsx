import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

const ACCENT = "#a78bfa";

function fmt(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

/**
 * Single-line era-adjustment stat for album/track hero rows.
 * Renders: "Total Streams: X — era-adjusted ≈ Y as if released today" with a "?" affordance.
 * When the popover opens, `onOpen` fires once per open (used to track engagement with
 * era-adjustment as a contextual feature).
 */
export function EraAdjustedStat({ eraContext, totalStreams, onOpen }) {
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
        Total Streams
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
              background: "rgba(167,139,250,0.12)", color: ACCENT,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontWeight: 800,
              border: `1px solid rgba(167,139,250,0.35)`,
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
                borderRadius: 10, padding: "14px 16px",
                fontSize: 12, lineHeight: 1.55, color: "var(--text)",
                width: 280, zIndex: 200, boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8, color: ACCENT, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Era-adjusted streams
              </div>
              <div style={{ color: "var(--text-muted)", marginBottom: 10 }}>
                Released in <strong style={{ color: "var(--text)" }}>{eraContext.release_year}</strong>{" "}
                when Spotify had <strong style={{ color: "var(--text)" }}>{eraContext.release_mau}M</strong> monthly listeners
                {" "}— a fraction of today's audience.
              </div>
              <div style={{ color: "var(--text-muted)", marginBottom: 10 }}>
                Scaled to <strong style={{ color: "var(--text)" }}>{eraContext.current_mau}M</strong> {currentYear} listeners,
                this release would have <strong style={{ color: ACCENT }}>~{fmt(eraContext.era_adjusted_streams)}</strong> streams
                ({eraContext.multiplier}× scale).
              </div>
              <Link
                to="/methodology"
                style={{ color: ACCENT, fontWeight: 600, fontSize: 12, textDecoration: "none" }}
                onClick={() => setOpen(false)}
              >
                Learn more →
              </Link>
            </div>
          )}
        </span>
      )}
    </div>
  );
}
