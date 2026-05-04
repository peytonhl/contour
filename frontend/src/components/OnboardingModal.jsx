import { useState, useEffect } from "react";

const STORAGE_KEY = "contour_onboarded_v1";
const GENRES_KEY = "contour_genres_v1";
const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";

// ── Slide illustrations ───────────────────────────────────────────────────────

function IllustrationTrajectory() {
  return (
    <svg viewBox="0 0 160 90" width="160" height="90" style={{ display: "block", margin: "0 auto" }}>
      <defs>
        <linearGradient id="tg" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={ACCENT_A} />
          <stop offset="100%" stopColor={ACCENT_B} />
        </linearGradient>
      </defs>
      <line x1="16" y1="10" x2="16" y2="74" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="74" x2="148" y2="74" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 20 70 C 40 65 60 55 100 44 C 120 38 135 35 145 33"
        stroke={ACCENT_A} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.35" strokeDasharray="4 3" />
      <path d="M 20 70 C 40 60 60 45 90 30 C 110 20 130 15 145 13"
        stroke="url(#tg)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <text x="52" y="86" fontSize="8" fill="var(--text-muted)" textAnchor="middle">2012 release</text>
      <text x="118" y="86" fontSize="8" fill="var(--text-muted)" textAnchor="middle">today</text>
      <circle cx="145" cy="13" r="3.5" fill={ACCENT_B} />
      <circle cx="145" cy="33" r="3.5" fill={ACCENT_A} opacity="0.4" />
    </svg>
  );
}

function IllustrationCompare() {
  return (
    <svg viewBox="0 0 160 90" width="160" height="90" style={{ display: "block", margin: "0 auto" }}>
      <defs>
        <linearGradient id="cg1" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={ACCENT_A} />
          <stop offset="100%" stopColor={ACCENT_A} stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="cg2" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={ACCENT_B} />
          <stop offset="100%" stopColor={ACCENT_B} stopOpacity="0.6" />
        </linearGradient>
      </defs>
      <rect x="16" y="10" width="52" height="52" rx="6" fill="var(--surface2)" />
      <rect x="92" y="10" width="52" height="52" rx="6" fill="var(--surface2)" />
      <path d="M 22 56 C 30 50 40 38 62 26" stroke="url(#cg1)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M 98 56 C 106 44 116 32 138 22" stroke="url(#cg2)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <circle cx="80" cy="36" r="10" fill="var(--bg)" stroke="var(--border)" strokeWidth="1.5" />
      <text x="80" y="40" fontSize="8" fill="var(--text-muted)" textAnchor="middle" fontWeight="700">VS</text>
      <text x="42" y="74" fontSize="8" fill={ACCENT_A} textAnchor="middle">2012</text>
      <text x="118" y="74" fontSize="8" fill={ACCENT_B} textAnchor="middle">2024</text>
    </svg>
  );
}

function IllustrationCommunity() {
  return (
    <svg viewBox="0 0 160 90" width="160" height="90" style={{ display: "block", margin: "0 auto" }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <text key={i} x={28 + i * 22} y="32" fontSize="20" textAnchor="middle" fill={i < 4 ? "#f59e0b" : "var(--border)"}>★</text>
      ))}
      <rect x="16" y="44" width="90" height="6" rx="3" fill="var(--surface2)" />
      <rect x="16" y="56" width="68" height="6" rx="3" fill="var(--surface2)" />
      <rect x="16" y="68" width="50" height="6" rx="3" fill="var(--surface2)" />
      <rect x="118" y="44" width="30" height="20" rx="10" fill={`${ACCENT_A}20`} stroke={ACCENT_A} strokeWidth="1.5" />
      <text x="133" y="58" fontSize="10" fill={ACCENT_A} textAnchor="middle" fontWeight="700">▲ 12</text>
    </svg>
  );
}

// ── Genre picker data ─────────────────────────────────────────────────────────

