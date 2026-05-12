import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";

const ACCENT_A = "#a78bfa";

/**
 * Compact horizontal carousel of trending albums.
 *
 * Honors the auto-expanded window from the backend by using its `label`
 * field (e.g. "Trending this week" downshifts to "Popular on Contour"
 * when there's not enough activity in the requested window).
 *
 * Used on ForYouPage above the swipeable feed. Tap → album page.
 * "See all" → /trending.
 */
export function TrendingCarousel({ surface = "for_you", limit = 10, window = "7d" }) {
  const [items, setItems] = useState([]);
  const [label, setLabel] = useState("Trending this week");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.getTrendingAlbums(window, limit)
      .then((r) => {
        if (cancelled) return;
        setItems(r.items ?? []);
        if (r.label) setLabel(r.label);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [window, limit]);

  // Hide entirely if there's literally nothing — don't show an empty rail.
  if (!loading && items.length === 0) return null;

  return (
    <div style={{
      flexShrink: 0,
      padding: "10px 16px 8px",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      background: "#0a0a0a",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
          color: "rgba(255,255,255,0.55)",
        }}>
          {label}
        </span>
        <Link
          to="/trending"
          onClick={() => analytics.trendingModuleClicked(surface, "see_all", null)}
          style={{ fontSize: 11, color: ACCENT_A, textDecoration: "none", fontWeight: 600 }}
        >
          See all →
        </Link>
      </div>
      <div style={{
        display: "flex", gap: 10, overflowX: "auto", overflowY: "hidden",
        scrollbarWidth: "none", WebkitOverflowScrolling: "touch",
        paddingBottom: 4,
      }}>
        {loading && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ width: 88, height: 88, borderRadius: 8, background: "rgba(255,255,255,0.05)", flexShrink: 0 }} />
        ))}
        {items.map((it) => (
          <Link
            key={it.id}
            to={`/album/${it.id}`}
            onClick={() => analytics.trendingModuleClicked(surface, "album", it.id)}
            style={{
              width: 88, flexShrink: 0, textDecoration: "none", color: "var(--text)",
              display: "flex", flexDirection: "column", gap: 4,
            }}
          >
            {it.image_url
              ? <img src={it.image_url} alt={it.name} style={{ width: 88, height: 88, borderRadius: 8, objectFit: "cover" }} />
              : <div style={{ width: 88, height: 88, borderRadius: 8, background: "rgba(255,255,255,0.07)" }} />
            }
            <span style={{
              fontSize: 11, fontWeight: 600, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{it.name ?? "—"}</span>
            <span style={{
              fontSize: 10, color: "rgba(255,255,255,0.5)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{it.artist ?? ""}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
