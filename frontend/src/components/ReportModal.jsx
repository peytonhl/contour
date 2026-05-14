import { useEffect, useState } from "react";
import { api } from "../services/api.js";

const ACCENT = "#d97a3b";
const DANGER = "#f87171";

const REASONS = [
  { value: "spam",              label: "Spam or unwanted commercial content" },
  { value: "harassment",        label: "Harassment or bullying" },
  { value: "hate_speech",       label: "Hate speech or discrimination" },
  { value: "explicit_content",  label: "Sexually explicit content" },
  { value: "misinformation",    label: "Misinformation" },
  { value: "other",             label: "Something else" },
];

/**
 * Modal for submitting a content report. Pass `targetType` ("review" or "reply")
 * and `targetId`. Called from ReviewCard and ReplyThread via a "Report" button.
 * The backend silently dedupes repeat reports from the same user → same target.
 */
export function ReportModal({ open, onClose, targetType, targetId, onSubmitted }) {
  const [reason, setReason] = useState("spam");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setReason("spam");
      setNotes("");
      setSubmitting(false);
      setDone(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape" && open) onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.reportContent(targetType, targetId, reason, notes.trim() || null);
      setDone(true);
      onSubmitted?.();
      setTimeout(onClose, 1200);
    } catch (e) {
      setError(e.message || "Failed to submit report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300,
      }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)", padding: "22px 22px 18px",
        width: "min(420px, calc(100vw - 32px))", maxHeight: "calc(100vh - 32px)",
        overflowY: "auto", zIndex: 301,
        boxShadow: "0 16px 50px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Report this {targetType}</h3>
          <button onClick={onClose} aria-label="Close" style={{
            background: "none", border: "none", color: "var(--text-muted)",
            fontSize: 20, cursor: "pointer", padding: 0, lineHeight: 1,
          }}>×</button>
        </div>

        {done ? (
          <div style={{ padding: "16px 0", textAlign: "center", color: "var(--accent-b)", fontSize: 14 }}>
            ✓ Thanks. We'll review this shortly.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.55 }}>
              Tell us what's wrong with this content. Reports are reviewed by a
              moderator; you can also block the user to hide their content from
              your feed.
            </div>

            <fieldset style={{ border: "none", padding: 0, marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {REASONS.map((r) => (
                <label key={r.value} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: "var(--radius-md)", cursor: "pointer",
                  background: reason === r.value ? "rgba(217,122,59,0.10)" : "transparent",
                  border: `1px solid ${reason === r.value ? ACCENT : "var(--border)"}`,
                }}>
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    style={{ accentColor: ACCENT }}
                  />
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{r.label}</span>
                </label>
              ))}
            </fieldset>

            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
              Additional details (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              placeholder="Anything else a moderator should know?"
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "var(--surface2)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)", color: "var(--text)",
                padding: "8px 10px", fontSize: 13, fontFamily: "inherit",
                resize: "vertical", outline: "none", marginBottom: 14,
              }}
            />

            {error && (
              <div style={{ fontSize: 12, color: DANGER, marginBottom: 10 }}>{error}</div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onClose} disabled={submitting} style={{
                flex: 1, padding: "10px 0", borderRadius: "var(--radius-md)",
                background: "none", border: "1px solid var(--border)",
                color: "var(--text-muted)", fontSize: 13, cursor: "pointer",
              }}>Cancel</button>
              <button onClick={handleSubmit} disabled={submitting} style={{
                flex: 2, padding: "10px 0", borderRadius: "var(--radius-md)",
                background: ACCENT, border: "none", color: "#000",
                fontWeight: 700, fontSize: 13,
                cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1,
              }}>{submitting ? "Reporting…" : "Submit report"}</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
