import { useEffect, useState } from "react";
import { AppleSignInButton } from "./AppleSignInButton.jsx";
import { withNativeAuthFlag, externalLinkProps } from "../utils/native.js";
import { AUTH_PROMPT_EVENT } from "../services/authGate.js";
import { clearPendingIntent } from "../services/pendingIntent.js";
import { analytics } from "../services/analytics.js";

// Contextual sign-in sheet — the "demoted, distributed" sign-in. It slides up
// OVER the current screen (never a navigation to a separate page that loses
// context) when a guest takes a gated action. The pending intent is already
// captured by requireAuth; this sheet just states WHY in one line and offers
// the existing one-tap OAuth. After auth, AuthContext.login() replays the
// captured intent, so the user's action completes without a redo.
//
// Mounted once at App level. Opens on the contour:auth-prompt window event.

// One-line "why" per intent kind. The framing is "save / keep", at the moment
// it matters — not a generic "Sign in."
const COPY = {
  rate:       { title: "Save your rating",         sub: "Sign in to keep your ratings and tune your feed to your taste." },
  review:     { title: "Save your review",         sub: "Sign in to post your review and keep it on your profile." },
  follow:     { title: "Keep this",                sub: "Sign in to follow and see them in your feed." },
  backlog:    { title: "Save this",                sub: "Sign in to add it to your backlog and find it later." },
  list:       { title: "Save your list",           sub: "Sign in to keep your list and share it." },
  card:       { title: "Save and share your card", sub: "Sign in to save your taste card and share it anywhere." },
  profile:    { title: "This is your page",        sub: "Sign in to claim it and start building your profile." },
  onboarding: { title: "Start rating, keep your feed", sub: "Sign in to rate tracks and keep the feed you just built." },
  _default:   { title: "Sign in to continue",      sub: "Sign in to save what you're doing." },
};

function GoogleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}

export function AuthPromptSheet() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("_default");
  const [trigger, setTrigger] = useState(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    function onPrompt(e) {
      setKind(e.detail?.kind || "_default");
      setTrigger(e.detail?.triggerLabel || e.detail?.kind || null);
      setExiting(false);
      setOpen(true);
    }
    window.addEventListener(AUTH_PROMPT_EVENT, onPrompt);
    return () => window.removeEventListener(AUTH_PROMPT_EVENT, onPrompt);
  }, []);

  function dismiss() {
    // User backed out without signing in. Drop the captured intent so it can't
    // fire on some later, unrelated sign-in, and log the dismissal for the
    // shown→completed funnel.
    try { analytics.signupPromptDismissed(trigger || kind); } catch {}
    clearPendingIntent();
    setExiting(true);
    setTimeout(() => { setOpen(false); setExiting(false); }, 200);
  }

  if (!open) return null;

  const copy = COPY[kind] || COPY._default;
  // Google is a full-page redirect; AuthSuccessPage replays the intent + lands
  // the user back on returnTo. Native appends ?from=native for the deep-link
  // return. (Apple uses the in-context popup below.)
  const LOGIN_URL = withNativeAuthFlag(`${import.meta.env.VITE_API_URL ?? ""}/auth/login`);

  return (
    <>
      <div
        onClick={dismiss}
        style={{
          position: "fixed", inset: 0, zIndex: 320,
          background: "rgba(0,0,0,0.6)",
          opacity: exiting ? 0 : 1, transition: "opacity 0.2s",
        }}
      />
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 321,
        padding: "0 16px calc(env(safe-area-inset-bottom, 16px) + 16px)",
        transform: exiting ? "translateY(100%)" : "translateY(0)",
        transition: "transform 0.22s cubic-bezier(0.32,0.72,0,1)",
      }}>
        <div style={{
          background: "var(--surface)",
          borderRadius: "var(--radius-xl) var(--radius-xl) var(--radius-lg) var(--radius-lg)",
          padding: "22px 22px 18px", maxWidth: 440, margin: "0 auto",
          boxShadow: "var(--shadow-3)",
        }}>
          <div style={{ width: 36, height: 4, borderRadius: "var(--radius-sm)", background: "var(--surface3)", margin: "0 auto 18px" }} />

          <h2 style={{
            fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 400,
            margin: "0 0 8px", color: "var(--text)", lineHeight: 1.1, textAlign: "center",
          }}>
            {copy.title}
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 20px", lineHeight: 1.5, textAlign: "center" }}>
            {copy.sub}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <a href={LOGIN_URL} {...externalLinkProps()} style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              padding: "13px 20px", borderRadius: "var(--radius-pill)",
              background: "#fff", color: "#1f1f1f", fontSize: 14, fontWeight: 700,
              textDecoration: "none", border: "1px solid #dadce0",
            }}>
              <GoogleIcon size={18} />
              Continue with Google
            </a>
            {/* Apple popup resolves in-context; login() replays the intent and
                onSuccess closes the sheet (no navigation, same screen). */}
            <AppleSignInButton onSuccess={() => { setOpen(false); }} />
          </div>

          <button
            onClick={dismiss}
            style={{
              width: "100%", padding: "10px 0", marginTop: 8,
              background: "none", border: "none",
              color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </>
  );
}
