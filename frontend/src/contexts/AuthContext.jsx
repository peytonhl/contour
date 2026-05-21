import { createContext, useContext, useState, useEffect } from "react";
import { api } from "../services/api.js";
import { analytics, identify, reset } from "../services/analytics.js";
import { usePushNotifications, unregisterCurrentDevice } from "../services/pushNotifications.js";

const AuthContext = createContext(null);

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
        identify(u.id, { email: u.email });
      })
      .catch(() => localStorage.removeItem("contour_token"))
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
    identify(u.id, { email: u.email });
    if (isFirstLogin(u.id)) {
      analytics.signupCompleted(provider);
    }
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
