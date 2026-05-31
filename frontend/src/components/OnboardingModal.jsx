import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import { analytics } from "../services/analytics.js";
import { api } from "../services/api.js";
import { ACCENT_A, ACCENT_B, ACCENT_C, GOLD, DANGER } from "../theme.js";
import { profileTabPath } from "../constants/routes.js";
import { groupedSeedArtists } from "../data/seedArtists.js";

const STORAGE_KEY = "contour_onboarded_v2";

// Onboarding artist-seed. Names the user picks here are stored as a JSON
// array under this localStorage key and read by ForYouPage's fetchBatch,
// which sends them to /discover/feed as `seed_artists`. NOT written to the
// server profile — it's a decaying cold-start prior, not a persistent pref
// (ForYouPage tapers it out as real ratings accumulate). Same key string
// is referenced in ForYouPage.jsx (SEED_ARTISTS_KEY).
const SEED_ARTISTS_KEY = "contour_seed_artists_v1";
// Decay baseline (see ForYouPage SEED_BASELINE_KEY). We stamp the user's
// current rating count when they pick artists so the seed decays from here —
// this is what lets a returning user who replays onboarding re-seed the
// similarity feed at full strength instead of getting an already-decayed one.
const SEED_BASELINE_KEY = "contour_seed_baseline_v1";

// ── Genre picker data (also exported for reuse in TasteSection) ───────────────
//
// Two-tier vocabulary, base + extended:
//   - GENRE_OPTIONS_BASE: the 18 broad genres shown by default. Covers most
//     of mainstream listening; keeps the picker scannable at-a-glance.
//   - GENRE_OPTIONS_EXTENDED: ~40 sub-genres revealed by the "View more"
//     button in TasteSection. These resolve to artist-genre matches via
//     backend/services/spotify.py:_GENRE_MATCH_ALIASES — slugs not in that
//     map fall through to substring matching against the slug itself, so
//     adding a new slug here is safe even if the alias map is missing it.
//
// `slug` is what the backend stores, what we send to /discover/feed, and
// what _GENRE_MATCH_ALIASES keys off — keep them in sync. Color gradients
// are picker-cosmetic only.
//
// GENRE_OPTIONS is exported as the combined list for callers that don't
// care about the split (legacy code, profile-page badges, etc).
export const GENRE_OPTIONS_BASE = [
  { label: "Hip-Hop",     slug: "hip-hop",      from: "#fb923c", to: "#f97316" },
  { label: "R&B",         slug: "r-n-b",        from: "#c084fc", to: "#a855f7" },
  { label: "Pop",         slug: "pop",          from: "#f472b6", to: "#ec4899" },
  { label: "Indie",       slug: "indie",        from: ACCENT_A,  to: "#7c3aed" },
  { label: "Alternative", slug: "alternative",  from: "#d97a3b", to: "#6d28d9" },
  { label: "Rock",        slug: "rock",         from: "#f87171", to: "#dc2626" },
  { label: "Electronic",  slug: "electronic",   from: "#22d3ee", to: "#06b6d4" },
  { label: "Jazz",        slug: "jazz",         from: "#fcd34d", to: "#f59e0b" },
  { label: "Soul",        slug: "soul",         from: "#fbbf24", to: "#f59e0b" },
  { label: "Classical",   slug: "classical",    from: "#60a5fa", to: "#3b82f6" },
  { label: "Country",     slug: "country",      from: "#4ade80", to: "#16a34a" },
  { label: "Folk",        slug: "folk",         from: "#86efac", to: "#22c55e" },
  { label: "Metal",       slug: "metal",        from: "#9ca3af", to: "#4b5563" },
  { label: "K-Pop",       slug: "k-pop",        from: "#f9a8d4", to: "#fb7185" },
  { label: "Latin",       slug: "latin",        from: "#fb923c", to: "#fcd34d" },
  { label: "Reggae",      slug: "reggae",       from: "#4ade80", to: "#a3e635" },
  { label: "Funk",        slug: "funk",         from: "#f59e0b", to: "#fb923c" },
  { label: "Ambient",     slug: "ambient",      from: "#67e8f9", to: "#818cf8" },
];

