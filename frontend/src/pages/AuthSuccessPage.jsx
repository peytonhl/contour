import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";

export function AuthSuccessPage() {
  const [params] = useSearchParams();
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const token = params.get("token");
    if (!token) { navigate("/"); return; }
    // Backend callbacks may pass ?provider=google|apple so analytics can attribute
    // signups by source. Older Google callbacks omit it — default keeps them working.
    const provider = params.get("provider") || "google";
    login(token, provider).then(() => navigate("/")).catch(() => navigate("/"));
  }, []);

  return (
    <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
      Signing in…
    </div>
  );
}
