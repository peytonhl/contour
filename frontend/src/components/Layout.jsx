import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { api } from "../services/api.js";
import { userAvatar } from "../utils/userAvatar.js";
import { AppleSignInButton } from "./AppleSignInButton.jsx";
import { withNativeAuthFlag, externalLinkProps } from "../utils/native.js";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";

// ── Google "G" logo (official multicolor) ────────────────────────────────────
function GoogleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}

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

function CommunityIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
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
        // 44px is the iOS HIG minimum touch target. The 56px nav bar provides
        // headroom but min-height makes the contract explicit per tab.
        minHeight: 44,
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
  const [unread, setUnread] = useState(0);
  const headerRef = useRef(null);

  // On native, append ?from=native so the OAuth callback redirects via the
  // contour:// URL scheme — that's what wakes the iOS / Android app out of
  // external Safari after sign-in. No-op in the browser. See utils/native.js.
  const LOGIN_URL = withNativeAuthFlag(`${import.meta.env.VITE_API_URL ?? ""}/auth/login`);

  // Publish the header's measured height to CSS so descendants can position
  // sticky elements right beneath it. Header height varies with safe-area
  // insets (iOS notch, dynamic island) and with whether the desktop nav row
  // wraps on narrow viewports, so a hard-coded offset gets it wrong on the
  // edges. ResizeObserver keeps the variable accurate through orientation
  // changes and address-bar collapse on mobile.
  useEffect(() => {
    if (!headerRef.current) return;
    const el = headerRef.current;
    const update = () => {
      const h = el.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--layout-header-h", `${Math.round(h)}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  // Poll unread notification count every 60s when logged in
  useEffect(() => {
    if (!user) { setUnread(0); return; }
    const fetchCount = () => api.getUnreadCount().then((r) => setUnread(r.count ?? 0)).catch(() => {});
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => clearInterval(interval);
  }, [user]);

  // Primary nav: For You is the home (audio swipe, Friends timeline, and
  // Community reviews all live there as tabs). /feed was retired.
  // "How It Works" was moved to the profile settings menu — keeps the top
  // nav focused on primary navigation and not explainer content.
  const desktopNavLinks = [
    { to: "/", label: "For You", end: true },
    { to: "/search", label: "Search" },
    { to: "/compare", label: "Compare" },
    { to: "/charts", label: "Charts" },
    ...(user?.is_admin ? [{ to: "/admin/reports", label: "Admin" }] : []),
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>

      {/* ── Top header ──
          Sticky on desktop (top nav is useful at all scroll positions).
          On mobile a CSS override in index.css (.app-header media query)
          flips this to position: static so the header scrolls away — the
          Contour wordmark + bell + avatar aren't worth the vertical real
          estate to keep pinned on a phone-sized viewport. Inner For You
          sub-tab strip becomes the sole pinned strip on mobile via its
          own CSS override (.foryou-tabs-strip top: 0). */}
      <header ref={headerRef} className="app-header" style={{
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
          <span className="hide-mobile" style={{ fontSize: 12, color: "var(--text-muted)" }}>Rate. Review. Discover.</span>
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
        <div className="hide-mobile" style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 12 }}>
          {user && (
            <Link to="/notifications" onClick={() => setUnread(0)} style={{ position: "relative", display: "flex", alignItems: "center", padding: "8px 10px", color: "var(--text-muted)", textDecoration: "none" }}>
              <BellIcon />
              {unread > 0 && (
                <span style={{
                  position: "absolute", top: 4, right: 4,
                  minWidth: 16, height: 16, borderRadius: 8,
                  background: ACCENT_A, color: "#000",
                  fontSize: 10, fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "0 4px",
                }}>
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          )}
          {loading ? null : user ? (
            <Link to="/profile" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
              <img src={userAvatar(user, 56)} alt={user.display_name} style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{user.display_name}</span>
            </Link>
          ) : (
            <>
              <a href={LOGIN_URL} {...externalLinkProps()} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 14px", background: "#fff", borderRadius: 20,
                color: "#3c3c3c", fontSize: 12, fontWeight: 600, textDecoration: "none",
                border: "1px solid #dadce0",
              }}>
                <GoogleIcon size={16} />
                Sign in with Google
              </a>
              <AppleSignInButton />
            </>
          )}
        </div>

        {/* Mobile: avatar only (navigation is in the bottom bar) */}
        <div className="show-mobile" style={{ display: "none", alignItems: "center", gap: 4, marginLeft: "auto" }}>
          {!loading && user && (
            <Link to="/notifications" onClick={() => setUnread(0)} style={{ position: "relative", display: "flex", alignItems: "center", padding: "12px 8px", color: "var(--text-muted)", textDecoration: "none" }}>
              <BellIcon />
              {unread > 0 && (
                <span style={{
                  position: "absolute", top: 6, right: 2,
                  minWidth: 15, height: 15, borderRadius: 8,
                  background: ACCENT_A, color: "#000",
                  fontSize: 9, fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "0 3px",
                }}>
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          )}
          {/* Mobile avatar removed: /profile is already a primary bottom-nav
              destination, and the header copy was a non-functional dupe. The
              bell stays — /notifications is a distinct surface. */}
          {!loading && !user && (
            <>
              <a href={LOGIN_URL} {...externalLinkProps()} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 10px", background: "#fff", borderRadius: 20,
                color: "#3c3c3c", fontSize: 11, fontWeight: 600, textDecoration: "none",
                border: "1px solid #dadce0",
              }}>
                <GoogleIcon size={13} />
                Sign in
              </a>
              <AppleSignInButton size="small" />
            </>
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
        <span>Made by Peyton Lindogan</span>
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
          {/* For You first — it's the home. Discover / Friends / Community
              live as sub-tabs inside it.
              Compare consolidated into Search page (light integration —
              "Compare two albums" affordance near the search bar) so
              mobile nav stays at 3 tabs and Compare gains discoverability
              through the conceptually-adjacent Search surface. /compare
              still works as a direct URL. Charts reachable via desktop
              top nav + direct URL (lower frequency-of-use). */}
          <BottomTab to="/" end label="For You" icon={<FeedIcon />} />
          <BottomTab to="/search" label="Search" icon={<SearchIcon />} />

          {user ? (
            <NavLink
              to="/profile"
              style={({ isActive }) => ({
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 3, minHeight: 44, padding: "6px 0",
                textDecoration: "none",
                color: isActive ? ACCENT_A : "var(--text-muted)",
                transition: "color 0.12s",
              })}
            >
              <img src={userAvatar(user, 48)} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover", border: "1.5px solid var(--border)" }} />
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.02em" }}>Profile</span>
            </NavLink>
          ) : (
            <a
              href={LOGIN_URL}
              {...externalLinkProps()}
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 3, minHeight: 44, padding: "6px 0",
                textDecoration: "none", color: "var(--text-muted)",
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
