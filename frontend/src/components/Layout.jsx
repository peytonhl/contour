import { useState } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";

export function Layout() {
  const { user, loading, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = [
    { to: "/", label: "Search", end: true },
    { to: "/compare", label: "Compare" },
    ...(user ? [{ to: "/feed", label: "Feed" }] : []),
    { to: "/methodology", label: "How It Works" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <header style={{
        borderBottom: "1px solid var(--border)",
        padding: "0 16px",
        display: "flex",
        alignItems: "stretch",
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "var(--bg)",
      }}>
        {/* Logo */}
        <NavLink to="/" style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 16px 0", textDecoration: "none", flexShrink: 0 }}>
          <span style={{
            fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em",
            background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>Contour</span>
          <span className="hide-mobile" style={{ fontSize: 12, color: "var(--text-muted)" }}>Era-adjusted music data</span>
        </NavLink>

        {/* Desktop nav */}
        <nav className="hide-mobile" style={{ display: "flex", alignItems: "stretch", marginLeft: "auto" }}>
          {navLinks.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              style={({ isActive }) => ({
                display: "flex", alignItems: "center",
                padding: "0 16px", textDecoration: "none",
                borderBottom: isActive ? `2px solid ${ACCENT_A}` : "2px solid transparent",
                color: isActive ? "var(--text)" : "var(--text-muted)",
                fontWeight: isActive ? 600 : 400,
                fontSize: 13, transition: "all 0.15s",
              })}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Auth — desktop */}
        <div className="hide-mobile" style={{ display: "flex", alignItems: "center", marginLeft: 12 }}>
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
            }}>
              Sign in with Spotify
            </a>
          )}
        </div>

        {/* Mobile right side */}
        <div className="show-mobile" style={{ display: "none", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          {!loading && user && (
            <Link to="/profile">
              {user.image_url
                ? <img src={user.image_url} alt={user.display_name} style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                : <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--surface2)" }} />
              }
            </Link>
          )}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            style={{ background: "none", border: "none", color: "var(--text)", fontSize: 22, padding: "4px 0", lineHeight: 1, cursor: "pointer" }}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </header>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="show-mobile" style={{
          position: "fixed", top: 57, left: 0, right: 0, bottom: 0,
          background: "var(--bg)", zIndex: 49, padding: "8px 0",
          borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column",
        }}>
          {navLinks.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMenuOpen(false)}
              style={({ isActive }) => ({
                padding: "16px 24px", fontSize: 16, fontWeight: isActive ? 700 : 400,
                color: isActive ? "var(--text)" : "var(--text-muted)",
                textDecoration: "none", borderBottom: "1px solid var(--border)",
              })}
            >
              {label}
            </NavLink>
          ))}
          {!loading && !user && (
            <a
              href={`${import.meta.env.VITE_API_URL ?? "https://cylinder-jurist-oozy.ngrok-free.dev"}/auth/login`}
              style={{ margin: 24, padding: "12px", background: "#1db954", borderRadius: 20, color: "#000", fontSize: 14, fontWeight: 700, textDecoration: "none", textAlign: "center" }}
            >
              Sign in with Spotify
            </a>
          )}
        </div>
      )}

      <Outlet />
    </div>
  );
}
