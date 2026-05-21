import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import { api } from "../services/api.js";

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

// Switch-style row for boolean preferences. Optimistic update — UI flips
// immediately; the parent's save() is fire-and-forget and a failure
// reverts the toggle (set state from a rollback in the caller). Used by
// the notification preferences section.
function RowToggle({ title, description, checked, onToggle, isLast, disabled }) {
  return (
    <div style={{ ...rowStyle(isLast), cursor: disabled ? "default" : "pointer" }}
         onClick={() => !disabled && onToggle(!checked)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        {description && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{description}</span>
        )}
      </div>
      <div
        aria-checked={checked}
        role="switch"
        style={{
          width: 38, height: 22, flexShrink: 0,
          borderRadius: 11,
          background: checked ? ACCENT_A : "var(--surface2)",
          border: `1px solid ${checked ? ACCENT_A : "var(--border)"}`,
          position: "relative",
          transition: "background 0.18s, border-color 0.18s",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <div style={{
          position: "absolute",
          top: 1, left: checked ? 17 : 1,
          width: 18, height: 18, borderRadius: "50%",
          background: "#fff",
          transition: "left 0.18s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }} />
      </div>
    </div>
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

// Inline editable text row. Click "Edit" → row swaps to an input + Save /
// Cancel pair. Validation + uniqueness errors come back from the server
// (the backend regex + 409 path) and surface as a short error string below
// the input. Designed to be reusable for any single-string profile field,
// but currently only the display name uses it.
function RowEditable({ title, value, placeholder, helper, save, isLast }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function open() {
    setDraft(value ?? "");
    setError("");
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setError("");
  }
  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) {
      // No change — just exit edit mode without hitting the server.
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await save(trimmed);
      setEditing(false);
    } catch (e) {
      // Backend returns 400 (bad format) or 409 (taken) with a `detail`
      // message; api.js re-throws that as the Error message.
      setError(e?.message || "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div style={{ ...rowStyle(isLast), cursor: "default" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          <span style={{
            fontSize: 13, color: "var(--text-muted)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {value || placeholder || "—"}
          </span>
        </div>
        <button
          onClick={open}
          style={{
            fontSize: 12, fontWeight: 600,
            color: ACCENT_A, background: "transparent",
            border: "none", cursor: "pointer", padding: "4px 8px",
            flexShrink: 0,
          }}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div style={{
      ...rowStyle(isLast),
      cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={cancel}
            disabled={saving}
            style={{
              fontSize: 12, fontWeight: 600,
              color: "var(--text-muted)", background: "transparent",
              border: "none", cursor: saving ? "default" : "pointer", padding: "4px 8px",
            }}
          >
            Cancel
          </button>
          <button
            onClick={commit}
            disabled={saving}
            style={{
              fontSize: 12, fontWeight: 700,
              color: ACCENT_A, background: "transparent",
              border: "none", cursor: saving ? "default" : "pointer", padding: "4px 8px",
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        autoFocus
        maxLength={30}
        style={{
          fontSize: 14, padding: "8px 10px",
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          color: "var(--text)",
          width: "100%", boxSizing: "border-box",
          outline: "none",
        }}
      />
      {helper && !error && (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{helper}</span>
      )}
      {error && (
        <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const { user, logout, refreshMe } = useAuth();
  const navigate = useNavigate();

  // Server is the source of truth — after a successful PATCH the auth
  // context re-fetches /auth/me, which updates the user object and any
  // chrome (nav header, profile chip) that reads from it.
  async function saveDisplayName(name) {
    await api.updateDisplayName(name);
    await refreshMe();
  }

  // ── Notification preferences ─────────────────────────────────────────
  // Loaded on mount, optimistic on toggle. A failed save (network /
  // 4xx) rolls the toggle back so the UI doesn't lie about server state.
  // null = haven't loaded yet (suppress the section while in-flight).
  const [prefs, setPrefs] = useState(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.getNotificationPrefs()
      .then((p) => { if (!cancelled) setPrefs(p); })
      .catch(() => { if (!cancelled) setPrefs({ follow: true, upvote: true, reply: true, mention: true }); });
    return () => { cancelled = true; };
  }, [user?.id]);

  async function togglePref(key, value) {
    if (!prefs) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      await api.updateNotificationPrefs({ [key]: value });
    } catch {
      // Roll back on failure so the UI matches whatever the server
      // actually has stored.
      setPrefs(prefs);
    }
  }

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
        {/* Display name is editable — visible name on reviews / profile /
            @-mentions. "Signed in as" stays pinned to the email so users
            can tell which Google/Apple identity is logged in regardless
            of what they've renamed themselves to. */}
        <RowEditable
          title="Display name"
          value={user.display_name}
          placeholder="Your name"
          helper="2–30 characters. Letters, numbers, spaces, and _ . - allowed."
          save={saveDisplayName}
        />
        {user.email && <RowStatic title="Signed in as" value={user.email} />}
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

      {/* Push notifications: opt-out per type. Apple-style toggles. On
          web this only controls server-side gating — the actual delivery
          is iOS / Android. We still show it on web so a desktop user
          can pre-configure before opening the app, and so the toggles
          are visible to anyone curious about what we send.

          Hidden entirely while we're still loading prefs so the user
          doesn't see a flash of all-off (the default value while
          state=null) and panic. */}
      {prefs && (
        <Section label="Push notifications">
          <RowToggle
            title="Followers"
            description="When someone starts following you"
            checked={prefs.follow !== false}
            onToggle={(v) => togglePref("follow", v)}
          />
          <RowToggle
            title="Upvotes"
            description="When someone upvotes your review"
            checked={prefs.upvote !== false}
            onToggle={(v) => togglePref("upvote", v)}
          />
          <RowToggle
            title="Replies"
            description="When someone replies to your review"
            checked={prefs.reply !== false}
            onToggle={(v) => togglePref("reply", v)}
          />
          <RowToggle
            title="Mentions"
            description="When someone @-mentions you in a review or reply"
            checked={prefs.mention !== false}
            onToggle={(v) => togglePref("mention", v)}
            isLast
          />
        </Section>
      )}

      <Section label="Content">
        <RowLink to="/import" title="Import ratings" description="Bring your ratings over from RYM" />
        <RowLink to="/disliked-artists" title="Disliked artists" description="Artists hidden from your For You feed" />
        <RowLink to="/blocks" title="Blocked users" description="Users whose content is hidden from you" isLast />
      </Section>

      <Section label="Algorithm">
        <RowLink
          to="/settings/taste-profile"
          title="How the algorithm sees you"
          description="See the signals driving your feed + reset or try a fresh feed"
          isLast
        />
      </Section>

      <Section label="About">
        <RowLink to="/methodology" title="How it works" description="Era-adjusted streaming, charts methodology, and more" />
        <RowLink to="/privacy" title="Privacy policy" />
        <RowLink to="/terms" title="Terms of service" isLast />
      </Section>

    </div>
  );
}
