import { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT_A = "#d97a3b";
const ACCENT_B = "#6a90b5";

/**
 * RYM CSV import page.
 *
 * Designed so AOTY (or any other source) can be added as a second tab once
 * the format is documented — the inner upload + results UI is source-agnostic
 * via the `source` state.
 */
export function ImportPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [source, setSource] = useState("rym");
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  if (loading) return <div style={{ padding: 80, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (!user) {
    return (
      <div style={{ padding: 80, textAlign: "center", color: "var(--text-muted)" }}>
        Sign in to import ratings.
        <div style={{ marginTop: 16 }}>
          <Link to="/" style={{ color: ACCENT_A }}>Return home</Link>
        </div>
      </div>
    );
  }

  async function handleSubmit() {
    if (!file || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const data = await api.importRymCsv(file);
      setResult(data);
      analytics.importCompleted("rym", data.matched_count ?? 0, data.unmatched_count ?? 0);
    } catch (e) {
      setError(e.message ?? "Import failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 20px 80px" }}>

      <h1 style={{
        fontSize: 38, fontWeight: 400, margin: "0 0 6px",
        color: "var(--text)",
      }}>
        Import ratings
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 24px", lineHeight: 1.6 }}>
        Bring your album ratings from another platform. We match each row to an
        album on Spotify, then write the rating to your Contour profile.
      </p>

      {/* Source tabs — RYM is the only option in v1; the tab strip is here so
          AOTY can drop in once its export format is documented. */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 24 }}>
        <button
          onClick={() => setSource("rym")}
          style={{
            padding: "10px 18px",
            borderBottom: source === "rym" ? `2px solid ${ACCENT_A}` : "2px solid transparent",
            background: "none", border: "none",
            color: source === "rym" ? "var(--text)" : "var(--text-muted)",
            fontWeight: source === "rym" ? 700 : 500,
            fontSize: 13, cursor: "pointer", marginBottom: -1,
          }}
        >
          Rate Your Music
        </button>
        <button
          disabled
          title="Coming soon"
          style={{
            padding: "10px 18px",
            borderBottom: "2px solid transparent",
            background: "none", border: "none",
            color: "var(--border)", fontSize: 13, cursor: "not-allowed",
            marginBottom: -1,
          }}
        >
          Album of the Year (coming soon)
        </button>
      </div>

      {source === "rym" && !result && (
        <>
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "16px 18px", marginBottom: 18,
            fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6,
          }}>
            <strong style={{ color: "var(--text)" }}>How to export from RYM:</strong>
            <ol style={{ margin: "6px 0 0 18px", padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <li>Sign in at rateyourmusic.com</li>
              <li>Go to <em>Account &rarr; Export your data</em></li>
              <li>Download the CSV and upload it here</li>
            </ol>
            <p style={{ margin: "10px 0 0" }}>
              Only rated rows are imported. Reviews come along if present. Max
              5&nbsp;MB per file; you can rerun the import any time.
            </p>
          </div>

          {/* Drop zone */}
          <label style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            padding: "32px 16px", borderRadius: 12,
            border: `2px dashed ${file ? ACCENT_A : "var(--border)"}`,
            background: file ? `${ACCENT_A}08` : "var(--surface)",
            cursor: "pointer", transition: "all 0.15s",
            textAlign: "center",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={file ? ACCENT_A : "var(--text-muted)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span style={{ fontSize: 14, fontWeight: 600, color: file ? "var(--text)" : "var(--text-muted)" }}>
              {file ? file.name : "Choose a CSV file"}
            </span>
            {file && (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {(file.size / 1024).toFixed(1)} KB · ready to import
              </span>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(""); }}
            />
          </label>

          {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{error}</p>}

          <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
            <Link
              to="/profile"
              style={{
                padding: "10px 18px", borderRadius: 8,
                border: "1px solid var(--border)", color: "var(--text-muted)",
                fontSize: 13, textDecoration: "none",
              }}
            >
              Cancel
            </Link>
            <button
              onClick={handleSubmit}
              disabled={!file || submitting}
              style={{
                padding: "10px 22px", borderRadius: 8,
                background: !file ? "var(--surface2)" : `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                color: !file ? "var(--text-muted)" : "#000",
                fontSize: 13, fontWeight: 700, border: "none",
                cursor: !file || submitting ? "default" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Importing…" : "Import ratings"}
            </button>
          </div>
        </>
      )}

      {result && (
        <div>
          <div style={{
            background: `${ACCENT_B}12`, border: `1px solid ${ACCENT_B}40`,
            borderRadius: 10, padding: "16px 18px", marginBottom: 20,
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: ACCENT_B, marginBottom: 4 }}>
              Imported {result.matched_count} album{result.matched_count === 1 ? "" : "s"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {result.unmatched_count > 0
                ? `${result.unmatched_count} row${result.unmatched_count === 1 ? "" : "s"} couldn't be matched on Spotify.`
                : "Every rated row was matched."}
            </div>
          </div>

          {result.unmatched_count > 0 && result.unmatched?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 8px" }}>
                Not matched
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto", padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
                {result.unmatched.map((u, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    <span style={{ color: "var(--text)" }}>{u.title}</span> · {u.artist}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "8px 0 0" }}>
                Most unmatched rows are albums Spotify doesn't carry, or different
                editions. You can rate them manually by searching on Contour.
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={() => { setResult(null); setFile(null); if (inputRef.current) inputRef.current.value = ""; }}
              style={{
                padding: "10px 18px", borderRadius: 8,
                border: "1px solid var(--border)", background: "none",
                color: "var(--text-muted)", fontSize: 13, cursor: "pointer",
              }}
            >
              Import another file
            </button>
            <button
              onClick={() => navigate("/profile")}
              style={{
                padding: "10px 22px", borderRadius: 8,
                background: ACCENT_A,
                color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
              }}
            >
              See your profile
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