const GENRE_OPTIONS = [
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

function GenreChip({ genre, selected, onToggle }) {
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

// ── Slides data ───────────────────────────────────────────────────────────────

const SLIDES = [
  {
    illustration: <IllustrationTrajectory />,
    title: "500M streams isn't what it used to be",
    body: "Spotify's audience is 10× bigger than it was in 2014. Contour adjusts for that — so old and new releases finally compete on equal footing.",
  },
  {
    illustration: <IllustrationCompare />,
    title: "Drop any two albums. See who wins.",
    body: "Adjusted trajectories, side by side. Switch editions, share the link, settle the debate.",
  },
  {
    illustration: <IllustrationCommunity />,
    title: "Your take matters here",
    body: "Rate it, review it, see what everyone else thinks. Search something you love to get started.",
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
  const [visible, setVisible] = useState(false);
  const [slide, setSlide] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [genrePicker, setGenrePicker] = useState(false); // true = genre step
  const [selectedGenres, setSelectedGenres] = useState([]);

  // total dots = slides + genre step
  const totalSteps = SLIDES.length + 1;
  const currentStep = genrePicker ? SLIDES.length : slide;

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

  function saveGenresAndDismiss() {
    if (selectedGenres.length > 0) {
      localStorage.setItem(GENRES_KEY, JSON.stringify(selectedGenres));
    }
    dismiss();
  }

  function toggleGenre(slug) {
    setSelectedGenres((prev) =>
      prev.includes(slug) ? prev.filter((g) => g !== slug) : [...prev, slug]
    );
  }

  function next() {
    if (genrePicker) {
      saveGenresAndDismiss();
      return;
    }
    if (slide < SLIDES.length - 1) {
      setSlide((s) => s + 1);
    } else {
      // Move to genre picker step
      setGenrePicker(true);
    }
  }

  function prev() {
    if (genrePicker) {
      setGenrePicker(false);
      setSlide(SLIDES.length - 1);
      return;
    }
    if (slide > 0) setSlide((s) => s - 1);
  }

  if (!visible) return null;

  const current = SLIDES[slide];

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

      {/* Card */}
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
          padding: genrePicker ? "24px 24px 20px" : "28px 24px 24px",
          maxWidth: 480,
          margin: "0 auto",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
        }}>
          {/* Drag handle */}
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border)", margin: "0 auto 24px" }} />

          {/* ── Genre picker step ── */}
          {genrePicker ? (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h2 style={{
                  fontSize: 20, fontWeight: 800, margin: "0 0 8px",
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                }}>
                  What do you listen to?
                </h2>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                  Pick your genres — your For You feed starts here.
                  {selectedGenres.length > 0 && (
                    <span style={{ color: ACCENT_A, fontWeight: 700 }}> {selectedGenres.length} selected</span>
                  )}
                </p>
              </div>

              {/* Genre grid */}
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center",
                marginBottom: 20,
                maxHeight: 240, overflowY: "auto",
              }}>
                {GENRE_OPTIONS.map((g) => (
                  <GenreChip key={g.slug} genre={g} selected={selectedGenres} onToggle={toggleGenre} />
                ))}
              </div>

              {/* Dots */}
              <div style={{ marginBottom: 18 }}>
                <Dots total={totalSteps} active={currentStep} />
              </div>

              {/* Buttons */}
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={prev} style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  background: "var(--surface2)", border: "1px solid var(--border)",
                  color: "var(--text-muted)", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}>
                  Back
                </button>
                <button onClick={saveGenresAndDismiss} style={{
                  flex: 2, padding: "12px 0", borderRadius: 12,
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  border: "none", color: "#000", fontSize: 14, fontWeight: 800, cursor: "pointer",
                }}>
                  {selectedGenres.length > 0 ? "Start listening →" : "Skip for now →"}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* ── Standard slide ── */}
              <div style={{ marginBottom: 24 }}>{current.illustration}</div>

              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <h2 style={{
                  fontSize: 20, fontWeight: 800, margin: "0 0 10px",
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                }}>
                  {current.title}
                </h2>
                <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.7, margin: 0 }}>
                  {current.body}
                </p>
              </div>

              <div style={{ marginBottom: 20 }}>
                <Dots total={totalSteps} active={currentStep} />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                {slide > 0 ? (
                  <button onClick={prev} style={{
                    flex: 1, padding: "12px 0", borderRadius: 12,
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    color: "var(--text-muted)", fontSize: 14, fontWeight: 600, cursor: "pointer",
                  }}>
                    Back
                  </button>
                ) : (
                  <button onClick={dismiss} style={{
                    flex: 1, padding: "12px 0", borderRadius: 12,
                    background: "none", border: "1px solid var(--border)",
                    color: "var(--text-muted)", fontSize: 14, cursor: "pointer",
                  }}>
                    Skip
                  </button>
                )}
                <button onClick={next} style={{
                  flex: 2, padding: "12px 0", borderRadius: 12,
                  background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  border: "none", color: "#000", fontSize: 14, fontWeight: 800, cursor: "pointer",
                }}>
                  {slide === SLIDES.length - 1 ? "Pick your genres →" : "Next →"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
