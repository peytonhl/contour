import { useState, useEffect } from "react";
import { shareCard, saveCard } from "../utils/share.js";

const ACCENT = "#d97a3b";

// Version stamp appended to every OG card URL. Bump this when the card
// design changes meaningfully — the OG handler sends Cache-Control with
// max-age=3600, and the iOS WebView honors that aggressively (the PNG
// stays cached for up to an hour even after we redeploy the renderer).
// A version param doesn't break Vercel's edge cache because each (id, v)
// pair is its own cache key, so once everyone's on v=N the new key gets
// edge-cached normally; old (id, v=N-1) URLs just go cold.
//
// Bump history:
//  v3 (2026-05-17): square 1080×1080, SVG star, Spotify cover for tracks,
//                   vertically-centered body row, 560×560 cover.
//  v4 (2026-05-17): wordmark 40 → 64, quote column vertically centered
//                   within cover height (no more right-side dead zone).
//  v5 (2026-05-17): inline error surfacing + Media→Share fallback when
//                   the save plugin can't reach the Photos library.
//  v6 (2026-05-17): wordmark 64 → 88, cover 560 → 640, body top-anchored
//                   so canvas fills better (no more empty band above).
//  v7 (2026-05-17): cover 640 → 600, tighter gap/padding to give the
//                   quote column room (v6 was cramping meta + quote).
//  v8 (2026-05-17): cover 600 → 660, vertically center body row again,
//                   quote 48 → 44 so the narrower column doesn't cramp.
const CARD_VERSION = "8";

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
  // Error from the share / save action itself. Distinct from `error`
  // (which only covers the initial PNG fetch); rendered as an inline
  // line below the action buttons so the user sees what went wrong
  // instead of "nothing happens when you tap it".
  const [actionError, setActionError] = useState(null);

  // Append the version stamp so the WebView/browser cache treats new card
  // designs as a fresh URL instead of serving the stale 1080×1350 layout
  // it cached when the design first shipped. Same versioned URL is used
  // for the preview fetch AND the share/save dispatches so the modal
  // preview and the actual shared PNG can't drift apart.
  const versionedCardUrl = cardUrl
    ? cardUrl + (cardUrl.includes("?") ? "&" : "?") + "v=" + CARD_VERSION
    : cardUrl;

  // Fetch the PNG when the modal opens so the user sees the card immediately.
  // Revoke the object URL on close to free memory.
  useEffect(() => {
    if (!open || !versionedCardUrl) return;
    let cancelled = false;
    let createdUrl = null;
    setBlobUrl(null);
    setError(null);

    fetch(versionedCardUrl)
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
  }, [open, versionedCardUrl]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Surface errors in the modal instead of swallowing them. Previously a
  // failed save (plugin missing, permission denied, sandbox issue, etc.)
  // produced "nothing happens when you tap it" because every catch was
  // empty — caller and user both blind. Now any failure renders an inline
  // error line below the buttons; cleared on the next tap or modal close.
  // User-cancelled share/save (AbortError on Web Share, Cancel button on
  // share sheet) are filtered out so we don't accuse iOS of failing when
  // the user just changed their mind.
  function isUserCancel(e) {
    const msg = (e && (e.message || e.name || "")) + "";
    return msg.includes("Abort") || msg.includes("cancel") || msg.includes("Cancel");
  }

  async function handleShare() {
    if (busy) return;
    setActionError(null);
    setBusy("share");
    try { await shareCard({ cardUrl: versionedCardUrl, shareUrl, shareText, fileName }); }
    catch (e) {
      if (!isUserCancel(e)) setActionError(`Share failed: ${e?.message || e}`);
    }
    setBusy(null);
  }

  async function handleSave() {
    if (busy) return;
    setActionError(null);
    setBusy("save");
    try {
      const result = await saveCard({ cardUrl: versionedCardUrl, fileName });
      // Plugin not available on this build → we fell back to the share
      // sheet, which IS a usable save path (Save Image is on it) but not
      // what the button label promises. Let the user know.
      if (result === "shared-fallback") {
        setActionError("Save plugin not available in this build — opened share sheet instead. Tap \"Save Image\" there.");
      }
    } catch (e) {
      if (!isUserCancel(e)) setActionError(`Save failed: ${e?.message || e}`);
    }
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

        {/* Inline error line — surfaces share/save failures (plugin missing,
            permission denied, fallback used, etc.) so the user can see what
            went wrong instead of nothing-happening on tap. */}
        {actionError && (
          <div style={{
            padding: "10px 16px", borderTop: "1px solid var(--border)",
            color: "var(--danger, #f87171)",
            fontSize: 12, lineHeight: 1.4,
            flexShrink: 0,
          }}>
            {actionError}
          </div>
        )}

        {/* Footer — two CTAs side by side. Save is secondary (outlined) so
            Share reads as the primary action. */}
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
