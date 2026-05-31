import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import { peekPendingIntent } from "../services/pendingIntent.js";

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
    // Read the destination BEFORE login() — login() replays + CONSUMES the
    // pending intent, so we capture returnTo first. Intent preservation: after
    // a Google full-page redirect we land the user back on the exact screen
    // they were on (their action already replayed inside login), not a generic
    // home feed.
    const returnTo = peekPendingIntent()?.returnTo || "/";
    login(token, provider)
      .then(() => navigate(returnTo))
      .catch(() => navigate("/"));
  }, []);

  return (
    <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
      Signing in…
    </div>
  );
}
