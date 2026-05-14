import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";

const ACCENT_A = "#d97a3b";
const ACCENT_B = "#6a90b5";
const GOLD = "#f59e0b";

const WINDOW_OPTIONS = [
  { key: "24h", label: "24h" },
  { key: "7d",  label: "Week" },
  { key: "30d", label: "Month" },
  { key: "all", label: "All time" },
];

function SectionHeader({ label }) {
  return (
    <h2 style={{
      fontFamily: "var(--font-display)",
      fontSize: 22, fontWeight: 400,
      color: "var(--text)", margin: "0 0 12px",
    }}>
      {label}
    </h2>
  );
}

function AlbumGrid({ items, surface }) {
  if (!items?.length) {
    return <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>Nothing here yet.</p>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 14 }}>
      {items.map((it) => (
        <Link
          key={it.id}
          to={`/album/${it.id}`}
          onClick={() => analytics.trendingModuleClicked(surface, "album", it.id)}
          style={{
            textDecoration: "none", color: "var(--text)",
            display: "flex", flexDirection: "column", gap: 6,
            transition: "transform 0.15s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
          onMouseLeave={(e) => e.currentTarget.style.transform = "none"}
        >
          {it.image_url
            ? <img src={it.image_url} alt={it.name ?? ""} style={{ width: "100%", aspectRatio: "1", borderRadius: 8, objectFit: "cover" }} />
            : <div style={{ width: "100%", aspectRatio: "1", borderRadius: 8, background: "var(--surface2)" }} />
          }
          <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {it.name ?? "—"}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {it.artist ?? ""}
            {it.rating_count > 0 && <span> · {it.rating_count} ratings</span>}
            {it.backlog_count > 0 && <span> · {it.backlog_count} backlogs</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}

function ReviewList({ items, surface }) {
  if (!items?.length) {
    return <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>No reviews to show.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((rv) => {
        const target = rv.entity_meta;
        return (
          <Link
            key={rv.id}
            to={`/${rv.entity_type}/${rv.entity_id}`}
            onClick={() => analytics.trendingModuleClicked(surface, "review", rv.id)}
            style={{
              display: "flex", gap: 12, alignItems: "flex-start",
              padding: "12px 14px", background: "var(--surface)",
              border: "1px solid var(--border)", borderRadius: 10,
              textDecoration: "none", color: "var(--text)",
            }}
          >
            {target?.image_url
              ? <img src={target.image_url} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
              : <div style={{ width: 48, height: 48, borderRadius: 6, background: "var(--surface2)", flexShrink: 0 }} />
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>
                <span style={{ color: ACCENT_A, fontWeight: 600 }}>{rv.user?.display_name ?? "Someone"}</span>
                {" on "}<span style={{ color: "var(--text)", fontWeight: 600 }}>{target?.name ?? rv.entity_id}</span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {rv.body}
              </p>
              {rv.score > 0 && (
                <div style={{ fontSize: 11, color: GOLD, marginTop: 4 }}>+{rv.score}</div>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function SearchChips({ items, surface }) {
  if (!items?.length) {
    return <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>No searches to show yet.</p>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {items.map((s) => (
        <Link
          key={s.query}
          to={`/search?q=${encodeURIComponent(s.query)}`}
          onClick={() => analytics.trendingModuleClicked(surface, "search", s.query)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 18,
            background: "var(--surface)", border: "1px solid var(--border)",
            textDecoration: "none", color: "var(--text)", fontSize: 13,
          }}
        >
          <span>{s.query}</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· {s.count}</span>
        </Link>
      ))}
    </div>
  );
}

export function TrendingPage() {
  const [window, setWindow] = useState("7d");
  const [albums, setAlbums] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [backlogged, setBacklogged] = useState(null);
  const [searched, setSearched] = useState(null);

  useEffect(() => {
    analytics.trendingPageViewed();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Reset to skeleton state on window change.
    setAlbums(null); setReviews(null); setBacklogged(null); setSearched(null);
    Promise.all([
      api.getTrendingAlbums(window, 20).catch(() => ({ items: [], label: "Trending" })),
      api.getTrendingReviews(window, 10).catch(() => ({ items: [], label: "Trending" })),
      api.getTrendingBacklogged(window, 20).catch(() => ({ items: [], label: "Trending" })),
      api.getTrendingSearched(window, 12).catch(() => ({ items: [], label: "Trending" })),
    ]).then(([a, r, b, s]) => {
      if (cancelled) return;
      setAlbums(a); setReviews(r); setBacklogged(b); setSearched(s);
    });
    return () => { cancelled = true; };
  }, [window]);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "32px 20px 80px", display: "flex", flexDirection: "column", gap: 32 }}>

      <div>
        <h1 style={{
          fontSize: 40, fontWeight: 400, margin: "0 0 6px",
          color: "var(--text)",
        }}>
          Trending
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          What people are rating and saving this week.
        </p>
      </div>

      {/* Window picker */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {WINDOW_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setWindow(opt.key)}
            style={{
              padding: "6px 14px", borderRadius: 18,
              border: `1px solid ${window === opt.key ? ACCENT_A : "var(--border)"}`,
              background: window === opt.key ? `${ACCENT_A}18` : "transparent",
              color: window === opt.key ? ACCENT_A : "var(--text-muted)",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Albums */}
      <section>
        <SectionHeader label={albums?.label ?? "Top albums"} />
        {albums == null
          ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
          : <AlbumGrid items={albums.items} surface="trending_page" />}
      </section>

      {/* Backlogged */}
      <section>
        <SectionHeader label={backlogged?.label ? `${backlogged.label} · most-saved` : "Most saved to backlogs"} />
        {backlogged == null
          ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
          : <AlbumGrid items={backlogged.items} surface="trending_page" />}
      </section>

      {/* Reviews */}
      <section>
        <SectionHeader label="Top reviews" />
        {reviews == null
          ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
          : <ReviewList items={reviews.items} surface="trending_page" />}
      </section>

      {/* Searched */}
      <section>
        <SectionHeader label="Trending searches" />
        {searched == null
          ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
          : <SearchChips items={searched.items} surface="trending_page" />}
      </section>

    </div>
  );
}
