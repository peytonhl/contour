import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { EmptyHint } from "../components/Skeleton.jsx";

const ACCENT_A = "#d97a3b";
const ACCENT_B = "#6a90b5";
const GOLD = "#f59e0b";

const WINDOW_OPTIONS = [
  { key: "24h", label: "24h" },
  { key: "7d",  label: "Week" },
  { key: "30d", label: "Month" },
  { key: "all", label: "All time" },
];

// ── Section header ────────────────────────────────────────────────────────────
// Optional italic eyebrow for editorial section labels. Sentence-case heading
// inherits Instrument Serif from the global h2 rule; the eyebrow leans on the
// same font in italic to feel composed rather than chrome-y. No UPPERCASE +
// letter-spacing — that pattern was the AI-template look the design system
// explicitly walked away from.
function SectionHeader({ label, eyebrow }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {eyebrow && (
        <div style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 13,
          color: "var(--text-muted)",
          marginBottom: 2,
        }}>
          {eyebrow}
        </div>
      )}
      <h2 style={{ fontSize: 24, margin: 0, color: "var(--text)" }}>{label}</h2>
    </div>
  );
}

// ── Hero spotlight ────────────────────────────────────────────────────────────
// Treats the #1 trending album as the cinematic anchor of the page — large
// cover at left, serif title at right, italic eyebrow above. The whole tile
// is a single Link so the click target is generous. Stacks vertically on
// mobile via the shared .hero-row class (defined in index.css).
function HeroAlbumSpotlight({ item, eyebrow, surface }) {
  if (!item) return null;
  const handleClick = () => analytics.trendingModuleClicked(surface, "album", item.id);
  return (
    <Link
      to={`/album/${item.id}`}
      onClick={handleClick}
      style={{
        display: "block",
        background: "var(--surface)",
        borderRadius: "var(--radius-lg)",
        padding: 20,
        textDecoration: "none",
        color: "var(--text)",
        boxShadow: "var(--shadow-2)",
      }}
    >
      <div
        className="hero-row"
        style={{ display: "flex", gap: 22, alignItems: "center" }}
      >
        {item.image_url
          ? <img
              src={item.image_url}
              alt={item.name ?? ""}
              className="hero-img"
              style={{
                width: 220, height: 220, flexShrink: 0,
                borderRadius: "var(--radius-md)",
                objectFit: "cover",
                boxShadow: "var(--shadow-hero)",
              }}
            />
          : <div
              className="hero-img"
              style={{
                width: 220, height: 220, flexShrink: 0,
                borderRadius: "var(--radius-md)",
                background: "var(--surface2)",
              }}
            />
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          {eyebrow && (
            <div style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 14,
              color: ACCENT_A,
              marginBottom: 6,
            }}>
              {eyebrow}
            </div>
          )}
          <div style={{
            fontFamily: "var(--font-display)",
            fontSize: 38,
            lineHeight: 1.05,
            color: "var(--text)",
            marginBottom: 6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}>
            {item.name ?? "—"}
          </div>
          {item.artist && (
            <div style={{
              fontSize: 15,
              color: "var(--text-muted)",
              marginBottom: 14,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {item.artist}
            </div>
          )}
          <div style={{
            display: "flex", gap: 18, alignItems: "baseline",
            fontSize: 13, color: "var(--text-muted)",
            flexWrap: "wrap",
          }}>
            {item.rating_count > 0 && (
              <span>
                <span style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 22, color: "var(--text)",
                  marginRight: 5,
                }}>
                  {item.rating_count}
                </span>
                {item.rating_count === 1 ? "rating" : "ratings"}
              </span>
            )}
            {item.backlog_count > 0 && (
              <span>
                <span style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 22, color: "var(--text)",
                  marginRight: 5,
                }}>
                  {item.backlog_count}
                </span>
                saved
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Ranked list ───────────────────────────────────────────────────────────────
// Replaces the second 4-wide AlbumGrid with a Pitchfork-style ranked vertical
// list: large italic serif rank numbers left of each row, cover thumb, name +
// artist stacked, rating count right-aligned. The point isn't ranking density
// (the hero already implies that) — it's giving the page a different visual
// rhythm so two album sections don't read as the same grid twice.
function RankedAlbumList({ items, startRank = 2, surface }) {
  if (!items?.length) {
    return <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>Nothing else to show here yet.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((it, i) => {
        const rank = startRank + i;
        return (
          <Link
            key={it.id}
            to={`/album/${it.id}`}
            onClick={() => analytics.trendingModuleClicked(surface, "album", it.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "12px 4px",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
              textDecoration: "none",
              color: "var(--text)",
              transition: "background var(--motion-base) var(--ease)",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <div style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 30,
              color: "var(--text-muted)",
              minWidth: 44,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
            }}>
              {String(rank).padStart(2, "0")}
            </div>
            {it.image_url
              ? <img src={it.image_url} alt="" style={{ width: 56, height: 56, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 }} />
              : <div style={{ width: 56, height: 56, borderRadius: "var(--radius-sm)", background: "var(--surface2)", flexShrink: 0 }} />
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 15, fontWeight: 600, marginBottom: 2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {it.name ?? "—"}
              </div>
              <div style={{
                fontSize: 12, color: "var(--text-muted)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {it.artist ?? ""}
              </div>
            </div>
            {it.rating_count > 0 && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0, textAlign: "right" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "var(--text)" }}>
                  {it.rating_count}
                </div>
                <div style={{ fontSize: 10 }}>
                  {it.rating_count === 1 ? "rating" : "ratings"}
                </div>
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}

// ── Horizontal shelf ──────────────────────────────────────────────────────────
// Streaming-service-style swipeable row. Different from the ranked list above
// (which is ordered + dense) and from the original grid (which packs the
// viewport). Bleeds to the page edge via the .scroll-shelf utility so the
// row visibly continues off-screen — invites the swipe.
function HorizontalAlbumShelf({ items, surface }) {
  if (!items?.length) {
    return <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>Nothing here yet.</p>;
  }
  return (
    <div className="scroll-shelf">
      {items.map((it) => (
        <Link
          key={it.id}
          to={`/album/${it.id}`}
          onClick={() => analytics.trendingModuleClicked(surface, "album", it.id)}
          style={{
            width: 148,
            textDecoration: "none",
            color: "var(--text)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {it.image_url
            ? <img src={it.image_url} alt={it.name ?? ""} style={{ width: 148, height: 148, borderRadius: "var(--radius-md)", objectFit: "cover" }} />
            : <div style={{ width: 148, height: 148, borderRadius: "var(--radius-md)", background: "var(--surface2)" }} />
          }
          <div style={{
            fontSize: 13, fontWeight: 600, lineHeight: 1.25,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {it.name ?? "—"}
          </div>
          <div style={{
            fontSize: 12, color: "var(--text-muted)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            marginTop: -4,
          }}>
            {it.artist ?? ""}
          </div>
          {it.backlog_count > 0 && (
            <div style={{ fontSize: 11, color: ACCENT_B, fontWeight: 600 }}>
              {it.backlog_count} saved
            </div>
          )}
        </Link>
      ))}
    </div>
  );
}

function ReviewList({ items, surface }) {
  if (!items?.length) {
    return <EmptyHint dense>No reviews to show.</EmptyHint>;
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
              border: "1px solid var(--border)", borderRadius: "var(--radius)",
              textDecoration: "none", color: "var(--text)",
            }}
          >
            {target?.image_url
              ? <img src={target.image_url} alt="" style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 }} />
              : <div style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", background: "var(--surface2)", flexShrink: 0 }} />
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
            padding: "6px 14px", borderRadius: "var(--radius-pill)",
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

  const heroAlbum = albums?.items?.[0];
  const restAlbums = albums?.items?.slice(1, 8) ?? [];
  const eyebrowByWindow = {
    "24h": "Top of the chart, last 24 hours",
    "7d":  "Top of the chart this week",
    "30d": "Top of the chart this month",
    "all": "Top of the chart, all time",
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "32px 20px 80px", display: "flex", flexDirection: "column", gap: 36 }}>

      <div>
        <h1 style={{ fontSize: 40, margin: "0 0 6px", color: "var(--text)" }}>
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
              padding: "6px 14px", borderRadius: "var(--radius-pill)",
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

      {/* ── Hero spotlight ── */}
      {albums == null ? (
        <div style={{ height: 260, background: "var(--surface)", borderRadius: "var(--radius-lg)" }} className="skeleton" />
      ) : heroAlbum ? (
        <HeroAlbumSpotlight
          item={heroAlbum}
          eyebrow={eyebrowByWindow[window] ?? "Top of the chart"}
          surface="trending_page"
        />
      ) : null}

      {/* ── Ranked list (positions 2–8) ── */}
      {(albums == null || restAlbums.length > 0) && (
        <section>
          <SectionHeader
            label={albums?.label ?? "The rest of the chart"}
            eyebrow="Right behind"
          />
          {albums == null
            ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
            : <RankedAlbumList items={restAlbums} startRank={2} surface="trending_page" />}
        </section>
      )}

      {/* ── Backlogged: horizontal shelf ── */}
      <section>
        <SectionHeader
          label={backlogged?.label ? `${backlogged.label} · most-saved` : "Most saved to backlogs"}
          eyebrow="Queued up around the network"
        />
        {backlogged == null
          ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
          : <HorizontalAlbumShelf items={backlogged.items} surface="trending_page" />}
      </section>

      {/* ── Reviews ── */}
      <section>
        <SectionHeader label="Top reviews" eyebrow="What people are writing" />
        {reviews == null
          ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
          : <ReviewList items={reviews.items} surface="trending_page" />}
      </section>

      {/* ── Searched ── */}
      <section>
        <SectionHeader label="Trending searches" eyebrow="Tap to pick up the thread" />
        {searched == null
          ? <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading…</p>
          : <SearchChips items={searched.items} surface="trending_page" />}
      </section>

    </div>
  );
}
