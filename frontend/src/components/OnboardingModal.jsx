import { useState, useEffect } from "react";

const STORAGE_KEY = "contour_onboarded_v1";
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
      {/* Axes */}
      <line x1="16" y1="10" x2="16" y2="74" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="74" x2="148" y2="74" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" />
      {/* Old song (faded) */}
      <path d="M 20 70 C 40 65 60 55 100 44 C 120 38 135 35 145 33"
        stroke={ACCENT_A} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.35" strokeDasharray="4 3" />
      {/* Adjusted song (bright) */}
      <path d="M 20 70 C 40 60 60 45 90 30 C 110 20 130 15 145 13"
        stroke="url(#tg)" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Era label */}
      <text x="52" y="86" fontSize="8" fill="var(--text-muted)" textAnchor="middle">2012 release</text>
      <text x="118" y="86" fontSize="8" fill="var(--text-muted)" textAnchor="middle">today</text>
      {/* Dot */}
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
      {/* Two album covers */}
      <rect x="16" y="10" width="52" height="52" rx="6" fill="var(--surface2)" />
      <rect x="92" y="10" width="52" height="52" rx="6" fill="var(--surface2)" />
      {/* Mini charts inside */}
      <path d="M 22 56 C 30 50 40 38 62 26" stroke="url(#cg1)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M 98 56 C 106 44 116 32 138 22" stroke="url(#cg2)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* VS badge */}
      <circle cx="80" cy="36" r="10" fill="var(--bg)" stroke="var(--border)" strokeWidth="1.5" />
      <text x="80" y="40" fontSize="8" fill="var(--text-muted)" textAnchor="middle" fontWeight="700">VS</text>
      {/* Labels */}
      <text x="42" y="74" fontSize="8" fill={ACCENT_A} textAnchor="middle">2012</text>
      <text x="118" y="74" fontSize="8" fill={ACCENT_B} textAnchor="middle">2024</text>
    </svg>
  );
}

function IllustrationCommunity() {
  return (
    <svg viewBox="0 0 160 90" width="160" height="90" style={{ display: "block", margin: "0 auto" }}>
      {/* Stars row */}
      {[0, 1, 2, 3, 4].map((i) => (
        <text key={i} x={28 + i * 22} y="32" fontSize="20" textAnchor="middle" fill={i < 4 ? "#f59e0b" : "var(--border)"}>★</text>
      ))}
      {/* Review lines */}
      <rect x="16" y="44" width="90" height="6" rx="3" fill="var(--surface2)" />
      <rect x="16" y="56" width="68" height="6" rx="3" fill="var(--surface2)" />
      <rect x="16" y="68" width="50" height="6" rx="3" fill="var(--surface2)" />
      {/* Upvote button */}
      <rect x="118" y="44" width="30" height="20" rx="10" fill={`${ACCENT_A}20`} stroke={ACCENT_A} strokeWidth="1.5" />
      <text x="133" y="58" fontSize="10" fill={ACCENT_A} textAnchor="middle" fontWeight="700">▲ 12</text>
    </svg>
  );
}

// ── Slides data ───────────────────────────────────────────────────────────────

const SLIDES = [
  {
    illustration: <IllustrationTrajectory />,
    title: "Streams, adjusted for time",
    body: "A song that hit 500M streams in 2014 did it on a platform with 1/10th the users Spotify has today. Contour adjusts for this — so you can finally compare across eras on equal footing.",
  },
  {
    illustration: <IllustrationCompare />,
    title: "Compare any two releases",
    body: "Put a 2009 classic side-by-side with a 2024 hit and see their adjusted trajectories on the same chart. Switch between standard and deluxe editions, save the link, share it.",
  },
  {
    illustration: <IllustrationCommunity />,
    title: "Rate, review, discover",
    body: "Half-star ratings, written reviews, upvotes, replies, and a global feed of what people are saying — sorted by recent, top, or most controversial.",
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

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      // Small delay so the app renders first
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

  function next() {
    if (slide < SLIDES.length - 1) {
      setSlide((s) => s + 1);
    } else {
      dismiss();
    }
  }

  function prev() {
    if (slide > 0) setSlide((s) => s - 1);
  }

  if (!visible) return null;

  const isLast = slide === SLIDES.length - 1;
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
          padding: "28px 24px 24px",
          maxWidth: 480,
          margin: "0 auto",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
        }}>
          {/* Drag handle */}
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border)", margin: "0 auto 24px" }} />

          {/* Illustration */}
          <div style={{ marginBottom: 24 }}>{current.illustration}</div>

          {/* Text */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <h2 style={{
              fontSize: 20, fontWeight: 800, margin: "0 0 10px",
              background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
              {current.title}
            </h2>
            <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.7, margin: 0 }}>
              {current.body}
            </p>
          </div>

          {/* Dots */}
          <div style={{ marginBottom: 20 }}>
            <Dots total={SLIDES.length} active={slide} />
          </div>

          {/* Buttons */}
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
              {isLast ? "Let's go →" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
