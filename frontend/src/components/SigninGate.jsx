import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import { AppleSignInButton } from "./AppleSignInButton.jsx";
import { withNativeAuthFlag, externalLinkProps } from "../utils/native.js";

// Key used to persist "browse without signing in" across reloads. Sits
// alongside contour_token in localStorage. Cleared automatically once the
// user actually signs in (handled by Layout's sign-in CTAs which navigate
// away from this gate's render path).
const GUEST_MODE_KEY = "contour_guest_mode";

const ACCENT_A = "#d97a3b";
const ACCENT_B = "#6a90b5";

// Helpers exported for reuse in other components (e.g. action handlers that
// need to flip a guest user into a "sign in to continue" state).
export function isGuestMode() {
  try { return localStorage.getItem(GUEST_MODE_KEY) === "1"; } catch { return false; }
}
export function clearGuestMode() {
  try { localStorage.removeItem(GUEST_MODE_KEY); } catch {}
}

// Google "G" multicolor logo, copy-pasted from Layout for component
// independence (kept tiny — only used here and in Layout, fine to duplicate).
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

/**
 * Full-screen sign-in gate shown to first-time / signed-out visitors.
 *
 * Rendered when:
 *   - Auth state has finished loading
 *   - No user is signed in
 *   - The guest-mode flag isn't set
 *   - We're not on the /auth/success route (which is processing a token)
 *
 * Two paths out:
 *   - "Sign in" → Google or Apple OAuth (existing flows in AuthContext)
 *   - "Browse without signing in" → sets the guest flag, dismisses, and the
 *     user can then interact with read-only features. Sign-in CTAs in the
 *     Layout header / bottom nav remain functional for upgrade later.
 *
 * Lives at the App level (outside Layout) so it can paint on top of routing
 * without flashing the underlying app shell first.
 */
export function SigninGate() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [guestFlag, setGuestFlag] = useState(isGuestMode);

  // Keep guestFlag in sync with localStorage in case it gets cleared from
  // elsewhere (e.g. a "Sign in to continue" prompt on a rating action).
  useEffect(() => {
    function check() { setGuestFlag(isGuestMode()); }
    window.addEventListener("storage", check);
    window.addEventListener("contour:guest-mode-changed", check);
    return () => {
      window.removeEventListener("storage", check);
      window.removeEventListener("contour:guest-mode-changed", check);
    };
  }, []);

  const onAuthRoute = location.pathname.startsWith("/auth/");

  if (loading) return null;
  if (user) return null;
  if (guestFlag) return null;
  if (onAuthRoute) return null;

  // On native, append ?from=native so the backend redirects to contour://
  // after Google OAuth instead of the web /auth/success page — that's what
  // wakes the app up out of external Safari.
  const LOGIN_URL = withNativeAuthFlag(`${import.meta.env.VITE_API_URL ?? ""}/auth/login`);

  function continueAsGuest() {
    try { localStorage.setItem(GUEST_MODE_KEY, "1"); } catch {}
    setGuestFlag(true);
    // Notify other parts of the app that may want to react (analytics, etc.)
    try { window.dispatchEvent(new CustomEvent("contour:guest-mode-changed")); } catch {}
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: "var(--bg, #0a0a0a)",
      display: "flex", flexDirection: "column",
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>
      <div style={{
        flex: 1,
        display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "stretch",
        padding: "32px 28px",
        maxWidth: 440, width: "100%",
        margin: "0 auto",
      }}>

        {/* ── Brand block ──
            This is the one place the tagline lives. The header and onboarding
            used to repeat it; both have been stripped so it lands once and
            then the product speaks for itself. */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <h1 style={{
            fontFamily: "var(--font-display)",
            fontSize: 64, fontWeight: 400, letterSpacing: "-0.015em",
            margin: "0 0 14px",
            color: "var(--text)",
            lineHeight: 1,
          }}>
            Contour
          </h1>
          <p style={{
            fontSize: 14, color: "rgba(255,255,255,0.7)",
            margin: "0 0 10px", letterSpacing: "0.01em",
          }}>
            Rate. Review. Discover.
          </p>
          <p style={{
            fontSize: 13, color: "rgba(255,255,255,0.5)",
            margin: 0, lineHeight: 1.65, maxWidth: 320, marginInline: "auto",
          }}>
            Half-star ratings, written reviews, era-adjusted streaming charts,
            and a feed that sharpens with every track you rate.
          </p>
        </div>

        {/* ── Sign-in buttons ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <a href={LOGIN_URL} {...externalLinkProps()} style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            padding: "13px 20px", borderRadius: "var(--radius-pill)",
            background: "#fff", color: "#1f1f1f",
            fontSize: 14, fontWeight: 700, textDecoration: "none",
            border: "1px solid #dadce0",
          }}>
            <GoogleIcon size={18} />
            Sign in with Google
          </a>
          <AppleSignInButton />
        </div>

        {/* ── "or" divider ──
            Promotes the guest path to equal visual weight with the OAuth
            buttons so a casual visitor reads "browsing is a first-class
            option," not "fallback link buried under sign-in." Rating still
            requires sign-in — the footer note + per-action signed-out
            prompts elsewhere enforce that. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.12)" }} />
          <span style={{
            fontFamily: "var(--font-display)",
            fontSize: 14, color: "rgba(255,255,255,0.45)", fontStyle: "italic",
          }}>or</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.12)" }} />
        </div>

        <button
          onClick={continueAsGuest}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "13px 20px", borderRadius: "var(--radius-pill)",
            background: "transparent",
            color: "rgba(255,255,255,0.9)",
            fontSize: 14, fontWeight: 700,
            border: "1px solid rgba(255,255,255,0.25)",
            cursor: "pointer",
            width: "100%",
          }}
        >
          Browse without signing in
        </button>

        {/* ── Footer note ── */}
        <p style={{
          textAlign: "center", margin: "24px 0 0",
          fontSize: 11, color: "rgba(255,255,255,0.4)",
          lineHeight: 1.6,
        }}>
          Browse albums, charts, and reviews freely. Sign in any time to start
          rating, reviewing, and saving your taste — ratings only count when
          you're signed in.
        </p>

      </div>
    </div>
  );
}
