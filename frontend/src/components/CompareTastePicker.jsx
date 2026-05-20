import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { userAvatar } from "../utils/userAvatar.js";

const ACCENT = "#d97a3b";

/**
 * Modal user-search for the "Compare taste with…" entry point on the
 * own-profile page. Typing debounces a /users/search call; selecting a
 * row navigates to /taste-match/:id which renders the head-to-head card.
 *
 * Kept as a standalone component (rather than inline in ProfilePage)
 * because the same picker is a natural fit on any "discover friends"
 * surface we add later — Friends page, suggested-users row, etc.
 */
export function CompareTastePicker({ open, onClose }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
      return;
    }
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .searchUsers(trimmed)
        .then((rows) => { if (!cancelled) setResults(rows || []); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q, open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Compare taste with a friend"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "10vh 20px 20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          width: "100%",
          maxWidth: 480,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px", borderBottom: "1px solid var(--border)",
        }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--text)" }}>
            Compare taste
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", padding: "4px 8px", cursor: "pointer", color: "var(--text-muted)", fontSize: 24, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Search input */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search users by name"
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              fontSize: 14,
              outline: "none",
            }}
          />
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {!q.trim() && (
            <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              Type a name to find someone to compare with.
            </div>
          )}
          {q.trim() && loading && results.length === 0 && (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              Searching…
            </div>
          )}
          {q.trim() && !loading && results.length === 0 && (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              No users matched "{q.trim()}".
            </div>
          )}
          {results.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                onClose?.();
                navigate(`/taste-match/${u.id}`);
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 16px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                color: "var(--text)",
              }}
            >
              <img
                src={userAvatar(u, 80)}
                alt=""
                style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {u.display_name}
                </div>
                {u.bio && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {u.bio}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 12, color: ACCENT, fontWeight: 700, flexShrink: 0 }}>
                Compare
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
