import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { api } from "../services/api.js";

const STORAGE_KEY = "contour_onboarded_v1";
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

// ── Quick tips for the second screen ─────────────────────────────────────────
const TIPS = [
  {
    icon: "★",
    color: ACCENT_B,
    title: "Rate tracks on your feed",
    body: "Stars on the For You cards tune your feed. 5 ratings is all it takes to personalize it.",
  },
  {
    icon: "↗",
    color: ACCENT_A,
    title: "Search any album or artist",
    body: "Look up anything to see its streaming history, community ratings, and compare it to something else.",
  },
  {
    icon: "⟺",
    color: ACCENT_C,
    title: "Compare releases head-to-head",
    body: "Head to Compare to put any two albums or tracks side-by-side — across any era.",
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
export function OnboardingModal() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0); // 0 = genres, 1 = tips
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

  async function saveGenresAndNext() {
    if (selectedGenres.length > 0) {
      localStorage.setItem(GENRES_KEY, JSON.stringify(selectedGenres));
      if (user) {
        api.saveTasteProfile(selectedGenres, [], true).catch(() => {});
      }
    }
    setStep(1);
  }

  function toggleGenre(slug) {
    setSelectedGenres((prev) =>
      prev.includes(slug) ? prev.filter((g) => g !== slug) : [...prev, slug]
    );
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

          {/* ── Step 0: Genre picker ── */}
          {step === 0 && (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h2 style={{
                  fontSize: 22, fontWeight: 800, margin: "0 0 8px",
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                }}>
                  What do you love listening to?
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                  Pick your genres to get a personalized feed from day one.
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
                <Dots total={2} active={0} />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={dismiss} style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  background: "none", border: "1px solid var(--border)",
                  color: "var(--text-muted)", fontSize: 14, cursor: "pointer",
                }}>
                  Skip
                </button>
                <button onClick={saveGenresAndNext} style={{
                  flex: 2, padding: "12px 0", borderRadius: 12,
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  border: "none", color: "#000", fontSize: 14, fontWeight: 800, cursor: "pointer",
                }}>
                  {selectedGenres.length > 0 ? "Continue →" : "Skip for now →"}
                </button>
              </div>
            </>
          )}

          {/* ── Step 1: Quick tips ── */}
          {step === 1 && (
            <>
              <div style={{ textAlign: "center", marginBottom: 22 }}>
                <h2 style={{
                  fontSize: 22, fontWeight: 800, margin: "0 0 6px",
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                }}>
                  You're in. Here's what to try:
                </h2>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 22 }}>
                {TIPS.map((tip) => (
                  <div key={tip.title} style={{
                    display: "flex", alignItems: "flex-start", gap: 14,
                    background: "var(--surface2)", borderRadius: 12, padding: "13px 15px",
                    border: "1px solid var(--border)",
                  }}>
                    <span style={{
                      fontSize: 18, width: 32, height: 32, flexShrink: 0,
                      borderRadius: 8, background: `${tip.color}18`,
                      border: `1px solid ${tip.color}35`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: tip.color, fontWeight: 800,
                    }}>
                      {tip.icon}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{tip.title}</span>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>{tip.body}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 18 }}>
                <Dots total={2} active={1} />
              </div>

              <button onClick={dismiss} style={{
                width: "100%", padding: "13px 0", borderRadius: 12,
                background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                border: "none", color: "#000", fontSize: 14, fontWeight: 800, cursor: "pointer",
              }}>
                Start exploring →
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
