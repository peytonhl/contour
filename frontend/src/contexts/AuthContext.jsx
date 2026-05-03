import { createContext, useContext, useState, useEffect } from "react";
import { api } from "../services/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("contour_token");
    if (!token) { setLoading(false); return; }
    api.getMe(token)
      .then(setUser)
      .catch(() => localStorage.removeItem("contour_token"))
      .finally(() => setLoading(false));
  }, []);

  function login(token) {
    localStorage.setItem("contour_token", token);
    return api.getMe(token).then(setUser);
  }

  function logout() {
    localStorage.removeItem("contour_token");
    setUser(null);
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
