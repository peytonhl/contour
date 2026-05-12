import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { analytics } from "../services/analytics.js";

const ACCENT = "#a78bfa";
const ACCENT_B = "#34d399";

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * Reusable backlog tab body — used by both ProfilePage (own) and UserPage
 * (other users' public backlogs).
 *
 * Props:
 *   userId          — whose backlog to render
 *   isOwner         — show "Rate it now" / remove affordances only for the owner
 *   showSuggestions — also render the "Popular in backlogs" discovery list
 *                     below (true for own profile only)
 */
export function BacklogTabContent({ userId, isOwner, showSuggestions }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("recent");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetcher = isOwner ? api.getMyBacklog(sort) : api.getUserBacklog(userId, sort);
    fetcher
      .then((data) => { if (!cancelled) setItems(data ?? []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, isOwner, sort]);

  useEffect(() => {
    if (!showSuggestions) return;
    let cancelled = false;
    api.getBacklogSuggestions(5)
      .then((r) => { if (!cancelled) setSuggestions(r.items ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showSuggestions, items.length]);

  async function handlePromote(entityType, entityId) {
    // No inline rating picker for v1 — promote with no rating, then navigate
    // to the entity so the user can rate through the normal /ratings flow.
    try {
      await api.promoteBacklog(entityType, entityId, null);
      analytics.backlogPromotedToRating(entityId, null);
      setItems((prev) => prev.filter((i) => !(i.entity_type === entityType && i.entity_id === entityId)));
      navigate(`/${entityType}/${entityId}#rate-section`);
    } catch {}
  }

  async function handleRemove(entityType, entityId) {
    try {
      await api.removeFromBacklog(entityType, entityId);
      setItems((prev) => prev.filter((i) => !(i.entity_type === entityType && i.entity_id === entityId)));
    } catch {}
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Sort controls */}
      {items.length > 1 && (
        <div style={{ display: "flex", gap: 6, fontSize: 12 }}>
          {[
            { key: "recent",  label: "Recently added" },
            { key: "artist",  label: "By artist" },
            { key: "release", label: "By release date" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSort(opt.key)}
              style={{
                padding: "5px 10px", borderRadius: 16,
                border: `1px solid ${sort === opt.key ? ACCENT : "var(--border)"}`,
                background: sort === opt.key ? `${ACCENT}18` : "transparent",
                color: sort === opt.key ? ACCENT : "var(--text-muted)",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Items */}
      {loading && <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>Loading…</p>}
      {!loading && items.length === 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>
          {isOwner
            ? "Your backlog is empty. Tap “+ Want to listen” on an album or track to save it for later."
            : "Nothing here yet."}
        </p>
      )}

      {items.map((it) => {
        // Back-compat: legacy rows pre-migration may not have entity_type set.
        const entityType = it.entity_type ?? "album";
        const entityId = it.entity_id ?? it.album_id;
        const entity = it.entity ?? it.album ?? {};
        const linkPath = `/${entityType}/${entityId}`;
        // Tracks render with a tighter avatar style to visually distinguish.
        const isTrack = entityType === "track";

        return (
          <div
            key={it.id}
            style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "12px 0", borderBottom: "1px solid var(--border)",
            }}
          >
            <Link to={linkPath} style={{ flexShrink: 0 }}>
              {entity.image_url
                ? <img src={entity.image_url} alt={entity.name ?? ""} style={{ width: 56, height: 56, borderRadius: isTrack ? 4 : 6, objectFit: "cover" }} />
                : <div style={{ width: 56, height: 56, borderRadius: isTrack ? 4 : 6, background: "var(--surface2)" }} />
              }
            </Link>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link
                to={linkPath}
                style={{ color: "var(--text)", fontWeight: 600, textDecoration: "none", fontSize: 14, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {entity.name ?? entityId}
              </Link>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: isTrack ? ACCENT_B : ACCENT, marginRight: 6 }}>
                  {isTrack ? "Track" : "Album"}
                </span>
                {entity.artist ?? ""}
                <span style={{ margin: "0 5px", opacity: 0.4 }}>·</span>
                added {formatDate(it.added_at)}
              </div>
            </div>
            {isOwner && (
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => handlePromote(entityType, entityId)}
                  style={{
                    padding: "6px 12px", borderRadius: 6,
                    background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_B})`,
                    border: "none", color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  Rate it now
                </button>
                <button
                  onClick={() => handleRemove(entityType, entityId)}
                  title="Remove from backlog"
                  style={{
                    padding: "6px 10px", borderRadius: 6,
                    background: "none", border: "1px solid var(--border)",
                    color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Popular in backlogs — discovery surface for owners only */}
      {showSuggestions && suggestions.length > 0 && (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 12px" }}>
            Popular in backlogs
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {suggestions.map((s) => (
              <Link
                key={s.id}
                to={`/album/${s.id}`}
                onClick={() => analytics.trendingModuleClicked("profile_backlog", "album", s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "8px 10px", background: "var(--surface)",
                  border: "1px solid var(--border)", borderRadius: 8,
                  textDecoration: "none", color: "var(--text)",
                }}
              >
                {s.image_url
                  ? <img src={s.image_url} alt="" style={{ width: 40, height: 40, borderRadius: 5, objectFit: "cover" }} />
                  : <div style={{ width: 40, height: 40, borderRadius: 5, background: "var(--surface2)" }} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name ?? "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.artist ?? ""}
                    {s.backlog_count > 1 && <span> · {s.backlog_count} backlogs</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
