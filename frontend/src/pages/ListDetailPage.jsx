import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT_A = "#d97a3b";
const ACCENT_B = "#6a90b5";
const GOLD = "#f59e0b";

function formatDuration(ms) {
  if (!ms) return null;
  const m = Math.floor(ms / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${m}:${s}`;
}

const ENTITY_COLOR = { album: ACCENT_A, track: ACCENT_B, artist: "#fb923c" };

// ── Unified item search (albums + tracks) ─────────────────────────────────────
function AddItemSearch({ onAdd, existingIds }) {
  const [query, setQuery] = useState("");
  const [albums, setAlbums] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function onOut(e) { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(timerRef.current);
    if (!val.trim()) { setAlbums([]); setTracks([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.search(val).catch(() => ({ albums: [], tracks: [] }));
        setAlbums((res.albums || []).slice(0, 4));
        setTracks((res.tracks || []).slice(0, 4));
        setOpen(true);
      } finally { setLoading(false); }
    }, 300);
  }

  function select(item, type) {
    onAdd({ ...item, _type: type });
    setQuery(""); setAlbums([]); setTracks([]); setOpen(false);
  }

  const typePill = (type) => ({
    fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
    padding: "2px 7px", borderRadius: "var(--radius-xl)",
    background: type === "track" ? `${ACCENT_B}20` : `${ACCENT_A}20`,
    color: type === "track" ? ACCENT_B : ACCENT_A,
    border: `1px solid ${type === "track" ? ACCENT_B : ACCENT_A}35`,
  });

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <input
        value={query}
        onChange={handleChange}
        onFocus={() => (albums.length || tracks.length) && setOpen(true)}
        placeholder="Search albums or tracks to add…"
        style={{
          width: "100%", padding: "10px 14px", boxSizing: "border-box",
          background: "var(--surface2)", border: `1px solid ${ACCENT_A}50`,
          borderRadius: "var(--radius)", color: "var(--text)", fontSize: 14, outline: "none",
        }}
      />
      {loading && <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-muted)" }}>…</span>}
      {open && (albums.length > 0 || tracks.length > 0) && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", zIndex: 50, maxHeight: 340, overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}>
          {[["album", albums], ["track", tracks]].map(([type, items]) =>
            items.length > 0 ? (
              <div key={type}>
                <div style={{ padding: "6px 12px 3px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", borderTop: type === "track" ? "1px solid var(--border)" : "none" }}>
                  {type === "album" ? "Albums" : "Tracks"}
                </div>
                {items.map((item) => {
                  const already = existingIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      onMouseDown={() => !already && select(item, type)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: already ? "default" : "pointer", opacity: already ? 0.4 : 1 }}
                      onMouseEnter={(e) => !already && (e.currentTarget.style.background = "var(--surface2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {item.image_url
                        ? <img src={item.image_url} alt="" loading="lazy" decoding="async" style={{ width: 36, height: 36, borderRadius: "var(--radius-sm)", objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 36, height: 36, borderRadius: "var(--radius-sm)", background: "var(--surface2)", flexShrink: 0 }} />
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.artists?.join(", ")}
                          {item.release_date ? ` · ${item.release_date.slice(0, 4)}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {already && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Added</span>}
                        <span style={typePill(type)}>{type}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}

// ── Single list item row ──────────────────────────────────────────────────────
function ListItemRow({ item, index, isOwner, isRanked, onMoveUp, onMoveDown, onRemove, isFirst, isLast }) {
  const entityPath = `/${item.entity_type}/${item.entity_id}`;
  const color = ENTITY_COLOR[item.entity_type] ?? "var(--text)";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 0", borderBottom: "1px solid var(--border)",
    }}>
      {/* Position number */}
      {isRanked && (
        <span style={{ fontSize: 15, fontWeight: 800, color: index <= 3 ? GOLD : "var(--text-muted)", width: 24, textAlign: "right", flexShrink: 0 }}>
          {index}
        </span>
      )}

      {/* Thumbnail */}
      <Link to={entityPath} style={{ flexShrink: 0 }}>
        {item.entity_image_url
          ? <img src={item.entity_image_url} alt="" loading="lazy" decoding="async" style={{ width: 48, height: 48, borderRadius: item.entity_type === "artist" ? "50%" : 6, objectFit: "cover" }} />
          : <div style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", background: "var(--surface2)" }} />
        }
      </Link>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link to={entityPath} style={{ textDecoration: "none" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.entity_name ?? `Unknown ${item.entity_type ?? "item"}`}
          </div>
        </Link>
        <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.entity_artists?.join(", ")}
          {item.release_date ? ` · ${item.release_date.slice(0, 4)}` : ""}
        </div>
        {item.note && <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginTop: 2 }}>{item.note}</div>}
      </div>

      {/* Type pill */}
      <span style={{
        fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
        padding: "2px 7px", borderRadius: "var(--radius-xl)", flexShrink: 0,
        background: `${color}18`, color, border: `1px solid ${color}35`,
      }}>
        {item.entity_type}
      </span>

      {/* Owner controls */}
      {isOwner && (
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          <button onClick={onMoveUp} disabled={isFirst} style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "none", border: "1px solid var(--border)", color: isFirst ? "var(--border)" : "var(--text-muted)", cursor: isFirst ? "default" : "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>↑</button>
          <button onClick={onMoveDown} disabled={isLast} style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "none", border: "1px solid var(--border)", color: isLast ? "var(--border)" : "var(--text-muted)", cursor: isLast ? "default" : "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>↓</button>
          <button onClick={onRemove} style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "none", border: "1px solid var(--border)", color: "var(--danger)", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function ListDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [list, setList] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [descInput, setDescInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.getList(id)
      .then((data) => { setList(data); setItems(data.items); setTitleInput(data.title); setDescInput(data.description ?? ""); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function saveItems(newItems) {
    setSaving(true);
    try {
      await api.updateListItems(id, newItems.map((it) => ({
        entity_type: it.entity_type,
        entity_id: it.entity_id,
        note: it.note ?? null,
      })));
      setItems(newItems);
    } finally { setSaving(false); }
  }

  function moveUp(idx) {
    if (idx === 0) return;
    const next = [...items];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    saveItems(next.map((it, i) => ({ ...it, position: i + 1 })));
  }

  function moveDown(idx) {
    if (idx === items.length - 1) return;
    const next = [...items];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    saveItems(next.map((it, i) => ({ ...it, position: i + 1 })));
  }

  function removeItem(idx) {
    const next = items.filter((_, i) => i !== idx).map((it, i) => ({ ...it, position: i + 1 }));
    saveItems(next);
  }

  function addItem(newItem) {
    const entity_type = newItem._type;
    const entity_id = newItem.id;
    const newEntry = {
      id: null,
      position: items.length + 1,
      entity_type,
      entity_id,
      entity_name: newItem.name,
      entity_image_url: newItem.image_url,
      entity_artists: newItem.artists ?? [],
      release_date: newItem.release_date,
      note: null,
    };
    saveItems([...items, newEntry]);
  }

  async function saveTitle() {
    if (!titleInput.trim()) return;
    await api.updateList(id, { title: titleInput.trim(), description: descInput.trim() || null });
    setList((l) => ({ ...l, title: titleInput.trim(), description: descInput.trim() || null }));
    setEditingTitle(false);
  }

  async function handleDelete() {
    if (!window.confirm("Delete this list? This can't be undone.")) return;
    setDeleting(true);
    try {
      await api.deleteList(id);
      navigate("/profile");
    } finally { setDeleting(false); }
  }

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (!list) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>List not found.</div>;

  const existingIds = new Set(items.map((i) => i.entity_id));

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 20px", display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Link to={`/user/${list.owner?.id}`} style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", alignSelf: "flex-start" }}>
          {list.owner?.image_url
            ? <img src={list.owner.image_url} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
            : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--surface2)" }} />
          }
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{list.owner?.display_name}</span>
        </Link>

        {editingTitle ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value.slice(0, 200))}
              placeholder="List title…"
              style={{ fontSize: 22, fontWeight: 800, padding: "8px 12px", background: "var(--surface2)", border: `1px solid ${ACCENT_A}`, borderRadius: "var(--radius-md)", color: "var(--text)", outline: "none" }}
            />
            <textarea
              value={descInput}
              onChange={(e) => setDescInput(e.target.value.slice(0, 500))}
              placeholder="Description (optional)…"
              rows={2}
              style={{ fontSize: 13, padding: "8px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text)", outline: "none", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveTitle} style={{ padding: "7px 18px", borderRadius: "var(--radius-md)", fontWeight: 700, fontSize: 13, background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`, border: "none", color: "#000", cursor: "pointer" }}>Save</button>
              <button onClick={() => setEditingTitle(false)} style={{ padding: "7px 14px", borderRadius: "var(--radius-md)", fontSize: 13, background: "none", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 4px" }}>{list.title}</h1>
              {list.description && <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{list.description}</p>}
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                {list.is_ranked ? "Ranked" : "Unranked"} · {items.length} item{items.length !== 1 ? "s" : ""}
                {saving && <span style={{ color: ACCENT_B, marginLeft: 8 }}>Saving…</span>}
              </p>
            </div>
            {list.is_owner && (
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => setEditingTitle(true)} style={{ fontSize: 12, padding: "5px 12px", borderRadius: "var(--radius-sm)", background: "none", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}>Edit</button>
                <button onClick={handleDelete} disabled={deleting} style={{ fontSize: 12, padding: "5px 12px", borderRadius: "var(--radius-sm)", background: "none", border: "1px solid rgba(248,113,113,0.4)", color: "var(--danger)", cursor: "pointer" }}>
                  {deleting ? "…" : "Delete"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Items */}
      <div>
        {items.length === 0 && (
          <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 14 }}>
            {list.is_owner ? "Search below to add your first item." : "This list is empty."}
          </div>
        )}
        {items.map((item, idx) => (
          <ListItemRow
            key={`${item.entity_id}-${idx}`}
            item={item}
            index={idx + 1}
            isOwner={list.is_owner}
            isRanked={list.is_ranked}
            onMoveUp={() => moveUp(idx)}
            onMoveDown={() => moveDown(idx)}
            onRemove={() => removeItem(idx)}
            isFirst={idx === 0}
            isLast={idx === items.length - 1}
          />
        ))}
      </div>

      {/* Add item search (owner only) */}
      {list.is_owner && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <p style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 17, color: "var(--text)" }}>
            Add to list
          </p>
          <AddItemSearch onAdd={addItem} existingIds={existingIds} />
        </div>
      )}
    </div>
  );
}
