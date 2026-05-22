import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import { analytics } from "../services/analytics.js";
import { ACCENT_A, ACCENT_B } from "../theme.js";

const STORAGE_KEY = "contour_onboarded_v2";

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
  { label: "Drum & Bass",   slug: "drum-and-bass", from: "#34d399", to: "#0d9488" },
  { label: "Dubstep",       slug: "dubstep",       from: "#a78bfa", to: "#6d28d9" },
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
  { label: "Emo",           slug: "emo",           from: "#a78bfa", to: "#3730a3" },
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
  { label: "Experimental",  slug: "experimental",  from: "#a78bfa", to: "#5b21b6" },
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
        : isExcluded ? "Excluded — click to reset"
        : isLiked ? "Liked — click to exclude"
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

// Bookmark icon — used in the step 2 backlog explainer. The previous
// value-prop icons (Star/Chart/Headphones) were deleted when step 0
// collapsed from a 3-card carousel to a single welcome screen.
function BookmarkIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// People icon — used by the step-3 friends explainer. Two-figure
// silhouette so it reads as "social" at a glance, sized to match
// BookmarkIcon's optical weight.
function PeopleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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
// Steps:
//   0 — welcome / value prop
//   1 — Backlog explainer (informational, skippable)
//
// The genre picker that used to sit at step 1 was cut — the For You feed's
// ColdStartBanner asks the user to rate 5 tracks to calibrate, which produces
// a higher-fidelity taste signal than 18 boxy chips. UserTasteProfile.genres
// gets auto-populated from each 4–5★ rating via ratings._update_taste_from_rating,
// so the calibration bar drives the same signal the picker used to seed.
//
// The RYM import upsell that used to sit even earlier was cut for the same
// "don't put a CSV workflow 30 seconds into a casual first run" reason.
// /import is still reachable from /settings.
//
// GENRE_OPTIONS + GenreChip are still exported above because TasteSection
// renders them on the profile page — kept exported, dropped from onboarding.
export function OnboardingModal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);

  // Defer showing until the user has passed the SigninGate — either by
  // signing in (user becomes non-null) or by opting into guest browse mode.
  // Otherwise the genre picker stacks behind / fights with the gate on
  // first launch.
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
  // CustomEvent to re-open the onboarding from step 0 without a reload.
  useEffect(() => {
    function handler() {
      localStorage.removeItem(STORAGE_KEY);
      setStep(0);
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

  function finishBacklogStep(deepLink) {
    analytics.onboardingStepCompleted("backlog_explainer", !deepLink);
    if (deepLink) {
      // Deep-link exits onboarding entirely (user is being navigated
      // away to see the feature) — mark complete so it doesn't
      // re-trigger next launch.
      localStorage.setItem(STORAGE_KEY, "1");
      setVisible(false);
      navigate("/profile?tab=backlog");
    } else {
      // Advance to the friends step instead of dismissing — the
      // third pillar (social / connecting with friends) needs the
      // same explicit explainer the first two got. dismiss() only
      // fires on the final step now.
      setStep(2);
    }
  }

  function finishFriendsStep(deepLink) {
    analytics.onboardingStepCompleted("friends_explainer", !deepLink);
    if (deepLink) {
      localStorage.setItem(STORAGE_KEY, "1");
      setVisible(false);
      navigate("/friends");
    } else {
      dismiss();
    }
  }

  if (!visible) return null;

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

          {/* ── Step 0: Welcome ──
              Anchored on the rate-to-calibrate concept now that the
              genre picker is out. The actual progress bar lives in
              ForYouPage's ColdStartBanner — this is just orientation. */}
          {step === 0 && (
            <>
              <div style={{ textAlign: "center", marginBottom: 28, padding: "12px 4px 0" }}>
                <h2 style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 36, fontWeight: 400, margin: "0 0 12px",
                  color: "var(--text)", lineHeight: 1.05, letterSpacing: "-0.01em",
                }}>
                  Glad you're here.
                </h2>
                <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0, lineHeight: 1.55, maxWidth: 320, marginInline: "auto" }}>
                  Rate a few tracks and your feed sharpens around your taste.
                  Takes about a minute.
                </p>
              </div>

              <div style={{ marginBottom: 18 }}>
                <Dots total={3} active={0} />
              </div>

              <button onClick={() => { analytics.onboardingStepCompleted("value_prop", false); setStep(1); }} style={{
                width: "100%", padding: "14px 0", borderRadius: "var(--radius-lg)",
                background: ACCENT_A, border: "none",
                color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer",
                letterSpacing: "0.01em",
              }}>
                Continue
              </button>
            </>
          )}

          {/* ── Step 1: Backlog explainer ── */}
          {step === 1 && (
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
                <Dots total={3} active={1} />
              </div>

              <button onClick={() => finishBacklogStep(false)} style={{
                width: "100%", padding: "14px 0", borderRadius: "var(--radius-lg)",
                background: ACCENT_A, border: "none",
                color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>
                Continue
              </button>
            </>
          )}

          {/* ── Step 2: Friends / social explainer ──
              The third pillar alongside Discover (step 0) and Backlog
              (step 1). Previously onboarding ended at backlog, leaving
              the social side of the app entirely unmentioned even
              though "connect with friends" is core to the product. */}
          {step === 2 && (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h2 style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 30, fontWeight: 400, margin: "0 0 8px",
                  color: "var(--text)", lineHeight: 1.1,
                }}>
                  Listen with friends
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}>
                  Follow other listeners to see their ratings + reviews in
                  your activity feed. @-mention them in a review to start
                  a conversation.
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
                  background: `${ACCENT_A}1f`,
                  color: ACCENT_A,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <PeopleIcon />
                </span>
                <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Open <strong style={{ color: "var(--text)" }}>Friends</strong> to
                  find people whose taste matches yours. Their reviews show up
                  alongside yours on every album and track page.
                </div>
              </div>

              <button
                onClick={() => finishFriendsStep(true)}
                style={{
                  background: "none", border: "none", color: ACCENT_A,
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  padding: "0 0 16px", display: "block", marginInline: "auto",
                }}
              >
                Find friends
              </button>

              <div style={{ marginBottom: 18 }}>
                <Dots total={3} active={2} />
              </div>

              <button onClick={() => finishFriendsStep(false)} style={{
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
