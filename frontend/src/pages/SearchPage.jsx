import { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { AppleSignInButton } from "../components/AppleSignInButton.jsx";
import { ChartsTabs } from "../components/ChartsTabs.jsx";
import { withNativeAuthFlag, externalLinkProps } from "../utils/native.js";
import { ACCENT_A, ACCENT_B, ACCENT_C, GOLD } from "../theme.js";

// withNativeAuthFlag appends ?from=native inside the Capacitor shell so the
// backend OAuth callback redirects via the contour:// URL scheme. No-op on web.
const LOGIN_URL = withNativeAuthFlag(`${import.meta.env.VITE_API_URL ?? ""}/auth/login`);
const RECENT_KEY = "contour_recent_v1";
const RECENT_MAX = 8;

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}
function saveRecent(item) {
  const prev = loadRecent().filter((r) => r.id !== item.id);
  localStorage.setItem(RECENT_KEY, JSON.stringify([item, ...prev].slice(0, RECENT_MAX)));
}

function formatStreams(n) {
  if (!n && n !== 0) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B streams`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M streams`;
  return null;
}

const TYPE_LABELS = { album: "album", track: "track", artist: "artist", user: "user" };
const TYPE_COLORS = { album: ACCENT_A, track: ACCENT_B, artist: ACCENT_C, user: "#60a5fa" };

