import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { logSilentError } from "../utils/observability.js";
import { ACCENT_A as ACCENT, ACCENT_B as GREEN, DANGER } from "../theme.js";

const REASON_LABEL = {
  spam: "Spam",
  harassment: "Harassment",
  hate_speech: "Hate speech",
  explicit_content: "Explicit content",
  misinformation: "Misinformation",
  other: "Other",
};

const TAB_STATUS = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
  { key: "dismissed", label: "Dismissed" },
];

export function AdminReportsPage() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState("open");
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState({}); // {report_id: bool}

  useEffect(() => {
    if (!user?.is_admin) return;
    setLoading(true);
    api.adminListReports(tab).then(setReports).catch(() => setReports([])).finally(() => setLoading(false));
  }, [tab, user?.is_admin]);

  async function resolve(report, status, deleteContent) {
    setWorking((w) => ({ ...w, [report.id]: true }));
    try {
      await api.adminResolveReport(report.id, status, deleteContent);
      setReports((rs) => rs.filter((r) => r.id !== report.id));
    } catch (e) {
      // Admin actions failing silently is bad — they're moderation. Surface
      // the failure to the admin AND log to analytics so we can see patterns.
      logSilentError("admin_resolve_report", e, { report_id: report.id, status });
      alert(`Failed to resolve report: ${e?.message ?? "Unknown error"}`);
    }
    setWorking((w) => ({ ...w, [report.id]: false }));
  }

  if (authLoading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (!user) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Sign in required.</div>;
  if (!user.is_admin) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
        Admin access required.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px 60px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 6 }}>Moderation queue</h1>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18 }}>
        Reports from users flagging reviews or replies as objectionable.
      </p>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid var(--border)" }}>
        {TAB_STATUS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "8px 16px", fontSize: 13, fontWeight: active ? 700 : 500,
                background: "none", border: "none",
                color: active ? "var(--text)" : "var(--text-muted)",
                borderBottom: active ? `2px solid ${ACCENT}` : "2px solid transparent",
                cursor: "pointer", marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
      ) : reports.length === 0 ? (
        <div style={{
          padding: "40px 20px", textAlign: "center", color: "var(--text-muted)",
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
        }}>
          No reports in this tab.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {reports.map((r) => (
            <div key={r.id} style={{
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
              padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10,
            }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                  padding: "3px 8px", borderRadius: "var(--radius-sm)",
                  background: r.target_type === "review" ? "rgba(217,122,59,0.18)" : "rgba(106,144,181,0.18)",
                  color: r.target_type === "review" ? ACCENT : GREEN,
                }}>
                  {r.target_type}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                  padding: "3px 8px", borderRadius: "var(--radius-sm)",
                  background: "rgba(248,113,113,0.15)", color: DANGER,
                }}>
                  {REASON_LABEL[r.reason] || r.reason}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>
                  Content
                </div>
                {r.target_exists ? (
                  <div style={{
                    background: "var(--surface2)", borderRadius: "var(--radius-md)", padding: "10px 12px",
                    fontSize: 13, color: "var(--text)", lineHeight: 1.55,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {r.target_body || <em style={{ color: "var(--text-muted)" }}>(empty)</em>}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
                    Content already deleted.
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
                <span>
                  Author:{" "}
                  {r.target_author
                    ? <Link to={`/user/${r.target_author.id}`} style={{ color: ACCENT }}>{r.target_author.display_name}</Link>
                    : <em>unknown</em>}
                </span>
                <span>
                  Reported by:{" "}
                  {r.reporter
                    ? <Link to={`/user/${r.reporter.id}`} style={{ color: ACCENT }}>{r.reporter.display_name}</Link>
                    : <em>unknown</em>}
                </span>
              </div>

              {r.notes && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                  "{r.notes}"
                </div>
              )}

              {tab === "open" && (
                <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                  <button
                    onClick={() => resolve(r, "resolved", true)}
                    disabled={working[r.id] || !r.target_exists}
                    style={{
                      padding: "7px 14px", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 700,
                      background: DANGER, color: "#000", border: "none",
                      cursor: working[r.id] ? "default" : "pointer",
                      opacity: r.target_exists ? 1 : 0.4,
                    }}
                  >
                    Delete content + resolve
                  </button>
                  <button
                    onClick={() => resolve(r, "resolved", false)}
                    disabled={working[r.id]}
                    style={{
                      padding: "7px 14px", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 600,
                      background: "var(--surface2)", color: "var(--text)",
                      border: "1px solid var(--border)", cursor: working[r.id] ? "default" : "pointer",
                    }}
                  >
                    Keep content, resolve
                  </button>
                  <button
                    onClick={() => resolve(r, "dismissed", false)}
                    disabled={working[r.id]}
                    style={{
                      padding: "7px 14px", borderRadius: "var(--radius-sm)", fontSize: 12,
                      background: "none", color: "var(--text-muted)",
                      border: "1px solid var(--border)", cursor: working[r.id] ? "default" : "pointer",
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
