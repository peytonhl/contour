/**
 * Shared formatting utilities used across multiple pages.
 * Import individual functions rather than the whole module to keep bundles lean.
 */

// ── Time ─────────────────────────────────────────────────────────────────────

export function timeAgo(iso) {
  // Backend emits naive UTC ISO strings (no Z suffix); JS would otherwise
  // parse those as local time and produce negative diffs for non-UTC users.
  const normalized = /[Z+-]\d{2}:?\d{2}$|Z$/.test(iso) ? iso : `${iso}Z`;
  const diff = Math.max(0, Date.now() - new Date(normalized).getTime());
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ── Numbers ───────────────────────────────────────────────────────────────────

export function formatStreams(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatDuration(ms) {
  if (!ms) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatReleaseDate(dateStr, precision = "day") {
  if (!dateStr) return "";
  if (precision === "year") return dateStr.slice(0, 4);
  if (precision === "month") {
    const [year, month] = dateStr.split("-");
    return `${new Date(year, parseInt(month) - 1).toLocaleString("default", { month: "short" })} ${year}`;
  }
  // day precision
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
