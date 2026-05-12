import { useState, useEffect } from "react";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT_B = "#34d399";

/**
 * Toggleable "Want to listen" button shown on entity hero rows.
 *
 * Accepts either an albumId (back-compat — defaults entityType to "album")
 * or an explicit entityType + entityId pair so the same component works on
 * both AlbumPage and TrackPage.
 */
export function WantToListenButton({ entityType = "album", entityId, albumId }) {
  const { user } = useAuth();
  // Back-compat: older call sites passed only `albumId`.
  const type = entityType;
  const id = entityId ?? albumId;

  const [inBacklog, setInBacklog] = useState(null);  // null = unknown / loading
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!user || !id) { setInBacklog(false); return; }
    let cancelled = false;
    api.checkBacklog(type, id)
      .then((r) => { if (!cancelled) setInBacklog(r.in_backlog); })
      .catch(() => { if (!cancelled) setInBacklog(false); });
    return () => { cancelled = true; };
  }, [type, id, user]);

  async function toggle() {
    if (!user) {
      // Send the user through the same sign-in nudge other gated actions use.
      window.location.href = `${import.meta.env.VITE_API_URL ?? ""}/auth/login`;
      return;
    }
    if (pending) return;
    setPending(true);
    const next = !inBacklog;
    setInBacklog(next);  // optimistic
    try {
      if (next) {
        await api.addToBacklog(type, id);
        analytics.backlogAdded(id);
      } else {
        await api.removeFromBacklog(type, id);
      }
    } catch {
      setInBacklog(!next);  // roll back on failure
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
