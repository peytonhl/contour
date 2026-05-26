import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { ACCENT_A, ACCENT_B, GOLD, DANGER } from "../theme.js";
import { ROUTES } from "../constants/routes.js";

// ── Page-level building blocks (mirror SettingsPage's primitives) ────────────
function SectionLabel({ children }) {
  return (
    <h2 style={{
      fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 400,
      color: "var(--text)", margin: "0 0 8px",
    }}>{children}</h2>
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
        padding: "14px 16px",
      }}>{children}</div>
    </div>
  );
}

function KV({ label, value, hint }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      gap: 16, padding: "6px 0",
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ fontSize: 13, color: "var(--text)", textAlign: "right", flexShrink: 0 }}>
        {value}
      </div>
    </div>
  );
}

function Chip({ children, color = ACCENT_A, dim = false }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 9px",
      fontSize: 11, fontWeight: 700,
      borderRadius: "var(--radius-xl)",
      border: `1px solid ${color}${dim ? "30" : "55"}`,
      background: `${color}${dim ? "10" : "1f"}`,
      color: color,
      letterSpacing: "0.01em",
    }}>{children}</span>
  );
}

// ── Mode explainer — translates inferred_mode into user-facing English ───────
function ModeExplainer({ inferredMode, yearRange, decadePref }) {
  const isVintage = inferredMode?.startsWith("vintage");
  const isGenreLocked = inferredMode?.startsWith("genre-locked");

  let summary = "Cold-start. Your feed pulls from popular charts while you build a profile.";
  if (isVintage) {
    const topDecade = decadePref && Object.entries(decadePref).sort((a, b) => b[1] - a[1])[0];
    const pct = topDecade ? Math.round(topDecade[1] * 100) : null;
    summary = `Vintage mode (${yearRange}). ${pct ?? ""}% of your high ratings are from one decade, so the feed is locked to that era's catalog.`;
  } else if (isGenreLocked) {
    summary = "Genre-locked. Your feed is drawn from your preferred genres only, not mainstream charts.";
  }
  return (
    <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.55 }}>{summary}</p>
  );
}

