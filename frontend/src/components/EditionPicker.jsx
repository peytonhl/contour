import { useState, useEffect } from "react";
import { api } from "../services/api.js";

export function EditionPicker({ album, accentColor, onEditionsChange }) {
  const [editions, setEditions] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!album) { setEditions([]); setSelected(new Set()); return; }
    setLoading(true);
    api.getEditions(album.id)
      .then((eds) => {
        setEditions(eds);
        // Default: all editions aggregated
        const allIds = eds.map((e) => e.id);
        setSelected(new Set(allIds));
        onEditionsChange(allIds);
      })
      .catch(() => {
        setEditions([]);
        onEditionsChange([album.id]);
      })
      .finally(() => setLoading(false));
  }, [album?.id]);

  if (!album || editions.length <= 1) return null;

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size === 1) return prev; // always keep at least one
        next.delete(id);
      } else {
        next.add(id);
      }
      onEditionsChange([...next]);
      return next;
    });
  }

  function selectAll() {
    const all = new Set(editions.map((e) => e.id));
    setSelected(all);
    onEditionsChange([...all]);
  }

  function selectOne() {
    const s = new Set([album.id]);
    setSelected(s);
    onEditionsChange([...s]);
  }

  const allSelected = selected.size === editions.length;

  return (
    <div style={{
      border: `1px solid ${accentColor}33`,
      borderRadius: 8,
      overflow: "hidden",
      fontSize: 13,
    }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: `${accentColor}11`,
          border: "none",
          cursor: "pointer",
          color: accentColor,
          fontWeight: 600,
          fontSize: 12,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        <span>
          {loading ? "Detecting editions…" : `${editions.length} editions found`}
          {!loading && (allSelected ? " · all aggregated" : ` · ${selected.size} selected`)}
        </span>
        <span style={{ fontSize: 10 }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 6, background: "var(--surface2)" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            <button onClick={selectAll} style={quickBtn(accentColor)}>All editions</button>
            <button onClick={selectOne} style={quickBtn(accentColor)}>Primary only</button>
          </div>
          {editions.map((ed) => (
            <label key={ed.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", lineHeight: 1.4 }}>
              <input
                type="checkbox"
                checked={selected.has(ed.id)}
                onChange={() => toggle(ed.id)}
                style={{ accentColor }}
              />
              <span style={{ color: selected.has(ed.id) ? "var(--text)" : "var(--text-muted)" }}>
                {ed.name}
              </span>
              <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 11, flexShrink: 0 }}>
                {ed.release_date?.slice(0, 4)} · {ed.total_tracks} tracks
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const quickBtn = (color) => ({
  padding: "3px 10px",
  fontSize: 11,
  background: "transparent",
  border: `1px solid ${color}55`,
  borderRadius: 4,
  color: color,
  cursor: "pointer",
});
