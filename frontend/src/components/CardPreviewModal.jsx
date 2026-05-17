import { useState, useEffect } from "react";
import { shareCard, saveCard } from "../utils/share.js";

const ACCENT = "#d97a3b";

/**
 * Modal preview for a shareable PNG card (review / comparison / hot-take).
 *
 * Why a modal preview instead of direct-to-share-sheet:
 *  - Lets the user verify the card looks right before sending — the previous
 *    direct-share flow on iOS Capacitor was silently falling back to URL-only
 *    share, so the user never saw whether a PNG was attached. The modal makes
 *    the artifact visible and the share intent explicit.
 *  - Separates "share" from "save to device" as two clear affordances, which
 *    is what we promised in the product brief ("save to their device OR
 *    directly share in the visual format").
 *
 * The actual share/save dispatch lives in utils/share.js — native path uses
 * @capacitor/share + @capacitor/filesystem, web path uses Web Share Level 2
 * with a download-anchor fallback.
 */
export function CardPreviewModal({
  open,
  onClose,
  cardUrl,
  shareUrl,
  shareText,
  fileName,
}) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);  // "share" | "save" | null

  // Fetch the PNG when the modal opens so the user sees the card immediately.
  // Revoke the object URL on close to free memory.
  useEffect(() => {
    if (!open || !cardUrl) return;
    let cancelled = false;
    let createdUrl = null;
    setBlobUrl(null);
    setError(null);

    fetch(cardUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((e) => { if (!cancelled) setError(e.message || "Failed to load"); });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, cardUrl]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleShare() {
    if (busy) return;
    setBusy("share");
    try { await shareCard({ cardUrl, shareUrl, shareText, fileName }); }
    catch { /* user cancelled or share failed — keep the modal open */ }
    setBusy(null);
  }

  async function handleSave() {
    if (busy) return;
    setBusy("save");
    try { await saveCard({ cardUrl, fileName }); }
    catch { /* same */ }
    setBusy(null);
  }

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share your card"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
        paddingTop: "max(env(safe-area-inset-top, 0px), 20px)",
        paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          borderRadius: "var(--radius-xl)",
          maxWidth: 420, width: "100%",
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
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: "var(--font-display)",
            fontSize: 20, color: "var(--text)",
          }}>Your card</span>
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

        {/* Preview */}
        <div style={{
          flex: 1, padding: 16, display: "flex",
          alignItems: "center", justifyContent: "center",
          minHeight: 200, background: "#0a0a0a",
          overflow: "auto",
        }}>
          {error ? (
            <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 20, fontSize: 14 }}>
              Couldn't generate card. Try again in a moment.
            </div>
          ) : blobUrl ? (
            <img
              src={blobUrl}
              alt="Card preview"
              style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: 4, display: "block" }}
            />
          ) : (
            <div style={{ color: "var(--text-muted)", padding: 20, fontSize: 14 }}>
              Generating your card…
            </div>
          )}
        </div>

        {/* Footer — two CTAs side by side. Save is secondary (outlined) so
            Share reads as the primary action; both ultimately route through
            the system share sheet on native, but the labels communicate
            distinct intent. */}
        <div style={{
          padding: 16, borderTop: "1px solid var(--border)",
          display: "flex", gap: 10, flexShrink: 0,
        }}>
          <button
            onClick={handleSave}
            disabled={!blobUrl || busy !== null}
            style={{
              flex: 1, padding: "12px 16px",
              background: "transparent",
              color: blobUrl ? "var(--text)" : "var(--text-muted)",
              border: `1px solid ${blobUrl ? "var(--border)" : "var(--surface2)"}`,
              borderRadius: "var(--radius-xl)",
              fontSize: 14, fontWeight: 600,
              cursor: (blobUrl && !busy) ? "pointer" : "default",
            }}
          >
            {busy === "save" ? "Saving…" : "Save image"}
          </button>
          <button
            onClick={handleShare}
            disabled={!blobUrl || busy !== null}
            style={{
              flex: 1, padding: "12px 16px",
              background: blobUrl ? ACCENT : "var(--surface2)",
              color: blobUrl ? "#000" : "var(--text-muted)",
              border: "none", borderRadius: "var(--radius-xl)",
              fontSize: 14, fontWeight: 700,
              cursor: (blobUrl && !busy) ? "pointer" : "default",
            }}
          >
            {busy === "share" ? "Sharing…" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}