export const GENRE_OPTIONS_EXTENDED = [
  // Hip-hop family
  { label: "Trap",          slug: "trap",          from: "#fb923c", to: "#ef4444" },
  { label: "Drill",         slug: "drill",         from: "#f97316", to: "#9a3412" },
  { label: "Boom Bap",      slug: "boom-bap",      from: "#fbbf24", to: "#92400e" },
  { label: "Grime",         slug: "grime",         from: "#a3a3a3", to: "#525252" },
  // Electronic family
  { label: "House",         slug: "house",         from: "#22d3ee", to: "#0ea5e9" },
  { label: "Techno",        slug: "techno",        from: "#94a3b8", to: "#475569" },
  // Drum & Bass: replaces forbidden Tailwind emerald (#34d399). Stays in
  // the cool/electronic family — no theme.js export fits a cool-tone bass
  // genre (the brand palette is warm), so a non-Tailwind teal is the
  // smallest correct change.
  { label: "Drum & Bass",   slug: "drum-and-bass", from: "#14b8a4", to: "#0d9488" },
  // Dubstep: replaces forbidden Tailwind violet (#a78bfa). Uses ACCENT_C
  // from theme.js (warm orange) against the existing deep-violet `to` —
  // reads as a sunset gradient, bold but on-palette.
  { label: "Dubstep",       slug: "dubstep",       from: ACCENT_C,  to: "#6d28d9" },
  { label: "Lo-Fi",         slug: "lo-fi",         from: "#fde68a", to: "#a16207" },
  { label: "Synthpop",      slug: "synthpop",      from: "#f472b6", to: "#7c3aed" },
  { label: "New Wave",      slug: "new-wave",      from: "#c084fc", to: "#4338ca" },
  { label: "Disco",         slug: "disco",         from: "#f9a8d4", to: "#db2777" },
  // Rock family
  { label: "Indie Rock",    slug: "indie-rock",    from: "#fb7185", to: "#9f1239" },
  { label: "Indie Pop",     slug: "indie-pop",     from: "#f9a8d4", to: "#be185d" },
  { label: "Indie Folk",    slug: "indie-folk",    from: "#86efac", to: "#15803d" },
  { label: "Shoegaze",      slug: "shoegaze",      from: "#a5b4fc", to: "#4338ca" },
  { label: "Dream Pop",     slug: "dream-pop",     from: "#f0abfc", to: "#86198f" },
  { label: "Post-Punk",     slug: "post-punk",     from: "#71717a", to: "#27272a" },
  { label: "Punk",          slug: "punk",          from: "#fb7185", to: "#7f1d1d" },
  { label: "Hardcore",      slug: "hardcore",      from: "#dc2626", to: "#450a0a" },
  // Emo: replaces forbidden Tailwind violet (#a78bfa). Uses DANGER from
  // theme.js (red) against the existing deep-indigo `to` — dramatic
  // red→indigo transition. Distinct from neighboring Hardcore (red→dark
  // red) by virtue of the indigo endpoint.
  { label: "Emo",           slug: "emo",           from: DANGER,    to: "#3730a3" },
  { label: "Prog Rock",     slug: "prog-rock",     from: "#818cf8", to: "#312e81" },
  // Jazz / soul family
  { label: "Jazz Fusion",   slug: "jazz-fusion",   from: "#fcd34d", to: "#b45309" },
  { label: "Bossa Nova",    slug: "bossa-nova",    from: "#fde68a", to: "#ca8a04" },
  { label: "Blues",         slug: "blues",         from: "#60a5fa", to: "#1e40af" },
  { label: "Gospel",        slug: "gospel",        from: "#fde047", to: "#854d0e" },
  // Country / folk family
  { label: "Bluegrass",     slug: "bluegrass",     from: "#84cc16", to: "#365314" },
  // Latin family
  { label: "Reggaeton",     slug: "reggaeton",     from: "#fb923c", to: "#c2410c" },
  { label: "Salsa",         slug: "salsa",         from: "#fbbf24", to: "#b45309" },
  // World family
  { label: "Afrobeat",      slug: "afrobeat",      from: "#facc15", to: "#a16207" },
  { label: "Dancehall",     slug: "dancehall",     from: "#4ade80", to: "#166534" },
  { label: "J-Pop",         slug: "j-pop",         from: "#fda4af", to: "#be123c" },
  // Other
  // Experimental: replaces forbidden Tailwind violet (#a78bfa). Uses
  // GOLD from theme.js against the existing deep-violet `to` — gold→
  // purple, distinct from all neighboring tiles (J-Pop pink, Soundtrack
  // slate).
  { label: "Experimental",  slug: "experimental",  from: GOLD,      to: "#5b21b6" },
  { label: "Soundtrack",    slug: "soundtrack",    from: "#94a3b8", to: "#1e293b" },
  { label: "World",         slug: "world",         from: "#fb923c", to: "#15803d" },
];

