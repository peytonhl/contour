import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT = "#d97a3b";

export function BlocksPage() {
  const { user, loading: authLoading } = useAuth();
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    api.getMyBlocks().then(setBlocks).catch(() => {}).finally(() => setLoading(false));
  }, [user]);

  async function unblock(id) {
    await api.unblockUser(id).catch(() => {});
    setBlocks((b) => b.filter((x) => x.user_id !== id));
  }

  if (authLoading) return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;
  if (!user) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
        Sign in to manage your blocked users.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px 60px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Blocked users</h1>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 22 }}>
        These users can't appear in your feed, reviews, or replies. They can still
        see your public content.
      </p>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
      ) : blocks.length === 0 ? (
        <div style={{
          padding: "40px 20px", textAlign: "center", color: "var(--text-muted)",
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
        }}>
          You haven't blocked anyone.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {blocks.map((b) => (
            <div key={b.user_id} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 14px",
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
            }}>
              <Link to={`/user/${b.user_id}`} style={{ flexShrink: 0 }}>
                {b.image_url
                  ? <img src={b.image_url} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                  : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface2)" }} />
                }
              </Link>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link to={`/user/${b.user_id}`} style={{
                  fontSize: 14, fontWeight: 600, color: "var(--text)", textDecoration: "none",
                }}>
                  {b.display_name || "Unknown user"}
                </Link>
              </div>
              <button onClick={() => unblock(b.user_id)} style={{
                padding: "6px 12px", borderRadius: 6, fontSize: 12,
                background: "none", border: "1px solid var(--border)",
                color: "var(--text-muted)", cursor: "pointer",
              }}>
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
