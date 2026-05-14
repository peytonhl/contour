import { useEffect, useRef, useState } from "react";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const APPLE_JS_LIB = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

// VITE_APPLE_CLIENT_ID is the Services ID configured in the Apple Developer
// portal (e.g. "com.peytonhl.contour.signin"). When unset the button is
// rendered as null and the only sign-in option is Google.
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID;

// Generate a cryptographically random nonce. Apple expects it both client-
// (passed to AppleID.auth.init) and server-side (we forward it to /auth/apple).
function generateNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let _scriptPromise = null;
function loadAppleScript() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.AppleID) return Promise.resolve();
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = APPLE_JS_LIB;
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

function AppleLogo({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path
        d="M15.07 13.94c-.27.62-.59 1.19-.97 1.71-.52.72-.94 1.22-1.27 1.5-.51.46-1.05.7-1.64.71-.42 0-.92-.12-1.51-.36-.59-.24-1.13-.36-1.62-.36-.52 0-1.07.12-1.66.36-.59.24-1.07.37-1.43.38-.56.02-1.12-.22-1.67-.74-.36-.3-.81-.83-1.34-1.59-.57-.81-1.04-1.74-1.4-2.81-.39-1.16-.59-2.28-.59-3.36 0-1.24.27-2.31.81-3.2.42-.71.99-1.27 1.7-1.68.71-.41 1.48-.62 2.31-.63.45 0 1.04.14 1.78.41.74.27 1.22.41 1.43.41.16 0 .69-.16 1.6-.49.86-.3 1.58-.43 2.17-.38 1.6.13 2.81.76 3.61 1.9-1.43.87-2.14 2.08-2.13 3.65.01 1.22.45 2.23 1.32 3.04.39.37.83.66 1.32.86-.11.31-.22.6-.33.88zM12.35 1.27c0 .92-.34 1.78-1.01 2.58-.81.95-1.79 1.5-2.85 1.41-.01-.11-.02-.23-.02-.35 0-.88.39-1.83 1.08-2.6.34-.39.78-.71 1.31-.97.53-.25 1.03-.39 1.5-.42.01.12.01.23.01.35z"
        fill="#000"
      />
    </svg>
  );
}

/**
 * Sign in with Apple button. Renders null when VITE_APPLE_CLIENT_ID is unset
 * (no key yet → just show Google). On click: loads Apple's JS lib if needed,
 * runs the AppleID popup flow with a fresh nonce, then POSTs the identity
 * token to /auth/apple. On success, the AuthContext is populated and the
 * user is redirected to home.
 *
 * The `size="small"` variant matches the compact mobile sign-in pill.
 */
export function AppleSignInButton({ size = "default", onSuccess }) {
  const { login } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const nonceRef = useRef(null);

  useEffect(() => {
    if (!APPLE_CLIENT_ID) return;
    // Pre-load the SDK so the popup opens quickly when the user taps. It
    // adds ~30 KB but only when Apple sign-in is enabled.
    loadAppleScript().catch(() => {});
  }, []);

  if (!APPLE_CLIENT_ID) return null;

  async function handleClick() {
    setBusy(true);
    setErr(null);
    try {
      await loadAppleScript();
      const nonce = generateNonce();
      nonceRef.current = nonce;
      window.AppleID.auth.init({
        clientId: APPLE_CLIENT_ID,
        scope: "name email",
        redirectURI: `${window.location.origin}/auth/success`,
        usePopup: true,
        nonce,
      });
      const data = await window.AppleID.auth.signIn();
      // Apple returns user.name only on the FIRST authentication; subsequent
      // sign-ins omit it. We pass it through to the backend on first auth.
      const fullName = data?.user?.name
        ? [data.user.name.firstName, data.user.name.lastName].filter(Boolean).join(" ")
        : null;
      const resp = await api.appleSignIn(data.authorization.id_token, nonce, fullName);
      await login(resp.token, "apple");
      onSuccess?.();
    } catch (e) {
      // The Apple JS lib throws when the user cancels — don't treat that as
      // a real error, just reset the busy state.
      if (e?.error !== "popup_closed_by_user") setErr(e?.message || "Apple sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  const compact = size === "small";
  return (
    <button
      onClick={handleClick}
      disabled={busy}
      style={{
        display: "flex", alignItems: "center", gap: compact ? 6 : 8,
        padding: compact ? "5px 10px" : "6px 14px",
        background: "#fff", borderRadius: "var(--radius-xl)",
        color: "#000", fontSize: compact ? 11 : 12, fontWeight: 600,
        textDecoration: "none",
        border: "1px solid #dadce0",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
      title={err || undefined}
    >
      <AppleLogo size={compact ? 13 : 14} />
      {busy ? "…" : "Sign in with Apple"}
    </button>
  );
}
