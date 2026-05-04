import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";

const GOLD = "#f59e0b";
const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";

function Stars({ value }) {
  return (
    <span style={{ display: "inline-flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ fontSize: 13, color: value >= n - 0.5 ? GOLD : "var(--border)", opacity: value >= n - 0.5 ? 1 : 0.3 }}>★</span>
      ))}
    </span>
  );
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function entityColor(type) {
  return type === "album" ? ACCENT_A : type === "track" ? ACCENT_B : "#fb923c";
}

function FeedItem({ item }) {
  const entityPath = `/${item.entity_type}/${item.entity_id}`;
  const userPath = `/user/${item.user?.id}`;
  const isReview = item.type === "review";

  return (
    <div style={{
      display: "flex", gap: 14, padding: "16px 0",
      borderBottom: "1px solid var(--border)",
    }}>
      {/* User avatar */}
      <Link to={userPath} style={{ flexShrink: 0 }}>
        {item.user?.image_url
          ? <img src={item.user.image_url} alt={item.user.display_name} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }} />
          : <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--surface2)" }} />
        }
      </Link>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Top line */}
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <Link to={userPath} style={{ color: "var(--text)", fontWeight: 700, textDecoration: "none" }}>
            {item.user?.display_name}
          </Link>
          <span style={{ color: "var(--text-muted)" }}>
            {isReview ? " reviewed " : " rated "}
          </span>
          <Link to={entityPath} style={{ color: entityColor(item.entity_type), fontWeight: 600, textDecoration: "none" }}>
            {item.entity_name ?? item.entity_id}
          </Link>
          {item.entity_artists?.length > 0 && (
            <span style={{ color: "var(--text-muted)" }}> by {item.entity_artists.slice(0, 2).join(", ")}</span>
          )}
        </div>

        {/* Rating stars */}
        {item.value && <Stars value={item.value} />}

        {/* Review body */}
        {isReview && item.body && (
          <p style={{
            fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6,
            margin: 0, display: "-webkit-box", WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {item.body}
          </p>
        )}

        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{timeAgo(item.created_at)}</span>
      </div>

      {/* Entity thumbnail */}
      {item.entity_image_url && (
        <Link to={entityPath} style={{ flexShrink: 0 }}>
          <img
            src={item.entity_image_url}
            alt={item.entity_name}
            style={{ width: 48, height: 48, borderRadius: item.entity_type === "artist" ? "50%" : 6, objectFit: "cover" }}
          />
        </Link>
      )}
    </div>
  );
}

export function FeedPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate("/"); return; }
    api.getFeed()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return null;

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 24 }}>Following</h1>

      {loading && <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40 }}>Loading…</div>}

      {!loading && items.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 60, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 32 }}>👥</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Nothing here yet</p>
          <p style={{ fontSize: 13 }}>
            Follow other users to see their ratings and reviews here.
            Find people by searching or visiting an album's review section.
          </p>
        </div>
      )}

      {!loading && items.map((item, i) => (
        <FeedItem key={`${item.type}-${item.user?.id}-${item.entity_id}-${i}`} item={item} />
      ))}
    </div>
  );
}
