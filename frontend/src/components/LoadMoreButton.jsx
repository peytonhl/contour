// Shared "Load more" button used by every paginated list in the app
// (album/track review threads, reply threads, profile + user-page tabs).
//
// Standards this primitive enforces so the experience meets bar on every
// surface, not just where I remembered to think about it:
//   - min-height 44px (iOS HIG hit target — finger-friendly without
//     forcing the visible button to look giant)
//   - hover lifts to surface3 + brightens text on desktop, giving pointer
//     users feedback that the control is interactive
//   - keyboard :focus-visible inherits the global outline rule from
//     index.css (amber 2px outline) so tab-navigation lands here visibly
//   - disabled-while-loading prevents the double-fetch + dim opacity for
//     visible "I clicked it" feedback
//   - aria-busy=true during the loading state so screen readers don't
//     read "Loading…" as a navigation target
//
// Distinct from a generic <ShowAllButton> which only expands the local
// slice — this one fires a server fetch.
export function LoadMoreButton({ onClick, loading, label = "Load more", align = "center" }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      aria-busy={loading || undefined}
      style={{
        alignSelf: align,
        marginTop: 14,
        padding: "10px 22px",
        background: "var(--surface2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-xl)",
        color: "var(--text-muted)",
        fontSize: 13, fontWeight: 600,
        cursor: loading ? "default" : "pointer",
        opacity: loading ? 0.6 : 1,
        minHeight: 44,
        transition: "background var(--motion-base) var(--ease), color var(--motion-base) var(--ease)",
      }}
      onMouseEnter={(e) => {
        if (!loading) {
          e.currentTarget.style.background = "var(--surface3)";
          e.currentTarget.style.color = "var(--text)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--surface2)";
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      {loading ? "Loading…" : label}
    </button>
  );
}