// ── Inline rating widget for search results ───────────────────────────────────
// 5 tappable stars rendered to the right of an album/track row in the search
// dropdown. Lets users rate without clicking through to the entity page —
// addresses the "I can't refine my For You feed by manually rating things I
// know I like" feedback. Each star is a 28px touch target on mobile.
//
// Half-star values aren't supported here (too fiddly inside a search row);
// users wanting 4.5 vs 5 can still click through to the entity page where
// the full StarRating widget is.
function InlineRate({ entityType, entityId, initialValue, onSaved }) {
  const [value, setValue] = useState(initialValue ?? 0);
  const [hover, setHover] = useState(0);
  const [saving, setSaving] = useState(false);
  const display = hover || value;

  async function rate(v) {
    if (saving) return;
    setSaving(true);
    const prev = value;
    setValue(v);  // optimistic
    try {
      await api.rateEntity(entityType, entityId, v);
      onSaved?.(v);
    } catch {
      setValue(prev);  // revert on failure
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onMouseLeave={() => setHover(0)}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex", gap: 1, flexShrink: 0,
        opacity: saving ? 0.55 : 1,
      }}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const lit = display >= n;
        return (
          <button
            key={n}
            onMouseEnter={() => setHover(n)}
            onClick={(e) => { e.stopPropagation(); rate(n); }}
            disabled={saving}
            aria-label={`Rate ${n} stars`}
            style={{
              padding: "4px 2px", minWidth: 24,
              background: "none", border: "none", cursor: "pointer",
              color: lit ? GOLD : "var(--border)",
              opacity: lit ? 1 : 0.4,
              fontSize: 16, lineHeight: 1,
              transition: "color var(--motion-fast) var(--ease)",
            }}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

function GoogleIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}

function FeaturedCard({ item, type }) {
  const navigate = useNavigate();
  const path = type === "album" ? `/album/${item.id}` : `/track/${item.id}`;
  return (
    <button
      onClick={() => navigate(path)}
      style={{
        // width: 100% is load-bearing — buttons are intrinsically sized in CSS
        // grid (they don't honor the default `stretch` alignment the way plain
        // divs do), so without this albums with larger natural cover images
        // render visibly bigger than ones with smaller covers. Keeps the grid
        // uniform regardless of any wrapper around the card.
        width: "100%",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius)", overflow: "hidden", cursor: "pointer",
        textAlign: "left", transition: "border-color 0.15s, transform 0.15s",
        display: "flex", flexDirection: "column",
        padding: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = TYPE_COLORS[type]; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = "none"; }}
    >
      {item.image_url
        ? <img src={item.image_url} alt={item.name} loading="lazy" decoding="async" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
        : <div style={{ width: "100%", aspectRatio: "1", background: "var(--surface2)" }} />
      }
      <div style={{ padding: "10px 12px", flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>
          {item.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {Array.isArray(item.artists) ? item.artists.join(", ") : item.artists}
        </div>
      </div>
    </button>
  );
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [featured, setFeatured] = useState(null);
  const [recent, setRecent] = useState(loadRecent);
  const [trendingSearches, setTrendingSearches] = useState([]);
  // Contour's own community-ranked trending. The backend returns a `label`
  // that downshifts ("Trending this week" → "Popular on Contour") when the
  // requested window is too sparse, so we render whatever it gives us.
  const [popular, setPopular] = useState(null);
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const debounceRef = useRef(null);

  useEffect(() => {
    api.getFeatured().then(setFeatured).catch(() => {});
    // Trending search queries — only shown when the search box is empty.
    api.getTrendingSearched("7d", 10)
      .then((r) => setTrendingSearches(r.items ?? []))
      .catch(() => {});
    api.getTrendingAlbums("7d", 10)
      .then((r) => setPopular(r))
      .catch(() => {});
  }, []);

  function handleInput(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const [searchRes, artists] = await Promise.all([
          api.search(q).catch(() => ({ users: [], albums: [], tracks: [] })),
          api.searchArtists(q).catch(() => []),
        ]);
        const tagged = [
          ...(searchRes.albums || []).slice(0, 4).map(r => ({ ...r, _type: "album" })),
          ...(searchRes.tracks || []).slice(0, 4).map(r => ({ ...r, _type: "track" })),
          ...artists.slice(0, 3).map(r => ({ ...r, _type: "artist" })),
          ...(searchRes.users || []).slice(0, 3).map(r => ({ ...r, name: r.display_name, _type: "user" })),
        ];
        setResults(tagged);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  }

  function handleSelect(item) {
    saveRecent({ id: item.id, name: item.name, image_url: item.image_url, _type: item._type,
      sub: Array.isArray(item.artists) ? item.artists.join(", ") : (item.artists ?? "") });
    setRecent(loadRecent());
    if (item._type === "album") navigate(`/album/${item.id}`);
    else if (item._type === "track") navigate(`/track/${item.id}`);
    else if (item._type === "user") navigate(`/user/${item.id}`);
    else navigate(`/artist/${item.id}`);
  }

  function clearRecent() {
    localStorage.removeItem(RECENT_KEY);
    setRecent([]);
  }

  const hasResults = results.length > 0;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px 60px", display: "flex", flexDirection: "column", gap: 28 }}>

      {/* Tabs: Search / Trending / Charts. Active = Search on this route. */}
      <ChartsTabs />

      {/* Search bar — the hero */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: -12 }}>
        <div style={{ position: "relative" }}>
          <div style={{
            display: "flex", background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: hasResults
              ? "var(--radius-lg) var(--radius-lg) 0 0"
              : "var(--radius-lg)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
          }}>
            <input
              autoFocus
              value={query}
              onChange={handleInput}
              placeholder="Search albums, tracks, artists, users…"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              style={{
                flex: 1, padding: "18px 16px 18px 20px", fontSize: 16,
                background: "transparent", border: "none", outline: "none",
                color: "var(--text)",
              }}
            />
            {searching && (
              <div style={{ display: "flex", alignItems: "center", paddingRight: 18, color: "var(--text-muted)", fontSize: 12 }}>…</div>
            )}
          </div>

          {hasResults && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)", overflow: "hidden" }}>
              {results.map((item, i) => {
                const canRateInline = user && (item._type === "album" || item._type === "track");
                return (
                  <div
                    key={`${item._type}-${item.id}`}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 14,
                      padding: "10px 16px", background: "transparent",
                      borderTop: i > 0 ? "1px solid var(--border)" : "none",
                      color: "var(--text)",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    {/* Navigation area — image + text → entity page */}
                    <div
                      onClick={() => handleSelect(item)}
                      style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0, cursor: "pointer" }}
                    >
                      {item.image_url
                        ? <img src={item.image_url} alt={item.name} loading="lazy" decoding="async" style={{ width: 40, height: 40, borderRadius: (item._type === "artist" || item._type === "user") ? "50%" : 5, objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 40, height: 40, borderRadius: (item._type === "artist" || item._type === "user") ? "50%" : 5, background: "var(--surface2)", flexShrink: 0 }} />
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item._type === "user"
                            ? (item.bio ? item.bio.slice(0, 60) + (item.bio.length > 60 ? "…" : "") : "Contour user")
                            : <>
                                {Array.isArray(item.artists) ? item.artists.join(", ") : item.artists}
                                {item.release_date && ` · ${item.release_date.slice(0, 4)}`}
                                {formatStreams(item.streams) && ` · ${formatStreams(item.streams)}`}
                              </>
                          }
                        </div>
                      </div>
                    </div>

                    {/* Inline rate — album/track only, signed-in only.
                        Lets users rate directly from search instead of
                        clicking through, addressing the "I can't refine my
                        For You by rating things I know I like" feedback. */}
                    {canRateInline && (
                      <InlineRate
                        entityType={item._type}
                        entityId={item.id}
                        onSaved={() => analytics.ratingSubmitted?.(item._type, item.id, null)}
                      />
                    )}

                    {/* Type label — italic serif, sentence-case, no chip
                        chrome. Matches the rest of the redesign pass. */}
                    <span
                      onClick={() => handleSelect(item)}
                      style={{
                        fontFamily: "var(--font-display)", fontStyle: "italic",
                        fontSize: 12, color: TYPE_COLORS[item._type],
                        flexShrink: 0, cursor: "pointer",
                      }}
                    >
                      {TYPE_LABELS[item._type]}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {query && !searching && results.length === 0 && (
            <div style={{ padding: 16, background: "var(--surface)", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
              No results for "{query}"
            </div>
          )}
        </div>

        {/* Quick hint + Compare affordance — only while idle. Compare moved
            here from its old slot in the page header now that ChartsTabs
            occupies the top. The Search↔Compare adjacency still reads
            naturally (find one thing → find two side-by-side). */}
        {!query && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              Albums, tracks, artists, and other listeners, all in one box.
            </p>
            <Link
              to="/compare"
              style={{
                fontSize: 12, fontWeight: 600,
                padding: "6px 12px", borderRadius: "var(--radius-lg)",
                background: "var(--surface)", border: "1px solid var(--border)",
                color: "var(--text-muted)", textDecoration: "none",
                display: "inline-flex", alignItems: "center", gap: 6,
                whiteSpace: "nowrap",
              }}
              title="Side-by-side streaming trajectory comparison"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3L4 7l4 4" /><path d="M4 7h16" />
                <path d="M16 21l4-4-4-4" /><path d="M20 17H4" />
              </svg>
              Compare two albums
            </Link>
          </div>
        )}
      </div>

      {/* Recent searches */}
      {!query && recent.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 400, color: "var(--text)", margin: 0 }}>
              Recent
            </h2>
            <button
              onClick={clearRecent}
              style={{ fontSize: 12, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              Clear
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {recent.map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(
                  item._type === "album" ? `/album/${item.id}`
                  : item._type === "track" ? `/track/${item.id}`
                  : item._type === "user" ? `/user/${item.id}`
                  : `/artist/${item.id}`
                )}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 12px 6px 6px",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-pill)", cursor: "pointer", color: "var(--text)",
                  transition: "border-color 0.12s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = ACCENT_A}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
              >
                {item.image_url
                  ? <img src={item.image_url} alt={item.name} loading="lazy" decoding="async" style={{ width: 24, height: 24, borderRadius: item._type === "artist" ? "50%" : 4, objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 24, height: 24, borderRadius: item._type === "artist" ? "50%" : 4, background: "var(--surface2)", flexShrink: 0 }} />
                }
                <div style={{ textAlign: "left", minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{item.name}</div>
                  {item.sub && <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{item.sub}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Trending searches — only when the box is empty. Chips run a search
          on tap rather than navigating, so the user lands in the same flow as
          typing the query themselves. */}
      {!query && trendingSearches.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 400, color: "var(--text)", margin: 0 }}>
            Trending searches
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {trendingSearches.map((s) => (
              <button
                key={s.query}
                onClick={() => {
                  analytics.trendingModuleClicked("search_empty", "search", s.query);
                  setQuery(s.query);
                  handleInput({ target: { value: s.query } });
                }}
                style={{
                  padding: "6px 14px", borderRadius: "var(--radius-xl)",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 13, cursor: "pointer",
                  transition: "border-color 0.12s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = ACCENT_A}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
              >
                {s.query}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sign-in nudge for logged-out users */}
      {!authLoading && !user && !query && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", padding: "14px 18px", flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Rate, review &amp; follow listeners</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Sign in to unlock ratings, reviews, and your personalized feed.</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
            <a
              href={LOGIN_URL}
              {...externalLinkProps()}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 16px", background: "#fff", borderRadius: "var(--radius-xl)",
                color: "#3c3c3c", fontSize: 13, fontWeight: 600, textDecoration: "none",
                border: "1px solid #dadce0",
              }}
            >
              <GoogleIcon size={15} />
              Sign in with Google
            </a>
            <AppleSignInButton />
          </div>
        </div>
      )}

      {/* Popular on Contour — community-driven, shown first because it's the
          on-brand surface (Spotify's "Trending right now" + "New releases"
          below are useful but generic to the platform). Uses the honest label
          from the backend so a sparse week shows "Popular on Contour" rather
          than mislabeling. */}
      {!query && popular?.items?.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>
              {popular.label}
            </h2>
            <Link
              to="/trending"
              onClick={() => analytics.trendingModuleClicked("search_empty", "see_all", null)}
              style={{ fontSize: 12, color: ACCENT_A, textDecoration: "none", fontWeight: 600 }}
            >
              See all
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
            {popular.items.map((it) => (
              // `display: contents` lets this wrapper bubble the analytics
              // click without taking part in layout — otherwise the inner
              // <button> wouldn't stretch to the grid cell and cards would
              // sort themselves by their cover image's natural size.
              <div
                key={it.id}
                onClick={() => analytics.trendingModuleClicked("search_empty", "album", it.id)}
                style={{ display: "contents" }}
              >
                <FeaturedCard item={{ ...it, artists: it.artist }} type="album" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Featured — only show when not searching */}
      {!query && featured && (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>

          {featured.top_tracks?.length > 0 && (
            <div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, marginBottom: 14, color: "var(--text)" }}>
                Trending this week
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
                {featured.top_tracks.map((track) => (
                  <FeaturedCard key={track.id} item={track} type="track" />
                ))}
              </div>
            </div>
          )}

          {featured.new_releases?.length > 0 && (
            <div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 400, marginBottom: 14, color: "var(--text)" }}>
                New releases
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
                {featured.new_releases.map((album) => (
                  <FeaturedCard key={album.id} item={album} type="album" />
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
