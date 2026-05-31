import { createContext, useContext, useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { api } from "../services/api.js";
import { analytics, identify, reset } from "../services/analytics.js";
import { usePushNotifications, unregisterCurrentDevice } from "../services/pushNotifications.js";
import { clearAllCaches } from "../utils/useCachedFetch.js";
import { replayPendingIntent } from "../services/authGate.js";

const AuthContext = createContext(null);

// PostHog person properties set on every identify (login + session restore).
// These back native PostHog cohorts/retention so we don't have to reconstruct
// segments from event counts — e.g. "users with rating_count >= 5" for the
// calibration cohort, or platform splits (web vs iOS vs Android shell).
// Point-in-time at identify, but identify runs on each app launch so they
// stay reasonably fresh. (No signup_date yet — /auth/me doesn't return
// created_at; would need a backend field to add it.)
function identifyTraits(u) {
  let platform = "web";
  try { platform = Capacitor.getPlatform(); } catch { /* non-Capacitor web */ }
  return {
    email: u.email,
    display_name: u.display_name,
    rating_count: u.rating_count ?? 0,
    is_admin: !!u.is_admin,
    platform,
  };
}

// Per-device flag: lets us distinguish a first login on this device (treated as
// signup_completed) from subsequent logins. Misclassifies "logs in on a new
// device" as a signup, which is fine for analytics purposes — we mainly care
// about acquisition source. Switching to a backend `created_at` check would be
// more precise but requires API changes.
function isFirstLogin(userId) {
  const key = `contour_known_user_${userId}`;
  const seen = localStorage.getItem(key);
  if (!seen) {
    localStorage.setItem(key, "1");
    return true;
  }
  return false;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("contour_token");
    if (!token) { setLoading(false); return; }
    api.getMe(token)
      .then((u) => {
        setUser(u);
        identify(u.id, identifyTraits(u));
      })
      .catch((err) => {
        // ONLY drop the token on a genuine 401 (Unauthorized — token
        // is actually invalid / expired). For ANY other failure (5xx
        // from a crashed backend, network timeout, CORS error
        // during a deploy window, etc.) preserve the token and just
        // leave the user signed-out-this-session. Next launch will
        // retry.
        //
        // Without this guard, a 30-second Railway outage signed every
        // active user out, silently — and since the photo + display
        // name UI render against the in-memory user object, they
        // saw their profile photo "vanish" too. The DB rows were
        // intact; just the client-side session was nuked. Reported
        // 2026-05-25 after the FastAPI-import-bug deploy window.
        //
        // err.status comes from api.getMe (status attached on throw).
        // Network errors / fetch failures have no status and fall
        // through to "preserve" by default — exactly what we want.
        if (err && err.status === 401) {
          localStorage.removeItem("contour_token");
          // Expired/invalid token → fall back to guest-by-default rather than
          // the full-screen wall (contextual-auth rework). Notify SigninGate
          // (which listens for this) so it stays dismissed without a reload.
          try {
            localStorage.setItem("contour_guest_mode", "1");
            window.dispatchEvent(new CustomEvent("contour:guest-mode-changed"));
          } catch {}
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(token, provider = "google") {
    localStorage.setItem("contour_token", token);
    // Successful auth supersedes "browse without signing in." Cleared here
    // (not in SigninGate) so any path into login — Apple popup, /auth/success
    // page from a Google redirect, or future native deep link — converges on
    // the same cleanup.
    try { localStorage.removeItem("contour_guest_mode"); } catch {}
    try { window.dispatchEvent(new CustomEvent("contour:guest-mode-changed")); } catch {}
    const u = await api.getMe(token);
    setUser(u);
    identify(u.id, identifyTraits(u));
    if (isFirstLogin(u.id)) {
      analytics.signupCompleted(provider);
    }
    // Convergence point for intent preservation: EVERY provider (Google web via
    // AuthSuccessPage, Google native via the deep-link handler, Apple via the
    // popup) lands here, so replaying the captured pending intent once here
    // means no entry point can forget to replay. No-ops when nothing is pending
    // (the returning-user "Log in" path). Headless — doesn't depend on which
    // screen we're on. AuthSuccessPage still navigates to the intent's returnTo
    // so a redirected user lands back on their task showing persisted state.
    try { await replayPendingIntent(); } catch {}
    return u;
  }

  function logout() {
    // Drop the device's push token first so the leaving user stops
    // receiving pushes on this device. Fire-and-forget — we don't block
    // sign-out on the network round-trip, and a failure here is harmless
    // (the token just stays orphaned until APNs eventually invalidates it
    // and the next 410 cleans it up server-side).
    unregisterCurrentDevice();
    localStorage.removeItem("contour_token");
    setUser(null);
    reset();
    // Drop every module-level fetch cache so the next sign-in (or the
    // sign-in gate the user lands on right now) doesn't render the
    // previous account's data.
    clearAllCaches();
    // Land on guest-by-default after logout, not the full-screen sign-in wall
    // (contextual-auth rework). The Layout "Sign In" affordance + contextual
    // prompts remain the way back in.
    try {
      localStorage.setItem("contour_guest_mode", "1");
      window.dispatchEvent(new CustomEvent("contour:guest-mode-changed"));
    } catch {}
  }

  // Hook into the push-notification lifecycle. No-ops on web; on native
  // it requests permission once per signed-in user, registers the device
  // token with the backend, and rotates correctly across account switches.
  usePushNotifications(user);

  // Re-fetch /auth/me and update the in-memory user. Used by settings flows
  // that mutate the profile (display name edit, photo change, etc.) so the
  // change is immediately reflected in header chrome / nav without a full
  // page reload. Safe to call even when not signed in — silently no-ops.
  async function refreshMe() {
    const token = localStorage.getItem("contour_token");
    if (!token) return null;
    try {
      const u = await api.getMe(token);
      setUser(u);
      return u;
    } catch {
      return null;
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
