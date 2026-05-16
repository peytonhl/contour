import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT_A = "#d97a3b";

// ── Reusable row primitives ──────────────────────────────────────────────────
// Two flavors of row: a Link row (for navigating to another page) and a
// button row (for in-page actions like "show tutorial again" or sign out).
// Both share the same visual layout — a label on the left, optional
// description below it, and a trailing chevron / accent on the right.

function SectionLabel({ children }) {
  return (
    <h2 style={{
      fontSize: 11, fontWeight: 700, letterSpacing: "0.07em",
      textTransform: "uppercase", color: "var(--text-muted)",
      margin: "0 0 8px",
    }}>
      {children}
    </h2>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <SectionLabel>{label}</SectionLabel>
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
      }}>
        {children}
      </div>
    </div>
  );
}

function rowStyle(isLast = false) {
  return {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 12, padding: "14px 16px",
    borderBottom: isLast ? "none" : "1px solid var(--border)",
    color: "var(--text)", textDecoration: "none",
    background: "transparent",
    transition: "background 0.12s",
    cursor: "pointer",
    width: "100%",
    boxSizing: "border-box",
    textAlign: "left",
  };
}

function RowLink({ to, title, description, isLast }) {
  return (
    <Link
      to={to}
      style={rowStyle(isLast)}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        {description && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{description}</span>
        )}
      </div>
      <span style={{ fontSize: 16, color: "var(--text-muted)", flexShrink: 0 }}>›</span>
    </Link>
  );
}

function RowButton({ onClick, title, description, isLast, danger = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...rowStyle(isLast),
        border: "none",
        font: "inherit",
        color: danger ? "var(--danger)" : "var(--text)",
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface2)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        {description && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{description}</span>
        )}
      </div>
    </button>
  );
}

function RowStatic({ title, value, isLast }) {
  return (
    <div style={{ ...rowStyle(isLast), cursor: "default" }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{value}</span>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function replayOnboarding() {
    // Same event the old profile-page settings popover dispatched. Listened
    // for inside OnboardingModal — opens at step 0 without a reload.
    window.dispatchEvent(new CustomEvent("contour:replay-onboarding"));
    navigate("/");
  }

  // Signed-out users get a bare-bones About-only view so deep-linked
  // /settings still loads usefully rather than rendering empty sections.
  if (!user) {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 20px 60px", display: "flex", flexDirection: "column", gap: 24 }}>
        <h1 style={{
          fontFamily: "var(--font-display)",
          fontSize: 32, fontWeight: 400,
          color: "var(--text)", margin: 0,
        }}>
          Settings
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>
          Sign in to manage your account preferences.
        </p>
        <Section label="About">
          <RowLink to="/methodology" title="How it works" description="Era-adjusted streaming, charts methodology, and more" />
          <RowLink to="/privacy" title="Privacy policy" />
          <RowLink to="/terms" title="Terms of service" isLast />
        </Section>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 20px 60px", display: "flex", flexDirection: "column", gap: 24 }}>

      <h1 style={{
        fontFamily: "var(--font-display)",
        fontSize: 32, fontWeight: 400,
        color: "var(--text)", margin: 0,
      }}>
        Settings
      </h1>

      <Section label="Account">
        <RowStatic title="Signed in as" value={user.email || user.display_name} />
        <RowButton title="Sign out" onClick={logout} danger isLast />
      </Section>

      <Section label="Preferences">
        <RowButton
          title="Show tutorial again"
          description="Re-opens the welcome flow"
          onClick={replayOnboarding}
          isLast
        />
      </Section>

      <Section label="Content">
        <RowLink to="/import" title="Import ratings" description="Bring your ratings over from RYM" />
        <RowLink to="/disliked-artists" title="Disliked artists" description="Artists hidden from your For You feed" />
        <RowLink to="/blocks" title="Blocked users" description="Users whose content is hidden from you" isLast />
      </Section>

      <Section label="About">
        <RowLink to="/methodology" title="How it works" description="Era-adjusted streaming, charts methodology, and more" />
        <RowLink to="/privacy" title="Privacy policy" />
        <RowLink to="/terms" title="Terms of service" isLast />
      </Section>

    </div>
  );
}
