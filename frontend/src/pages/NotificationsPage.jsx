import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const ACCENT_A = "#a78bfa";

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function NotifIcon({ type }) {
  if (type === "follow") return <span style={{ fontSize: 18 }}>👤</span>;
  if (type === "upvote") return <span style={{ fontSize: 18 }}>▲</span>;
  if (type === "reply") return <span style={{ fontSize: 18 }}>💬</span>;
  return null;
}

function notifText(n) {
  const name = n.actor?.display_name ?? "Someone";
  if (n.type === "follow") return <><strong>{name}</strong> started following you</>;
  if (n.type === "upvote") return <><strong>{name}</strong> upvoted your review</>;
  if (n.type === "reply") return <><strong>{name}</strong> replied to your review</>;
  return null;
}

function notifLink(n) {
  if (n.type === "follow") return `/user/${n.actor?.id}`;
  if (n.entity_type && n.entity_id) return `/${n.entity_type}/${n.entity_id}${n.review_id ? `#review-${n.review_id}` : ""}`;
  return null;
}

export function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate("/"); return; }
    api.getNotifications()
      .then((data) => { setNotifs(data); api.markNotificationsRead(); })
      .catch(() => setNotifs([]))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 20px 60px", display: "flex", flexDirection: "column", gap: 20 }}>

      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Notifications</h1>

      {loading && <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40 }}>Loading…</div>}

      {!loading && notifs.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 60, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 36 }}>🔔</div>
          <p style={{ margin: 0 }}>Nothing yet. When someone follows you, upvotes a review, or replies, it'll show up here.</p>
        </div>
      )}

      {!loading && notifs.length > 0 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {notifs.map((n, i) => {
            const link = notifLink(n);
            const content = (
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 16px",
                  borderBottom: i < notifs.length - 1 ? "1px solid var(--border)" : "none",
                  background: n.read ? "transparent" : `${ACCENT_A}08`,
                  transition: "background 0.1s",
                  cursor: link ? "pointer" : "default",
                }}
                onMouseEnter={(e) => { if (link) e.currentTarget.style.background = "var(--surface2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = n.read ? "transparent" : `${ACCENT_A}08`; }}
              >
                {/* Actor avatar */}
                {n.actor?.image_url
                  ? <img src={n.actor.image_url} alt={n.actor.display_name} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <NotifIcon type={n.type} />
                    </div>
                }

                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.5 }}>
                    {notifText(n)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {timeAgo(n.created_at)}
                  </div>
                </div>

                {/* Unread dot */}
                {!n.read && (
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: ACCENT_A, flexShrink: 0 }} />
                )}
              </div>
            );

            return link
              ? <Link key={n.id} to={link} style={{ textDecoration: "none", display: "block" }}>{content}</Link>
              : <div key={n.id}>{content}</div>;
          })}
        </div>
      )}
    </div>
  );
}
