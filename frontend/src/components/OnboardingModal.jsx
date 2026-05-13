import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";

const STORAGE_KEY = "contour_onboarded_v2";
const GENRES_KEY = "contour_genres_v1";
const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";
const ACCENT_C = "#fb923c";

// ── Genre picker data (also exported for reuse in TasteSection) ───────────────
export const GENRE_OPTIONS = [
  { label: "Hip-Hop",     slug: "hip-hop",     from: "#fb923c", to: "#f97316" },
  { label: "R&B",         slug: "r-n-b",       from: "#c084fc", to: "#a855f7" },
  { label: "Pop",         slug: "pop",          from: "#f472b6", to: "#ec4899" },
  { label: "Indie",       slug: "indie",        from: ACCENT_A,  to: "#7c3aed" },
  { label: "Alternative", slug: "alternative",  from: "#a78bfa", to: "#6d28d9" },
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

export function GenreChip({ genre, selected, onToggle }) {
  const active = selected.includes(genre.slug);
  return (
    <button
      onClick={() => onToggle(genre.slug)}
      style={{
        padding: "8px 16px",
        borderRadius: 20,
        fontSize: 13,
        fontWeight: 700,
        border: `2px solid ${active ? genre.from : "var(--border)"}`,
        background: active
          ? `linear-gradient(135deg, ${genre.from}30, ${genre.to}30)`
          : "transparent",
        color: active ? genre.from : "var(--text-muted)",
        cursor: "pointer",
        transition: "all 0.15s",
        transform: active ? "scale(1.04)" : "scale(1)",
      }}
    >
      {genre.label}
    </button>
  );
}

// ── Value prop icons (SVG, stroke-based — matches the rest of the app) ───────
function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  );
}
function HeadphonesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}
function BookmarkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ── Value prop cards ──────────────────────────────────────────────────────────
const VALUE_PROPS = [
  {
    Icon: StarIcon,
    color: ACCENT_A,
    title: "Rate & review anything",
    body: "Half-star ratings and reviews for albums, tracks, and artists. Think Letterboxd, but for music.",
  },
  {
    Icon: ChartIcon,
    color: ACCENT_B,
    title: "See what actually streamed",
    body: "Era-adjusted scores level the playing field. A 2012 album that was massive gets the credit it deserves, even next to a 2024 release.",
  },
  {
    Icon: HeadphonesIcon,
    color: ACCENT_C,
    title: "Find music made for you",
    body: "Rate a few tracks in the feed and Contour learns your taste: genre, era, vibe. Every rating sharpens what comes next.",
  },
];

// ── Dot indicator ─────────────────────────────────────────────────────────────
function Dots({ total, active }) {
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: i === active ? 18 : 6,
          height: 6,
          borderRadius: 3,
          background: i === active ? ACCENT_A : "var(--border)",
          transition: "all 0.25s",
        }} />
      ))}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
