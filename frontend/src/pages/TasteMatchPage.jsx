import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { userAvatar } from "../utils/userAvatar.js";
import { CardPreviewModal } from "../components/CardPreviewModal.jsx";

const ACCENT = "#d97a3b";
const ACCENT_B = "#6a90b5";
const GOLD = "#f59e0b";

function Avatar({ user, size = 88, ring }) {
  return (
    <img
      src={userAvatar(user, size * 2)}
      alt={user?.display_name || ""}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        border: ring ? `3px solid ${ring}` : "3px solid var(--border)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
      }}
    />
  );
}

function StarRating({ value, color = GOLD }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color, fontWeight: 600 }}>
      <span style={{ fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1 }}>
        {value?.toFixed?.(1) ?? "—"}
      </span>
      <span style={{ fontSize: 16 }}>★</span>
    </span>
  );
}

function EntityCard({ kind, item, viewerName, otherName }) {
  if (!item) return null;
  const link =
    item.entity_type === "album"
      ? `/album/${item.entity_id}`
      : `/track/${item.entity_id}`;

  const isAgreement = kind === "agreement";
  const tint = isAgreement ? GOLD : ACCENT;
  const heading = isAgreement ? "Biggest agreement" : "Biggest fight";
  const subline = isAgreement
    ? `You both gave it ${item.viewer_rating?.toFixed?.(1)}★`
    : `${item.diff?.toFixed?.(1)}★ apart`;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-xl)",
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 16px",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: tint,
          textTransform: "uppercase",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {heading}
      </div>
      <Link
        to={link}
        style={{
          display: "flex",
          gap: 14,
          padding: 16,
          textDecoration: "none",
          color: "var(--text)",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 6,
            overflow: "hidden",
            background: "var(--surface2)",
            flexShrink: 0,
          }}
        >
          {item.image_url && (
            <img
              src={item.image_url}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 20,
              lineHeight: 1.15,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.name || "Unknown"}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {(item.artists || []).join(", ")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {item.total_ratings} {item.total_ratings === 1 ? "rating" : "ratings"} on Contour
          </div>
        </div>
      </Link>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderTop: "1px solid var(--border)",
          background: "var(--surface2)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{viewerName || "You"}</span>
          <StarRating value={item.viewer_rating} color={ACCENT} />
        </div>
        <span style={{ fontSize: 12, color: tint, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {subline}
        </span>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{otherName}</span>
          <StarRating value={item.other_rating} color={ACCENT_B} />
        </div>
      </div>
    </div>
  );
}

export function TasteMatchPage() {
  const { id: otherUserId } = useParams();
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!me) return;
    setLoading(true);
    setError(null);
    api
      .getTasteMatch(otherUserId)
      .then(setData)
      .catch((e) => setError(e?.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [me, otherUserId]);

  if (!me) {
    return (
      <div style={{ padding: 80, textAlign: "center", color: "var(--text-muted)" }}>
        Sign in to compare taste.
      </div>
    );
  }
  if (loading) {
    return (
      <div style={{ padding: 80, textAlign: "center", color: "var(--text-muted)" }}>
        Computing the match…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 80, textAlign: "center", color: "var(--danger, #f87171)" }}>
        {error}
      </div>
    );
  }
  if (!data) return null;

  const { viewer, other, shared_count, agreement_count, agreement_pct, biggest_agreement, biggest_fight } = data;
  const pct = Math.round((agreement_pct || 0) * 100);

  const cardUrl = `/api/og/taste-match?viewer=${encodeURIComponent(viewer.id)}&other=${encodeURIComponent(other.id)}`;
  const shareUrl = `${window.location.origin}/user/${encodeURIComponent(other.id)}`;
  const shareText = `${viewer.display_name} & ${other.display_name} — ${pct}% taste match on Contour`;
  const fileName = `contour-taste-match-${viewer.id}-${other.id}.png`;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "20px 16px 80px" }}>
      {/* Back affordance — the page has no global back affordance in the
          Layout header on mobile (only the notifications bell), so users
          landing here from /user/{id} or from a deep link had no exit.
          navigate(-1) walks one entry back in history; on a deep-link
          entry with no history we fall back to /friends since that's the
          most sensible "where I came from" given the comparison surface. */}
      <button
        onClick={() => {
          if (window.history.length > 1) navigate(-1);
          else navigate("/friends");
        }}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "transparent", border: "none",
          color: "var(--text-muted)", fontSize: 14,
          padding: "8px 4px", marginBottom: 12,
          cursor: "pointer",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back
      </button>

      {/* Head-to-head hero */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          marginBottom: 28,
        }}
      >
        <Link to="/profile" style={{ textDecoration: "none", color: "inherit", textAlign: "center" }}>
          <Avatar user={viewer} ring={ACCENT} />
          <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600 }}>
            {viewer.display_name}
          </div>
        </Link>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 32,
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          vs
        </div>
        <Link to={`/user/${other.id}`} style={{ textDecoration: "none", color: "inherit", textAlign: "center" }}>
          <Avatar user={other} ring={ACCENT_B} />
          <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600 }}>
            {other.display_name}
          </div>
        </Link>
      </div>

      {/* Agreement headline */}
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        {shared_count > 0 ? (
          <>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 88,
                lineHeight: 1,
                color: "var(--text)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {pct}%
            </div>
            <div
              style={{
                fontSize: 12,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                marginTop: 8,
              }}
            >
              Agreement on {agreement_count} of {shared_count} shared ratings
            </div>
          </>
        ) : (
          <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "32px 0" }}>
            No shared ratings yet. Rate some of the same albums or tracks and
            check back — the more overlap, the richer the comparison.
          </div>
        )}
      </div>

      {/* Highlight cards */}
      {(biggest_agreement || biggest_fight) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 28 }}>
          <EntityCard
            kind="agreement"
            item={biggest_agreement}
            viewerName={viewer.display_name}
            otherName={other.display_name}
          />
          <EntityCard
            kind="fight"
            item={biggest_fight}
            viewerName={viewer.display_name}
            otherName={other.display_name}
          />
        </div>
      )}

      {/* Share CTA — disabled when there's nothing meaningful to render. */}
      {shared_count > 0 && (
        <button
          onClick={() => setShareOpen(true)}
          style={{
            width: "100%",
            padding: "14px 16px",
            background: ACCENT,
            color: "#000",
            border: "none",
            borderRadius: "var(--radius-xl)",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Share this match
        </button>
      )}

      <CardPreviewModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        cardUrl={cardUrl}
        shareUrl={shareUrl}
        shareText={shareText}
        fileName={fileName}
      />
    </div>
  );
}
