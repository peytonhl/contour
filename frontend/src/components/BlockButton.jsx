import { useState } from "react";
import { api } from "../services/api.js";
import { DANGER } from "../theme.js";

/**
 * Block / unblock toggle for use on a UserPage's hero. Default state comes
 * from the parent (typically `profile.is_blocked`); the button optimistically
 * updates the parent via onChange so the user's reviews disappear immediately
 * from the viewer's perspective on the next render.
 *
 * Confirms before blocking (one tap can hide a lot of content), one-tap unblock.
 */
export function BlockButton({ targetUserId, initiallyBlocked, onChange }) {
  const [blocked, setBlocked] = useState(!!initiallyBlocked);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function doBlock() {
    setBusy(true);
    try {
      await api.blockUser(targetUserId);
      setBlocked(true);
      setConfirming(false);
      onChange?.(true);
    } catch { /* leave UI as-is on failure */ }
    setBusy(false);
  }

  async function doUnblock() {
    setBusy(true);
    try {
      await api.unblockUser(targetUserId);
      setBlocked(false);
      onChange?.(false);
    } catch {}
    setBusy(false);
  }

  if (blocked) {
    return (
      <button
        onClick={doUnblock}
        disabled={busy}
        title="Unblock this user"
        style={{
          padding: "8px 14px", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 600,
          background: "rgba(248,113,113,0.10)", color: DANGER,
          border: `1px solid ${DANGER}`,
          cursor: busy ? "default" : "pointer",
        }}
      >
        Blocked · Unblock
      </button>
    );
  }

  if (confirming) {
    return (
      <span style={{ display: "inline-flex", gap: 6 }}>
        <button
          onClick={doBlock}
          disabled={busy}
          style={{
            padding: "8px 14px", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 700,
            background: DANGER, color: "#000", border: "none",
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "…" : "Confirm block"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          style={{
            padding: "8px 12px", borderRadius: "var(--radius-sm)", fontSize: 12,
            background: "none", color: "var(--text-muted)",
            border: "1px solid var(--border)", cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title="Block this user. Their content will be hidden from you."
      style={{
        padding: "8px 12px", borderRadius: "var(--radius-sm)", fontSize: 12,
        background: "none", color: "var(--text-muted)",
        border: "1px solid var(--border)", cursor: "pointer",
      }}
    >
      Block
    </button>
  );
}
