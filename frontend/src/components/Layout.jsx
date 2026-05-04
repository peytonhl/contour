import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";

// ── Inline SVG icons for the bottom tab bar ──────────────────────────────────
function SearchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 L20 20" />
    </svg>
  );
}

function CompareIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3L4 7l4 4" /><path d="M4 7h16" />
      <path d="M16 21l4-4-4-4" /><path d="M20 17H4" />
    </svg>
  );
}

function FeedIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

// ── Bottom nav tab item ───────────────────────────────────────────────────────
function BottomTab({ to, label, icon, end = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        padding: "6px 0",
        textDecoration: "none",
        color: isActive ? ACCENT_A : "var(--text-muted)",
        transition: "color 0.12s",
        minWidth: 0,
      })}
    >
      {icon}
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.02em" }}>{label}</span>
    </NavLink>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────
export function Layout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();

  const LOGIN_URL = `${import.meta.env.VITE_API_URL ?? "https://cylinder-jurist-oozy.ngrok-free.dev"}/auth/login`;

  const desktopNavLinks = [
    { to: "/", label: "Search", end: true },
    { to: "/compare", label: "Compare" },
    ...(user ? [{ to: "/feed", label: "Feed" }] : []),
    { to: "/methodology", label: "How It Works" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>

      {/* ── Top header ── */}
      <header style={{
        borderBottom: "1px solid var(--border)",
        padding: "0 16px",
        paddingTop: "env(safe-area-inset-top, 0px)",  /* iPhone Dynamic Island / notch */
        display: "flex",
        alignItems: "stretch",
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "var(--bg)",
      }}>
        {/* Logo */}
        <NavLink to="/" style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px 14px 0", textDecoration: "none", flexShrink: 0 }}>
          <span style={{
            fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em",
            background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>Contour</span>
          <span className="hide-mobile" style={{ fontSize: 12, color: "var(--text-muted)" }}>Era-adjusted music data</span>
        </NavLink>

        {/* Desktop nav links */}
        <nav className="hide-mobile" style={{ display: "flex", alignItems: "stretch", marginLeft: "auto" }}>
          {desktopNavLinks.map(({ to, label, end }) => (
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

        {/* Desktop auth */}
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
            <a href={LOGIN_URL} style={{
              padding: "6px 14px", background: "#1db954", borderRadius: 20,
              color: "#000", fontSize: 12, fontWeight: 700, textDecoration: "none",
            }}>
              Sign in with Spotify
            </a>
          )}
        </div>

        {/* Mobile: avatar only (navigation is in the bottom bar) */}
        <div className="show-mobile" style={{ display: "none", alignItems: "center", marginLeft: "auto" }}>
          {!loading && user && (
            <NavLink to="/profile" style={{ display: "flex", alignItems: "center", padding: "12px 0" }}>
              {user.image_url
                ? <img src={user.image_url} alt={user.display_name} style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                : <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--surface2)" }} />
              }
            </NavLink>
          )}
          {!loading && !user && (
            <a href={LOGIN_URL} style={{
              padding: "5px 12px", background: "#1db954", borderRadius: 20,
              color: "#000", fontSize: 11, fontWeight: 700, textDecoration: "none",
            }}>
              Sign in
            </a>
          )}
        </div>
      </header>

      {/* ── Page content (bottom padding leaves room for the mobile nav) ── */}
      <div className="page-content">
        <Outlet />
      </div>

      {/* ── Desktop footer (privacy link — required by app stores) ── */}
      <footer className="hide-mobile" style={{
        borderTop: "1px solid var(--border)", padding: "16px 24px",
        display: "flex", justifyContent: "center", gap: 24,
        fontSize: 12, color: "var(--text-muted)",
      }}>
        <span>© {new Date().getFullYear()} Contour</span>
        <Link to="/privacy" style={{ color: "var(--text-muted)" }}>Privacy Policy</Link>
        <Link to="/methodology" style={{ color: "var(--text-muted)" }}>How It Works</Link>
      </footer>

      {/* ── Mobile bottom tab bar ── */}
      <nav
        className="bottom-nav"
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "var(--bg)",
          borderTop: "1px solid var(--border)",
          zIndex: 50,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch", height: 56 }}>
          <BottomTab to="/" end label="Search" icon={<SearchIcon />} />
          <BottomTab to="/compare" label="Compare" icon={<CompareIcon />} />

          {user
            ? <BottomTab to="/feed" label="Feed" icon={<FeedIcon />} />
            : <BottomTab to="/methodology" label="About" icon={<InfoIcon />} />
          }

          {user ? (
            <NavLink
              to="/profile"
              style={({ isActive }) => ({
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 3, padding: "6px 0",
                textDecoration: "none",
                color: isActive ? ACCENT_A : "var(--text-muted)",
                transition: "color 0.12s",
              })}
            >
              {user.image_url
                ? <img src={user.image_url} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover", border: "1.5px solid var(--border)" }} />
                : <PersonIcon />
              }
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.02em" }}>Profile</span>
            </NavLink>
          ) : (
            <a
              href={LOGIN_URL}
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 3, padding: "6px 0",
                textDecoration: "none", color: "#1db954",
              }}
            >
              <PersonIcon />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.02em" }}>Sign In</span>
            </a>
          )}
        </div>
      </nav>

    </div>
  );
}