export const GENRE_OPTIONS = [...GENRE_OPTIONS_BASE, ...GENRE_OPTIONS_EXTENDED];

// Tri-state chip: neutral / liked / excluded.
//   - `selected` array drives the "liked" state (legacy two-state usage).
//   - `excluded` array (optional) drives the "excluded" state — a red ring
//     and strikethrough label. Click cycles neutral → liked → excluded →
//     neutral when both onToggle and onExclude are provided. Callers that
//     pass only onToggle keep the legacy two-state behavior (liked/neutral).
export function GenreChip({ genre, selected, onToggle, excluded, onExclude }) {
  const isLiked = selected.includes(genre.slug);
  const isExcluded = (excluded ?? []).includes(genre.slug);
  const supportsExclude = typeof onExclude === "function";

  function handleClick() {
    if (!supportsExclude) {
      onToggle(genre.slug);
      return;
    }
    // Three-state cycle: neutral → liked → excluded → neutral.
    if (!isLiked && !isExcluded) onToggle(genre.slug);          // → liked
    else if (isLiked) { onToggle(genre.slug); onExclude(genre.slug); }  // → excluded
    else onExclude(genre.slug);                                 // → neutral
  }

  const borderColor = isExcluded
    ? "var(--danger)"
    : isLiked
    ? genre.from
    : "var(--border)";
  const bg = isExcluded
    ? "transparent"
    : isLiked
    ? `linear-gradient(135deg, ${genre.from}30, ${genre.to}30)`
    : "transparent";
  const fg = isExcluded
    ? "var(--danger)"
    : isLiked
    ? genre.from
    : "var(--text-muted)";

  return (
    <button
      onClick={handleClick}
      title={
        !supportsExclude ? undefined
        : isExcluded ? "Excluded. Click to reset"
        : isLiked ? "Liked. Click to exclude"
        : "Click to like"
      }
      style={{
        padding: "8px 16px",
        borderRadius: "var(--radius-xl)",
        fontSize: 13,
        fontWeight: 700,
        border: `2px solid ${borderColor}`,
        background: bg,
        color: fg,
        cursor: "pointer",
        transition: "all 0.15s",
        transform: isLiked ? "scale(1.04)" : "scale(1)",
        textDecoration: isExcluded ? "line-through" : "none",
        textDecorationThickness: isExcluded ? 2 : undefined,
      }}
    >
      {genre.label}
    </button>
  );
}

// ── Artist seed chip ──────────────────────────────────────────────────────────
// Multi-select pill for the onboarding artist picker. `name` is the artist
// name (the value we seed the feed with); `artist.image` is a Spotify CDN
// photo baked into data/seedArtists.js, rendered as a circular avatar. If an
// entry has no image, or its CDN URL 404s at load time (onError), the avatar
// falls back to a brand monogram of the artist's initials — so a name added
// without a URL, or a rotated CDN path, degrades gracefully instead of
// showing a broken-image icon.
function artistInitials(name) {
  const parts = String(name)
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ArtistChip({ artist, selected, onToggle }) {
  const isSel = selected.includes(artist.name);
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = artist.image && !imgFailed;
  return (
    <button
      onClick={() => onToggle(artist.name)}
      aria-pressed={isSel}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "4px 14px 4px 4px",
        borderRadius: "var(--radius-xl)",
        fontSize: 13, fontWeight: 700,
        border: `2px solid ${isSel ? ACCENT_A : "var(--border)"}`,
        background: isSel ? `${ACCENT_A}22` : "transparent",
        color: isSel ? ACCENT_A : "var(--text)",
        cursor: "pointer", transition: "all 0.15s",
        transform: isSel ? "scale(1.03)" : "scale(1)",
      }}
    >
      <span style={{
        width: 28, height: 28, flexShrink: 0, borderRadius: "50%",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 800, letterSpacing: "0.02em",
        background: isSel ? ACCENT_A : "var(--surface3)",
        color: isSel ? "#fff" : "var(--text-muted)",
        overflow: "hidden",
      }}>
        {showImg
          ? <img
              src={artist.image}
              alt=""
              loading="lazy"
              onError={() => setImgFailed(true)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          : artistInitials(artist.name)}
      </span>
      {artist.name}
    </button>
  );
}

