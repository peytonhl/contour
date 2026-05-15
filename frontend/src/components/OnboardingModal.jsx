import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";

const STORAGE_KEY = "contour_onboarded_v2";
const GENRES_KEY = "contour_genres_v1";
const ACCENT_A = "#d97a3b";
const ACCENT_B = "#6a90b5";

// ── Genre picker data (also exported for reuse in TasteSection) ───────────────
export const GENRE_OPTIONS = [
  { label: "Hip-Hop",     slug: "hip-hop",     from: "#fb923c", to: "#f97316" },
  { label: "R&B",         slug: "r-n-b",       from: "#c084fc", to: "#a855f7" },
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

export function GenreChip({ genre, selected, onToggle }) {
  const active = selected.includes(genre.slug);
  return (
    <button
      onClick={() => onToggle(genre.slug)}
      style={{
        padding: "8px 16px",
        borderRadius: "var(--radius-xl)",
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
//   0 — value prop
//   1 — genre picker
//   2 — Backlog explainer (informational, skippable)
//
// The RYM import upsell that used to sit at step 2 was cut — putting a
// CSV-import workflow 30 seconds into a casual user's first run contradicted
// the low-friction positioning. The /import route is still reachable from
// the /settings page for the rare power user migrating from RYM.
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
  //
  // Note on the dispatched event: ForYouPage fetches its first batch on mount,
  // which happens before this modal opens for a new user. Without the event,
  // the user picks genres and then keeps scrolling the cold-start batch until
  // they reach the prefetch boundary ~10 tracks later — the personalization
  // signal is saved server-side but invisible to them. Firing
  // contour:taste-updated tells the For You feed to drop its current batch
  // and refetch with the new genres applied.
  async function saveGenresAndAdvance() {
    if (selectedGenres.length > 0) {
      localStorage.setItem(GENRES_KEY, JSON.stringify(selectedGenres));
      if (user) {
        try { await api.saveTasteProfile(selectedGenres, [], true); }
        catch { /* non-fatal; localStorage copy still drives logged-out path */ }
      }
      window.dispatchEvent(new CustomEvent("contour:taste-updated", {
        detail: { source: "onboarding", genres: selectedGenres },
      }));
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
          borderRadius: "var(--radius-xl) var(--radius-xl) var(--radius-lg) var(--radius-lg)",
          padding: "24px 24px 20px",
          maxWidth: 480,
          margin: "0 auto",
          boxShadow: "var(--shadow-3)",
        }}>
          {/* Drag handle */}
          <div style={{ width: 36, height: 4, borderRadius: "var(--radius-sm)", background: "var(--surface3)", margin: "0 auto 22px" }} />

          {/* ── Step 0: Welcome ──
              Collapsed from the previous 3-card value-prop carousel. The
              pitch lives on the sign-in gate; by this point the user is
              already in, so step 0 is just an orientation beat: a single
              line, no marketing, then straight into genres. */}
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
                  A couple of taste questions so the feed knows where to start.
                  Takes about thirty seconds.
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
                Pick your genres
              </button>
            </>
          )}

          {/* ── Step 1: Genre picker ── */}
          {step === 1 && (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h2 style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 30, fontWeight: 400, margin: "0 0 8px",
                  color: "var(--text)", lineHeight: 1.1,
                }}>
                  What do you listen to?
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                  Pick the genres you reach for most.
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
                  flex: 1, padding: "12px 0", borderRadius: "var(--radius-lg)",
                  background: "none", border: "1px solid var(--border)",
                  color: "var(--text-muted)", fontSize: 14, cursor: "pointer",
                }}>
                  Skip
                </button>
                <button onClick={saveGenresAndAdvance} style={{
                  flex: 2, padding: "12px 0", borderRadius: "var(--radius-lg)",
                  background: ACCENT_A, border: "none",
                  color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}>
                  {selectedGenres.length > 0 ? "Continue" : "Skip for now"}
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Backlog explainer ── */}
          {step === 2 && (
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
                <Dots total={3} active={2} />
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