// Steps:
//   0 — value prop
//   1 — genre picker
//   2 — Backlog explainer (informational, skippable)
//
// The RYM import upsell that used to sit at step 2 was cut — putting a
// CSV-import workflow 30 seconds into a casual user's first run contradicted
// the low-friction positioning. The /import route is still reachable from
// the profile settings menu for the rare power user migrating from RYM.
export function OnboardingModal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState([]);

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

  // Replay-tutorial hook: any caller (e.g. profile settings menu) can fire
  // this CustomEvent to re-open the onboarding from step 0 without a reload.
  useEffect(() => {
    function handler() {
      localStorage.removeItem(STORAGE_KEY);
      setStep(0);
      setSelectedGenres([]);
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

  // Save genres ASAP (after step 1) so that progress isn't lost if the user
  // bails on the backlog explainer step.
  async function saveGenresAndAdvance() {
    if (selectedGenres.length > 0) {
      localStorage.setItem(GENRES_KEY, JSON.stringify(selectedGenres));
      if (user) {
        api.saveTasteProfile(selectedGenres, [], true).catch(() => {});
      }
    }
    analytics.onboardingStepCompleted("genres", selectedGenres.length === 0);
    setStep(2);
  }

  function toggleGenre(slug) {
    setSelectedGenres((prev) =>
      prev.includes(slug) ? prev.filter((g) => g !== slug) : [...prev, slug]
    );
  }

  function finishBacklogStep(deepLink) {
    analytics.onboardingStepCompleted("backlog_explainer", !deepLink);
    if (deepLink) {
      localStorage.setItem(STORAGE_KEY, "1");
      setVisible(false);
      navigate("/profile?tab=backlog");
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
          border: "1px solid var(--border)",
          borderRadius: "20px 20px 16px 16px",
          padding: "24px 24px 20px",
          maxWidth: 480,
          margin: "0 auto",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
        }}>
          {/* Drag handle */}
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border)", margin: "0 auto 22px" }} />

          {/* ── Step 0: Value prop ── */}
          {step === 0 && (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
                  Welcome to Contour
                </div>
                <h2 style={{
                  fontSize: 24, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.2,
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                }}>
                  Rate. Review.<br />Discover.
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  The only music app that combines ratings and reviews with real streaming analytics, so you can finally settle the debate.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
                {VALUE_PROPS.map((vp) => (
                  <div key={vp.title} style={{
                    display: "flex", alignItems: "flex-start", gap: 13,
                    background: "var(--surface2)", borderRadius: 12, padding: "13px 15px",
                    border: "1px solid var(--border)",
                  }}>
                    <span style={{
                      width: 32, height: 32, flexShrink: 0,
                      borderRadius: 8, background: `${vp.color}18`,
                      border: `1px solid ${vp.color}35`,
                      color: vp.color,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <vp.Icon />
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{vp.title}</span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>{vp.body}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 18 }}>
                <Dots total={3} active={0} />
              </div>

              <button onClick={() => { analytics.onboardingStepCompleted("value_prop", false); setStep(1); }} style={{
                width: "100%", padding: "13px 0", borderRadius: 12,
                background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                border: "none", color: "#000", fontSize: 14, fontWeight: 800, cursor: "pointer",
              }}>
                Get started →
              </button>
            </>
          )}

          {/* ── Step 1: Genre picker ── */}
          {step === 1 && (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h2 style={{
                  fontSize: 22, fontWeight: 800, margin: "0 0 8px",
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                }}>
                  What do you listen to?
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                  Pick your genres to personalize your For You feed from day one.
                  {selectedGenres.length > 0 && (
                    <span style={{ color: ACCENT_A, fontWeight: 700 }}> {selectedGenres.length} selected</span>
                  )}
                </p>
              </div>

              <div style={{
                display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center",
                marginBottom: 20,
                maxHeight: 220, overflowY: "auto",
              }}>
                {GENRE_OPTIONS.map((g) => (
                  <GenreChip key={g.slug} genre={g} selected={selectedGenres} onToggle={toggleGenre} />
                ))}
              </div>

              <div style={{ marginBottom: 18 }}>
                <Dots total={3} active={1} />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => { analytics.onboardingStepCompleted("genres", true); setStep(2); }} style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  background: "none", border: "1px solid var(--border)",
                  color: "var(--text-muted)", fontSize: 14, cursor: "pointer",
                }}>
                  Skip
                </button>
                <button onClick={saveGenresAndAdvance} style={{
                  flex: 2, padding: "12px 0", borderRadius: 12,
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  border: "none", color: "#000", fontSize: 14, fontWeight: 800, cursor: "pointer",
                }}>
                  {selectedGenres.length > 0 ? "Next →" : "Skip for now →"}
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Backlog explainer ── */}
          {step === 2 && (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h2 style={{
                  fontSize: 22, fontWeight: 800, margin: "0 0 8px",
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                }}>
                  Track what you want to listen to
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}>
                  Save albums to your backlog as you find them. It's public on
                  your profile so friends can see what you're excited about.
                </p>
              </div>

              <div style={{
                background: "var(--surface2)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "14px 16px", marginBottom: 16,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{
                  width: 36, height: 36, flexShrink: 0,
                  borderRadius: 8, background: `${ACCENT_B}18`,
                  border: `1px solid ${ACCENT_B}35`,
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
                See how it works →
              </button>

              <div style={{ marginBottom: 18 }}>
                <Dots total={3} active={2} />
              </div>

              <button onClick={() => finishBacklogStep(false)} style={{
                width: "100%", padding: "13px 0", borderRadius: 12,
                background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                border: "none", color: "#000", fontSize: 14, fontWeight: 800, cursor: "pointer",
              }}>
                Got it →
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
