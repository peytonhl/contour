import { useState } from "react";

function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

/**
 * On mobile: opens the native OS share sheet via Web Share API.
 * On desktop: copies the URL (or text + URL) to clipboard and briefly shows "Copied!".
 *
 * Props:
 *   title — share-sheet headline
 *   text  — optional body shown by native share sheets (snippet of the review,
 *           tweet-style summary, etc). On desktop fallback we prepend it to the
 *           clipboard payload so the recipient gets context, not a bare URL.
 *   url   — optional target. Defaults to window.location.href so existing call
 *           sites (album page, comparison page) keep working unchanged.
 */
export function ShareButton({ title, text, url, style }) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const shareUrl = url ?? window.location.href;
    if (navigator.share) {
      try {
        // Web Share API ignores undefined fields, so passing text only when set
        // keeps the share sheet clean on calls that just want title + url.
        const payload = { title, url: shareUrl };
        if (text) payload.text = text;
        await navigator.share(payload);
      } catch {
        // user cancelled — ignore
      }
    } else {
      try {
        const clipboardPayload = text ? `${text}\n${shareUrl}` : shareUrl;
        await navigator.clipboard.writeText(clipboardPayload);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // clipboard blocked — silently fail
      }
    }
  }

  return (
    <button
      onClick={handleShare}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "8px 18px",
        background: "var(--surface2)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        color: copied ? "var(--accent-b)" : "var(--text-muted)",
        fontSize: 13, fontWeight: 600,
        cursor: "pointer",
        transition: "color 0.15s, border-color 0.15s",
        ...style,
      }}
    >
      <UploadIcon />
      {copied ? "Copied!" : "Share"}
    </button>
  );
}
