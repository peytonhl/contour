import { NavLink, Outlet, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";

export function Layout() {
  const { user, loading, logout } = useAuth();

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <header style={{
        borderBottom: "1px solid var(--border)",
        padding: "0 24px",
        display: "flex",
        alignItems: "stretch",
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "var(--bg)",
      }}>
        <NavLink to="/" style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 24px 18px 0", marginRight: 24, textDecoration: "none" }}>
          <span style={{
            fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em",
            background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>Contour</span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Era-adjusted music streaming data</span>
        </NavLink>

        <nav style={{ display: "flex", alignItems: "stretch", marginLeft: "auto" }}>
          {[
            { to: "/", label: "Search", end: true },
            { to: "/compare", label: "Compare" },
            { to: "/methodology", label: "How It Works" },
          ].map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                padding: "0 20px",
                textDecoration: "none",
                borderBottom: isActive ? `2px solid ${ACCENT_A}` : "2px solid transparent",
                color: isActive ? "var(--text)" : "var(--text-muted)",
                fontWeight: isActive ? 600 : 400,
                fontSize: 13,
                transition: "all 0.15s",
              })}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Auth */}
        <div style={{ display: "flex", alignItems: "center", marginLeft: 12 }}>
          {loading ? null : user ? (
            <Link to="/profile" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
              {user.image_url
                ? <img src={user.image_url} alt={user.display_name} style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                : <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--surface2)" }} />
              }
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{user.display_name}</span>
            </Link>
          ) : (
            <a href={`${import.meta.env.VITE_API_URL ?? "https://cylinder-jurist-oozy.ngrok-free.dev"}/auth/login`} style={{
              padding: "6px 14px", background: "#1db954", borderRadius: 20,
              color: "#000", fontSize: 12, fontWeight: 700, textDecoration: "none",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              Sign in with Spotify
            </a>
          )}
        </div>
      </header>

      <Outlet />
    </div>
  );
}
