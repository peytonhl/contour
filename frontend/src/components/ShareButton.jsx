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
 * On desktop: copies the URL to clipboard and briefly shows "Copied!".
 */
export function ShareButton({ title, style }) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // user cancelled — ignore
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
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
