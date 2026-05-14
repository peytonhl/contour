// Skeleton placeholders for loading states. Animation is driven by the
// global `.skeleton` shimmer rule in index.css — components here just lay
// out the right shapes for whichever surface is loading.

export function Skeleton({ width = "100%", height = 16, radius = 6, style }) {
  return (
    <div
      className="skeleton"
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

// Hero block used by AlbumPage / TrackPage while the entity loads. Mirrors
// the real hero's geometry so the swap doesn't shift content under the
// user's eye.
export function EntityHeroSkeleton() {
  return (
    <div className="entity-hero" style={{ padding: "28px 28px 24px" }}>
      <div className="hero-row" style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
        <Skeleton width={180} height={180} radius={10} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Skeleton width={120} height={11} />
          <Skeleton width="70%" height={32} />
          <Skeleton width="40%" height={14} />
          <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <Skeleton width={90} height={32} radius={6} />
            <Skeleton width={110} height={32} radius={6} />
            <Skeleton width={88} height={32} radius={6} />
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <Skeleton width={70} height={22} radius={14} />
            <Skeleton width={92} height={22} radius={14} />
            <Skeleton width={74} height={22} radius={14} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Light empty-state line used under tabs / list containers when there's no
// content yet. Centralizes the muted-text-with-vertical-padding pattern that
// was being duplicated inline across profile, user, and trending pages.
// Use this only for the "nothing to show here" case — for *error* empty
// states (e.g. ArtistPage discography failure) build a richer block with
// an AlertIcon and a retry CTA.
export function EmptyHint({ children, dense = false }) {
  return (
    <p style={{
      color: "var(--text-muted)",
      fontSize: "var(--text-sm)",
      padding: dense ? "var(--space-2) 0" : "var(--space-5) 0",
      margin: 0,
    }}>
      {children}
    </p>
  );
}

// Compact list-row skeleton used by ArtistPage discography while albums load.
export function RowSkeleton({ count = 6 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "12px 16px",
            borderBottom: i < count - 1 ? "1px solid var(--border)" : "none",
          }}
        >
          <Skeleton width={48} height={48} radius={6} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
            <Skeleton width="55%" height={13} />
            <Skeleton width="30%" height={11} />
          </div>
          <Skeleton width={60} height={11} style={{ flexShrink: 0 }} />
        </div>
      ))}
    </div>
  );
}
