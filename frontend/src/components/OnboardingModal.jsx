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

// ── Value prop cards ──────────────────────────────────────────────────────────
const VALUE_PROPS = [
  {
    icon: "★",
    color: ACCENT_A,
    title: "Rate & review anything",
    body: "Half-star ratings and reviews for albums, tracks, and artists — like Letterboxd, but for music.",
  },
  {
    icon: "📊",
    color: ACCENT_B,
    title: "See what actually streamed",
    body: "Era-adjusted scores level the playing field. A 2012 album that was massive gets the credit it deserves, even next to a 2024 release.",
  },
  {
    icon: "🎵",
    color: ACCENT_C,
    title: "Find music made for you",
    body: "Rate 10 tracks in the feed and Contour learns your taste — genre, era, vibe. Every rating sharpens what comes next.",
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
//   2 — RYM import upsell (optional, skippable)
//   3 — Backlog explainer (informational, skippable)
export function OnboardingModal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState([]);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      const t = setTimeout(() => setVisible(true), 400);
      return () => clearTimeout(t);
    }
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
  // bails on the import/backlog explainer steps.
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

  function goToImport() {
    analytics.onboardingStepCompleted("import", false);
    // Mark onboarding done BEFORE navigating — the next visit shouldn't replay it.
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
    navigate("/import");
  }

  function skipImport() {
    analytics.onboardingStepCompleted("import", true);
    setStep(3);
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
                  The only music app that combines ratings and reviews with real streaming analytics — so you can finally settle the debate.
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
                      fontSize: 16, width: 32, height: 32, flexShrink: 0,
                      borderRadius: 8, background: `${vp.color}18`,
                      border: `1px solid ${vp.color}35`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {vp.icon}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{vp.title}</span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>{vp.body}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 18 }}>
                <Dots total={4} active={0} />
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
                <Dots total={4} active={1} />
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

          {/* ── Step 2: RYM import upsell ── */}
          {step === 2 && (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h2 style={{
                  fontSize: 22, fontWeight: 800, margin: "0 0 8px",
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                }}>
                  Already rate music elsewhere?
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}>
                  Bring your ratings from Rate Your Music — we'll match them to
                  albums on Contour so you don't start from scratch.
                </p>
              </div>

              <div style={{
                background: "var(--surface2)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "14px 16px", marginBottom: 20,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{
                  fontSize: 18, width: 36, height: 36, flexShrink: 0,
                  borderRadius: 8, background: `${ACCENT_A}18`,
                  border: `1px solid ${ACCENT_A}35`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  📥
                </span>
                <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Export your data from RYM, upload the CSV — every rated album
                  is matched on Spotify and saved to your Contour profile.
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <Dots total={4} active={2} />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={skipImport} style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  background: "none", border: "1px solid var(--border)",
                  color: "var(--text-muted)", fontSize: 14, cursor: "pointer",
                }}>
                  Skip for now
                </button>
                <button onClick={goToImport} style={{
                  flex: 2, padding: "12px 0", borderRadius: 12,
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  border: "none", color: "#000", fontSize: 14, fontWeight: 800, cursor: "pointer",
                }}>
                  Import from RYM →
                </button>
              </div>
            </>
          )}

          {/* ── Step 3: Backlog explainer ── */}
          {step === 3 && (
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
                  fontSize: 18, width: 36, height: 36, flexShrink: 0,
                  borderRadius: 8, background: `${ACCENT_B}18`,
                  border: `1px solid ${ACCENT_B}35`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  🎯
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
                <Dots total={4} active={3} />
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
