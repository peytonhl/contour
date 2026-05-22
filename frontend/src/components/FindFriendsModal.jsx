import { useState, useEffect, useRef } from "react";
import { api } from "../services/api.js";
import { SuggestedUser } from "./FollowingTab.jsx";

/**
 * "Find friends" modal — opened from the + button on FriendsPage.
 *
 * Two surfaces in one:
 *  - When the search input is empty: shows the algorithmic suggested
 *    users (api.getSuggestedUsers) with their ranking reason badge.
 *  - When typing: hits api.searchUsers(q) and shows display-name matches.
 *
 * Both paths render the same SuggestedUser row (extracted from
 * FollowingTab) so the Follow CTA, avatar, and meta line are visually
 * identical. Search results carry reason=null; the badge just doesn't
 * render in that case.
 *
 * Debounce: 250ms on search input — long enough that the query doesn't
 * fire on every keystroke, short enough that results feel responsive.
 */
export function FindFriendsModal({ open, onClose }) {
  const [query, setQuery] = useState("");
  const [suggested, setSuggested] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);

  // Suggested users — fetched once when the modal opens. Cached for the
  // session so re-opening the modal doesn't fire a new request.
  useEffect(() => {
    if (!open) return;
    if (suggested.length > 0) return;
    api.getSuggestedUsers().then(setSuggested).catch(() => {});
  }, [open]);

  // Autofocus the search input on open so iOS pulls up the keyboard
  // immediately. Slight delay because modals fade in.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open]);

  // Debounced search. Empty query → clear results, show suggested.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      api.searchUsers(q)
        .then((rows) => setSearchResults(rows || []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset query on close so re-opening starts fresh.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  if (!open) return null;

  const showingSearch = query.trim().length > 0;
  const rows = showingSearch ? searchResults : suggested;

  // When a user is followed from the modal, drop them from the visible
  // list so the row's "Following ✓" state doesn't linger when they could
  // be replaced by the next suggestion.
  function handleFollowed(userId) {
    setSuggested((prev) => prev.filter((u) => u.id !== userId));
    setSearchResults((prev) => prev.filter((u) => u.id !== userId));
  }

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Find friends"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 1000,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "20px",
        paddingTop: "max(env(safe-area-inset-top, 0px), 40px)",
        paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          borderRadius: "var(--radius-xl)",
          maxWidth: 480, width: "100%",
          maxHeight: "100%",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          border: "1px solid var(--border)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px", borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: "var(--font-display)",
            fontSize: 22, color: "var(--text)",
          }}>Find friends</span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none", border: "none", padding: "4px 8px",
              cursor: "pointer", color: "var(--text-muted)",
              fontSize: 24, lineHeight: 1,
            }}
          >×</button>
        </div>

        {/* Search input */}
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            inputMode="search"
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--text)",
              fontSize: 14,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Body — suggested users when search is empty, search results when typing */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: "12px 16px",
          display: "flex", flexDirection: "column", gap: 12,
        }}>
          {!showingSearch && rows.length > 0 && (
            <p style={{
              fontFamily: "var(--font-display)", fontSize: 17,
              color: "var(--text)", margin: "0 0 4px",
            }}>
              Suggested for you
            </p>
          )}
          {showingSearch && searching && (
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
              Searching…
            </p>
          )}
          {rows.map((u) => (
            <SuggestedUser key={u.id} u={u} onFollow={handleFollowed} />
          ))}
          {!showingSearch && !searching && rows.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
              No suggestions right now. Try searching by name.
            </p>
          )}
          {showingSearch && !searching && rows.length === 0 && query.trim() && (
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
              No users matching "{query}".
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
