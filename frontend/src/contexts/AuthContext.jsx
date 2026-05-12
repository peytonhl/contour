import { createContext, useContext, useState, useEffect } from "react";
import { api } from "../services/api.js";
import { analytics, identify, reset } from "../services/analytics.js";

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
    const u = await api.getMe(token);
    setUser(u);
    identify(u.id, { email: u.email });
    if (isFirstLogin(u.id)) {
      analytics.signupCompleted(provider);
    }
    return u;
  }

  function logout() {
    localStorage.removeItem("contour_token");
    setUser(null);
    reset();
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