// ── Reset confirmation dialog ────────────────────────────────────────────────
function ResetConfirmDialog({ onConfirm, onCancel, fields, busy }) {
  const labels = {
    genres: "Liked genres",
    excluded_genres: "Excluded genres",
    liked_artist_ids: "Liked artist seed list",
    disliked_artist_ids: "Disliked artists ('Not interested')",
    down_weighted_artist_ids: "Down-weighted artists (from 1–2★ ratings)",
  };
  const toReset = Object.keys(fields).filter(k => fields[k]);
  return (
    <>
      <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300 }} />
      <div style={{
        position: "fixed", inset: 0, zIndex: 301,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, pointerEvents: "none",
      }}>
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          maxWidth: 420, width: "100%",
          padding: 22, pointerEvents: "all",
        }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 800 }}>
            Reset these parts of your profile?
          </h3>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Your underlying ratings stay intact — only the per-user state
            that directly drives feed personalization gets wiped.
          </p>
          <ul style={{ margin: "0 0 16px", padding: "0 0 0 18px", fontSize: 13, color: "var(--text)" }}>
            {toReset.map(k => <li key={k} style={{ marginBottom: 4 }}>{labels[k]}</li>)}
          </ul>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onCancel} disabled={busy} style={{
              padding: "8px 16px", borderRadius: "var(--radius-xl)",
              background: "transparent", border: "1px solid var(--border)",
              color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>Cancel</button>
            <button onClick={onConfirm} disabled={busy} style={{
              padding: "8px 18px", borderRadius: "var(--radius-xl)",
              background: DANGER, border: "none",
              color: "#000", fontSize: 13, fontWeight: 800, cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}>{busy ? "Resetting…" : "Reset"}</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export function TasteProfilePage() {
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmReset, setConfirmReset] = useState(null);  // {fields} or null
  const [resetBusy, setResetBusy] = useState(false);

  function load() {
    setLoading(true);
    api.getMyDiscoverState()
      .then(d => { setState(d); setError(null); })
      .catch(e => setError(e.message || "Failed to load profile state"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function doReset(fields) {
    setResetBusy(true);
    try {
      await api.resetTasteProfile(fields);
      setConfirmReset(null);
      // Reload state to show the effect
      load();
    } catch (e) {
      setError(e.message || "Reset failed");
    } finally {
      setResetBusy(false);
    }
  }

  function tryFreshFeed() {
    // The discover page reads a localStorage flag for a one-session
    // fresh-feed bypass. We also set a URL param so the ForYouPage's
    // fetchBatch can read it. Navigates to / and the page picks it up.
    try { localStorage.setItem("contour_fresh_feed_once", "1"); } catch {}
    navigate("/");  // home — intentionally not centralized; see routes.js
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 20px", color: "var(--text-muted)" }}>
        Loading your profile…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 20px" }}>
        <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>
        <button onClick={load} style={{
          marginTop: 12, padding: "8px 16px", borderRadius: "var(--radius-xl)",
          background: ACCENT_A, color: "#000", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}>Retry</button>
      </div>
    );
  }
  if (!state) return null;

  const profile = state.profile || {};
  const signals = state.signals || {};
  const ratings = state.ratings || {};
  const perGenre = state.per_genre_signal || {};
  const sampling = state.predicted_tier1_sampling || [];

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 20px 60px", display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <Link to={ROUTES.SETTINGS} style={{ fontSize: 12, color: "var(--text-muted)", textDecoration: "none" }}>← Settings</Link>
        <h1 style={{
          fontFamily: "var(--font-display)",
          fontSize: 32, fontWeight: 400,
          color: "var(--text)", margin: "8px 0 4px",
        }}>How the algorithm sees you</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}>
          Live view of the signals driving your For You feed. Nothing here is
          hidden — every input above the line gets used; anything below the
          line is shown for transparency but not yet wired in.
        </p>
      </div>

      <Section label="Current mode">
        <ModeExplainer
          inferredMode={state.inferred_mode}
          yearRange={signals.year_range}
          decadePref={signals.decade_pref}
        />
      </Section>

      <Section label="Your taste profile">
        <KV
          label="Liked genres"
          value={
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end", maxWidth: 360 }}>
              {(profile.eligible_genres_after_filters || []).map(g => <Chip key={g}>{g}</Chip>)}
              {!profile.eligible_genres_after_filters?.length && <span style={{ color: "var(--text-muted)", fontSize: 12 }}>None set</span>}
            </div>
          }
        />
        <KV
          label="Excluded genres"
          value={
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end", maxWidth: 360 }}>
              {(profile.excluded_genres || []).map(g => <Chip key={g} color={DANGER}>{g}</Chip>)}
              {!profile.excluded_genres?.length && <span style={{ color: "var(--text-muted)", fontSize: 12 }}>None</span>}
            </div>
          }
        />
        <KV label="Liked artist seed list" value={`${profile.liked_artist_ids_count || 0}`} hint="Artists from your 4–5★ ratings used to bias tier 1" />
        <KV label="Disliked artists" value={`${profile.disliked_artist_ids_count || 0}`} hint='Explicit "Not interested" clicks' />
        <KV label="Down-weighted artists" value={`${profile.down_weighted_artist_ids_count || 0}`} hint="Inferred from your 1–2★ ratings" />
      </Section>

      <Section label="Computed signals">
        <KV
          label="Target popularity"
          value={signals.target_popularity ?? "—"}
          hint="Average Spotify popularity (0–100) of your 4–5★ tracks. Drives the sampling curve."
        />
        <KV
          label="Decade preference"
          value={
            signals.decade_pref
              ? Object.entries(signals.decade_pref)
                  .sort((a, b) => b[1] - a[1])
                  .map(([d, p]) => `${d}: ${Math.round(p * 100)}%`)
                  .join(" · ")
              : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Not enough ratings</span>
          }
          hint="Distribution of decades across your 4–5★ ratings"
        />
        <KV
          label="Vintage mode trigger"
          value={signals.year_range ? <Chip color={GOLD}>{signals.year_range}</Chip> : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Off</span>}
          hint="≥60% of your high ratings concentrated in one decade locks the feed to that era"
        />
      </Section>

      <Section label="Ratings">
        <KV label="Total track ratings" value={ratings.total_track_ratings || 0} />
        <KV label="4–5★ ratings" value={ratings.high_track_ratings || 0} />
        <KV label="1–2★ ratings" value={ratings.low_track_ratings || 0} />
        <KV label="Album ratings" value={ratings.total_album_ratings || 0} />
        <KV label="Tracks excluded from feed (already rated)" value={state.exclude_ids_count || 0} hint="Tracks you've rated never appear again unless you reset below" />
      </Section>

      {sampling.length > 0 && (
        <Section label="Predicted next batch — genre sampling weights">
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px", lineHeight: 1.55 }}>
            Each request samples 6 genres weighted by recency × rating count.
            Higher weight = more often in your feed. Listed top-first.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sampling.map(w => (
              <div key={w.genre} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{w.genre}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{w.rating_count}r</span>
                <div style={{ flex: 1, height: 6, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(100, (w.final_weight / (sampling[0]?.final_weight || 1)) * 100)}%`,
                    background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                  }} />
                </div>
                <span style={{ fontSize: 11, color: "var(--text-muted)", width: 32, textAlign: "right" }}>{w.final_weight}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section label="Reset">
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.55 }}>
          Your underlying ratings stay intact in all cases — these reset
          only the per-user state that DIRECTLY drives the feed.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={() => setConfirmReset({ liked_artist_ids: true, down_weighted_artist_ids: true })}
            style={resetBtn()}
          >
            Re-derive from ratings <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7, marginLeft: 6 }}>
              Wipes the artist seed lists; keeps your genre picks
            </span>
          </button>
          <button
            onClick={() => setConfirmReset({ genres: true, excluded_genres: true })}
            style={resetBtn()}
          >
            Clear genre picks <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7, marginLeft: 6 }}>
              Clears your liked + excluded genres
            </span>
          </button>
          <button
            onClick={() => setConfirmReset({ disliked_artist_ids: true })}
            style={resetBtn()}
          >
            Clear "Not interested" list <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7, marginLeft: 6 }}>
              Re-allows artists you've previously hidden
            </span>
          </button>
          <button
            onClick={() => setConfirmReset({
              genres: true, excluded_genres: true,
              liked_artist_ids: true, disliked_artist_ids: true,
              down_weighted_artist_ids: true,
            })}
            style={{ ...resetBtn(), borderColor: `${DANGER}55`, color: DANGER }}
          >
            Full reset <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7, marginLeft: 6 }}>
              Wipes everything personalization-related. Ratings preserved.
            </span>
          </button>
        </div>
      </Section>

      <Section label="One-off discovery">
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.55 }}>
          See what a clean-slate user would see for one session without
          changing your profile.
        </p>
        <button onClick={tryFreshFeed} style={{
          width: "100%", padding: "11px 14px", borderRadius: "var(--radius-lg)",
          background: ACCENT_A, color: "#000", border: "none",
          fontSize: 14, fontWeight: 800, cursor: "pointer",
        }}>
          Open fresh feed (no personalization)
        </button>
      </Section>

      {confirmReset && (
        <ResetConfirmDialog
          fields={confirmReset}
          busy={resetBusy}
          onCancel={() => setConfirmReset(null)}
          onConfirm={() => doReset(confirmReset)}
        />
      )}
    </div>
  );
}

function resetBtn() {
  return {
    width: "100%", padding: "11px 14px", borderRadius: "var(--radius-lg)",
    background: "transparent", border: "1px solid var(--border)",
    color: "var(--text)", fontSize: 13, fontWeight: 700, cursor: "pointer",
    textAlign: "left",
    transition: "background 0.12s, border-color 0.12s",
  };
}