// Bookmark icon — used in the backlog explainer (signed-in users only).
function BookmarkIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ── Dot indicator ─────────────────────────────────────────────────────────────
function Dots({ total, active }) {
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: i === active ? 18 : 6,
          height: 6,
          borderRadius: "var(--radius-sm)",
          background: i === active ? ACCENT_A : "var(--border)",
          transition: "all 0.25s",
        }} />
      ))}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
// Onboarding reworked 2026-05-30 around ARTIST-SEEDING (replay-session
// finding: strangers who land anonymously bounce because day-one content
// has no connection to them — unknown people rating unknown music). The
// fix anchors the first feed on artists the user actually loves, via the
// Last.fm similarity graph (NOT genre collapse).
//
// Steps (string-keyed for the branch):
//   "welcome"  → payoff-first value prop ("music for your taste")
//   "artists"  → FIRST content step. Multi-select artists you love →
//                seeds the feed via similarity. "None of these — pick by
//                genre" falls back to the genre picker. Guests can do this
//                and immediately see a seeded PREVIEW feed (no account).
//   "genres"   → the EXISTING genre picker, now the fallback path.
//   "backlog"  → save-to-listen explainer. SIGNED-IN ONLY (a guest has no
//                profile to save to); guests dismiss straight to the feed
//                after seeding, where the signup ask appears at the natural
//                moment (when they try to rate).
//
// The friends/social explainer step was CUT: strangers have no social
// connection on day one, so explaining the social layer wastes first-run
// attention. It's discoverable in-app later.
//
// Artist picks are stored in localStorage (SEED_ARTISTS_KEY), NOT the
// server profile — a decaying cold-start prior, not a permanent input.
// Genre picks (the fallback) ARE persisted via saveTasteProfile because
// declared genres are a durable preference, not a seed.
export function OnboardingModal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState("welcome");
  const [exiting, setExiting] = useState(false);

  // A "guest" (browsing without signing in) has no account, so no profile
  // to save to and no backlog. They seed → preview → get the signup ask
  // when they try to act. Detected as "no signed-in user."
  const isGuest = !user;

  // Artist picker state (step "artists"). Holds the picked NAMES.
  const [selectedArtists, setSelectedArtists] = useState([]);
  function toggleArtist(name) {
    setSelectedArtists((prev) =>
      prev.includes(name)
        ? prev.filter((n) => n !== name)
        : [...prev, name].slice(0, 12),  // soft cap
    );
  }

  // Genre picker state (step "genres" — the fallback). selectedGenres holds
  // the in-progress picks; saving is async to avoid blocking on slow
  // networks. The save fires contour:taste-updated so the feed re-fetches.
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [showExtendedGenres, setShowExtendedGenres] = useState(false);
  const [savingGenres, setSavingGenres] = useState(false);
  function toggleOnboardingGenre(slug) {
    setSelectedGenres((prev) =>
      prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug].slice(0, 10),  // soft cap
    );
  }

  const seedSections = groupedSeedArtists();

  // Defer showing until the user has passed the SigninGate — either by
  // signing in (user becomes non-null) or by opting into guest browse mode.
  // Otherwise the picker stacks behind / fights with the gate on first launch.
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    function maybeShow() {
      const inGuestMode = (() => {
        try { return localStorage.getItem("contour_guest_mode") === "1"; }
        catch { return false; }
      })();
      if (user || inGuestMode) setVisible(true);
    }
    // Initial probe (covers the case where the user was already signed in
    // when this effect first ran).
    const t = setTimeout(maybeShow, 400);
    // Watch for guest-mode flips so we react when SigninGate dismisses.
    window.addEventListener("contour:guest-mode-changed", maybeShow);
    return () => {
      clearTimeout(t);
      window.removeEventListener("contour:guest-mode-changed", maybeShow);
    };
  }, [user]);

  // Replay-tutorial hook: any caller (e.g. /settings) can fire this
  // CustomEvent to re-open the onboarding from the start without a reload.
  useEffect(() => {
    function handler() {
      localStorage.removeItem(STORAGE_KEY);
      setStep("welcome");
      setExiting(false);
      setVisible(true);
    }
    window.addEventListener("contour:replay-onboarding", handler);
    return () => window.removeEventListener("contour:replay-onboarding", handler);
  }, []);

  function dismiss() {
    setExiting(true);
    setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, "1");
      setVisible(false);
      setExiting(false);
    }, 220);
  }

  // Commit the artist seed. Persists to localStorage (NOT the server),
  // fires the analytics seed event + taste-updated so the feed underneath
  // re-fetches with the seed. Guests dismiss straight to their preview
  // feed; signed-in users continue to the backlog explainer.
  function finishArtistStep() {
    const picks = selectedArtists;
    analytics.onboardingStepCompleted("artist_picker", picks.length === 0);
    analytics.onboardingSeeded("artist", picks.length);
    try {
      localStorage.setItem(SEED_ARTISTS_KEY, JSON.stringify(picks));
      // Stamp the decay baseline = current rating count (0 for guests). This is
      // what lets a returning user who replays onboarding re-seed at full
      // strength: the seed tapers over their NEXT RAMP ratings, not from zero.
      localStorage.setItem(SEED_BASELINE_KEY, String(user?.rating_count ?? 0));
    } catch {}
    window.dispatchEvent(new CustomEvent("contour:taste-updated"));
    if (isGuest) dismiss();
    else setStep("backlog");
  }

  // "None of these" → fall back to the genre picker. Not a seeding event
  // (they haven't seeded yet), just a navigation; the seed event fires
  // from whichever step actually completes the seeding.
  function goToGenrePicker() {
    setStep("genres");
  }

  // Complete the genre-picker fallback. Genres ARE persisted (durable
  // preference). skip → no save, but still counts as a genre-method
  // completion with 0 picks for the funnel.
  function finishGenrePickerStep(skip = false) {
    const picks = skip ? [] : selectedGenres;
    analytics.onboardingStepCompleted("genre_picker", skip);
    analytics.onboardingSeeded("genre", picks.length);
    if (picks.length > 0) {
      setSavingGenres(true);
      // Mirror to localStorage so a logged-out user's cold-start feed picks
      // up the genres immediately (feedPrefetch reads contour_genres_v1
      // before React mounts on next launch).
      try {
        localStorage.setItem("contour_genres_v1", JSON.stringify(picks));
      } catch {}
      // Fire-and-forget — don't block the user on the round-trip.
      api.saveTasteProfile(picks, [], false)
        .catch(() => {})
        .finally(() => setSavingGenres(false));
    }
    window.dispatchEvent(new CustomEvent("contour:taste-updated"));
    if (isGuest) dismiss();
    else setStep("backlog");
  }

  function finishBacklogStep(deepLink) {
    analytics.onboardingStepCompleted("backlog_explainer", !deepLink);
    if (deepLink) {
      localStorage.setItem(STORAGE_KEY, "1");
      setVisible(false);
      navigate(profileTabPath("backlog"));
    } else {
      dismiss();
    }
  }

  if (!visible) return null;

  // Progress dots. Guests have 2 steps (welcome → seed); signed-in have 3
  // (welcome → seed → backlog). The artist + genre steps share the "seed"
  // slot (index 1) since they're the same point in the flow.
  const stepTotal = isGuest ? 2 : 3;
  const activeDot = step === "welcome" ? 0 : step === "backlog" ? 2 : 1;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={dismiss}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.7)",
          zIndex: 200,
          opacity: exiting ? 0 : 1,
          transition: "opacity 0.22s",
        }}
      />

      {/* Sheet */}
      <div style={{
        position: "fixed",
        bottom: 0, left: 0, right: 0,
        zIndex: 201,
        padding: "0 16px calc(env(safe-area-inset-bottom, 16px) + 16px)",
        transform: exiting ? "translateY(100%)" : "translateY(0)",
        transition: "transform 0.22s cubic-bezier(0.32,0.72,0,1)",
      }}>
        <div style={{
          background: "var(--surface)",
          borderRadius: "var(--radius-xl) var(--radius-xl) var(--radius-lg) var(--radius-lg)",
          padding: "24px 24px 20px",
          maxWidth: 480,
          margin: "0 auto",
          boxShadow: "var(--shadow-3)",
        }}>
          {/* Drag handle */}
          <div style={{ width: 36, height: 4, borderRadius: "var(--radius-sm)", background: "var(--surface3)", margin: "0 auto 22px" }} />

          {/* ── Step: Welcome ──
              Payoff-first. The old copy led with the work ("rate tracks to
              calibrate"); this leads with the result (music for your taste)
              and makes clear the very next step shows them something —
              no rating, no account required. */}
          {step === "welcome" && (
            <>
              <div style={{ textAlign: "center", marginBottom: 28, padding: "12px 4px 0" }}>
                <h2 style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 34, fontWeight: 400, margin: "0 0 12px",
                  color: "var(--text)", lineHeight: 1.08, letterSpacing: "-0.01em",
                }}>
                  Music that sounds like you.
                </h2>
                <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0, lineHeight: 1.55, maxWidth: 330, marginInline: "auto" }}>
                  Tell us a few artists you love and your feed fills up with
                  songs for your taste — right now, nothing to rate first.
                </p>
              </div>

              <div style={{ marginBottom: 18 }}>
                <Dots total={stepTotal} active={0} />
              </div>

              <button onClick={() => { analytics.onboardingStepCompleted("value_prop", false); setStep("artists"); }} style={{
                width: "100%", padding: "14px 0", borderRadius: "var(--radius-lg)",
                background: ACCENT_A, border: "none",
                color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer",
                letterSpacing: "0.01em",
              }}>
                Get started
              </button>
            </>
          )}

          {/* ── Step: Artist picker (first content step, new 2026-05-30) ──
              Multi-select — several picks triangulate real taste where one
              pick is just recognition. Seeds the feed via the Last.fm
              similarity graph (the picked artists + their neighbors).
              "None of these" escapes to the genre picker so nobody whose
              taste isn't in the list gets stranded. */}
          {step === "artists" && (
            <>
              <div style={{ textAlign: "center", marginBottom: 14 }}>
                <h2 style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 28, fontWeight: 400, margin: "0 0 8px",
                  color: "var(--text)", lineHeight: 1.1,
                }}>
                  Pick a few artists you love
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  We'll build your feed around them and artists like them.
                  The more you pick, the better it gets.
                </p>
              </div>

              <div style={{
                maxHeight: "42vh", overflowY: "auto",
                marginBottom: 14, padding: "4px 2px",
                WebkitOverflowScrolling: "touch",
              }}>
                {seedSections.map(({ scene, artists }) => (
                  <div key={scene} style={{ marginBottom: 14 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                      margin: "0 0 8px 2px",
                    }}>
                      {scene}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {artists.map((a) => (
                        <ArtistChip
                          key={a.name}
                          artist={a}
                          selected={selectedArtists}
                          onToggle={toggleArtist}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 18 }}>
                <Dots total={stepTotal} active={1} />
              </div>

              <button
                onClick={finishArtistStep}
                disabled={selectedArtists.length === 0}
                style={{
                  width: "100%", padding: "14px 0", borderRadius: "var(--radius-lg)",
                  background: selectedArtists.length > 0 ? ACCENT_A : "var(--surface2)",
                  border: "none",
                  color: selectedArtists.length > 0 ? "#fff" : "var(--text-muted)",
                  fontSize: 14, fontWeight: 600,
                  cursor: selectedArtists.length > 0 ? "pointer" : "default",
                  marginBottom: 8,
                }}
              >
                {selectedArtists.length > 0
                  ? `See my feed (${selectedArtists.length})`
                  : "Pick a few to start"}
              </button>

              <button
                onClick={goToGenrePicker}
                style={{
                  width: "100%", padding: "8px 0",
                  background: "none", border: "none",
                  color: "var(--text-muted)", fontSize: 12,
                  cursor: "pointer",
                }}
              >
                None of these: pick a genre
              </button>
            </>
          )}

          {/* ── Step: Genre picker (the fallback) ──
              Reachable from the artist step's "None of these". Genres are a
              durable declared preference, so these ARE persisted. */}
          {step === "genres" && (
            <>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <h2 style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 28, fontWeight: 400, margin: "0 0 8px",
                  color: "var(--text)", lineHeight: 1.1,
                }}>
                  What do you usually listen to?
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  Pick any that sound right. We use these to seed your first
                  feed. You can change them anytime in Settings.
                </p>
              </div>

              <div style={{
                maxHeight: "40vh", overflowY: "auto",
                marginBottom: 16, padding: "4px 2px",
                WebkitOverflowScrolling: "touch",
              }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {GENRE_OPTIONS_BASE.map((g) => (
                    <GenreChip
                      key={g.slug}
                      genre={g}
                      selected={selectedGenres}
                      onToggle={toggleOnboardingGenre}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setShowExtendedGenres((s) => !s)}
                  style={{
                    marginTop: 10,
                    padding: "6px 12px", fontSize: 11, fontWeight: 600,
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  {showExtendedGenres ? "Show fewer genres" : "More genres"}
                </button>

                {showExtendedGenres && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {GENRE_OPTIONS_EXTENDED.map((g) => (
                      <GenreChip
                        key={g.slug}
                        genre={g}
                        selected={selectedGenres}
                        onToggle={toggleOnboardingGenre}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <Dots total={stepTotal} active={1} />
              </div>

              <button
                onClick={() => finishGenrePickerStep(false)}
                disabled={savingGenres}
                style={{
                  width: "100%", padding: "14px 0", borderRadius: "var(--radius-lg)",
                  background: selectedGenres.length > 0 ? ACCENT_A : "var(--surface2)",
                  border: "none",
                  color: selectedGenres.length > 0 ? "#fff" : "var(--text-muted)",
                  fontSize: 14, fontWeight: 600,
                  cursor: savingGenres ? "default" : "pointer",
                  marginBottom: 8,
                }}
              >
                {selectedGenres.length > 0
                  ? `Continue with ${selectedGenres.length} selected`
                  : "Pick at least one to continue"}
              </button>

              <button
                onClick={() => finishGenrePickerStep(true)}
                style={{
                  width: "100%", padding: "8px 0",
                  background: "none", border: "none",
                  color: "var(--text-muted)", fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Skip for now
              </button>
            </>
          )}

          {/* ── Step: Backlog explainer (signed-in only) ── */}
          {step === "backlog" && (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h2 style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 30, fontWeight: 400, margin: "0 0 8px",
                  color: "var(--text)", lineHeight: 1.1,
                }}>
                  Save what you want to hear
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}>
                  Bookmark albums as you find them. Your backlog is public on
                  your profile so friends can see what's queued up.
                </p>
              </div>

              <div style={{
                background: "var(--surface2)",
                borderRadius: "var(--radius-lg)",
                padding: "16px 16px", marginBottom: 16,
                display: "flex", alignItems: "center", gap: 14,
              }}>
                <span style={{
                  width: 48, height: 48, flexShrink: 0,
                  borderRadius: "50%",
                  background: `${ACCENT_B}1f`,
                  color: ACCENT_B,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <BookmarkIcon />
                </span>
                <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Tap <strong style={{ color: "var(--text)" }}>+ Want to listen</strong> on
                  any album or track. Your backlog lives as a tab on your profile.
                </div>
              </div>

              <button
                onClick={() => finishBacklogStep(true)}
                style={{
                  background: "none", border: "none", color: ACCENT_A,
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  padding: "0 0 16px", display: "block", marginInline: "auto",
                }}
              >
                See how it works
              </button>

              <div style={{ marginBottom: 18 }}>
                <Dots total={stepTotal} active={2} />
              </div>

              <button onClick={() => finishBacklogStep(false)} style={{
                width: "100%", padding: "14px 0", borderRadius: "var(--radius-lg)",
                background: ACCENT_A, border: "none",
                color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>
                Got it
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
