import { useState, useEffect } from "react";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT_B = "#34d399";

export function WantToListenButton({ albumId }) {
  const { user } = useAuth();
  const [inBacklog, setInBacklog] = useState(null);  // null = unknown / loading
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!user || !albumId) { setInBacklog(false); return; }
    let cancelled = false;
    api.checkBacklog(albumId)
      .then((r) => { if (!cancelled) setInBacklog(r.in_backlog); })
      .catch(() => { if (!cancelled) setInBacklog(false); });
    return () => { cancelled = true; };
  }, [albumId, user]);

  async function toggle() {
    if (!user) {
      // Send the user through the same sign-in nudge other gated actions use.
      window.location.href = `${import.meta.env.VITE_API_URL ?? ""}/auth/login`;
      return;
    }
    if (pending) return;
    setPending(true);
    // Optimistic flip
    const next = !inBacklog;
    setInBacklog(next);
    try {
      if (next) {
        await api.addToBacklog(albumId);
        analytics.backlogAdded(albumId);
      } else {
        await api.removeFromBacklog(albumId);
      }
    } catch {
      // Roll back on failure
      setInBacklog(!next);
    } finally {
      setPending(false);
    }
  }

  // Match the other secondary actions on the hero (Compare / Spotify / etc.).
  const baseStyle = {
    padding: "8px 16px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
    letterSpacing: "0.01em",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    transition: "all 0.15s",
  };

  if (inBacklog) {
    return (
      <button
        onClick={toggle}
        disabled={pending}
        style={{
          ...baseStyle,
          background: `${ACCENT_B}18`,
          borderColor: `${ACCENT_B}50`,
          color: ACCENT_B,
          fontWeight: 700,
        }}
        title="Click to remove from backlog"
      >
        ✓ In your backlog
      </button>
    );
  }
  return (
    <button
      onClick={toggle}
      disabled={pending}
      style={{
        ...baseStyle,
        background: "var(--surface2)",
        color: "var(--text-muted)",
      }}
    >
      + Want to listen
    </button>
  );
}
