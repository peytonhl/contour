import { useState } from "react";

const ACCENT = "#d97a3b";
const GOLD = "#f59e0b";

function Star({ fill, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <defs>
        <linearGradient id={`half-${fill}`}>
          <stop offset="50%" stopColor={fill === "half" ? GOLD : fill === "full" ? GOLD : "transparent"} />
          <stop offset="50%" stopColor={fill === "full" ? GOLD : "transparent"} />
        </linearGradient>
      </defs>
      <polygon
        points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7"
        fill={
          fill === "full" ? GOLD :
          fill === "half" ? `url(#half-${fill})` :
          "var(--surface2)"
        }
        stroke={fill === "empty" ? "var(--border)" : GOLD}
        strokeWidth="0.5"
      />
    </svg>
  );
}

function renderStars(value, size) {
  return [1, 2, 3, 4, 5].map((n) => {
    const fill = value >= n ? "full" : value >= n - 0.5 ? "half" : "empty";
    return <Star key={n} fill={fill} size={size} />;
  });
}

export function StarRating({ entityType, entityId, summary, onRated, user }) {
  const [hover, setHover] = useState(null);
  const [saving, setSaving] = useState(false);

  const { average, count, user_rating } = summary ?? {};
  const displayValue = hover ?? user_rating ?? average ?? 0;

  async function handleClick(e, starIndex) {
    if (!user) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const value = x < rect.width / 2 ? starIndex - 0.5 : starIndex;
    setSaving(true);
    try {
      await onRated(value);
    } finally {
      setSaving(false);
    }
  }

  function handleMouseMove(e, starIndex) {
    if (!user) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setHover(x < rect.width / 2 ? starIndex - 0.5 : starIndex);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>
        Rating
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{ display: "flex", gap: 2, cursor: user ? "pointer" : "default", opacity: saving ? 0.5 : 1 }}
          onMouseLeave={() => setHover(null)}
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const fill = displayValue >= n ? "full" : displayValue >= n - 0.5 ? "half" : "empty";
            return (
              <div
                key={n}
                onClick={(e) => handleClick(e, n)}
                onMouseMove={(e) => handleMouseMove(e, n)}
                style={{ lineHeight: 0 }}
              >
                <Star fill={fill} size={22} />
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {average ? (
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
              {average.toFixed(1)}
              <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)", marginLeft: 4 }}>
                / 5 · {count} {count === 1 ? "rating" : "ratings"}
              </span>
            </span>
          ) : (
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>No ratings yet</span>
          )}
          {user_rating && !hover && (
            <span style={{ fontSize: 11, color: ACCENT }}>Your rating: {user_rating}</span>
          )}
          {hover && user && (
            <span style={{ fontSize: 11, color: GOLD }}>Click to rate {hover}</span>
          )}
          {!user && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Sign in to rate</span>
          )}
        </div>
      </div>
    </div>
  );
}
