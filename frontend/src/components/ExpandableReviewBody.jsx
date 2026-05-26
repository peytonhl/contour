import { useState } from "react";
import { MentionBody } from "./Mentions.jsx";

/**
 * Review body with a "Show more" / "Show less" toggle.
 *
 * Renders the review text line-clamped by default. If the clamp is
 * actually clipping content, a toggle button appears below; if the
 * body fits within the clamp, no button (rendering one would be a
 * misleading no-op).
 *
 * Used across every surface that displays a review body:
 *   - Community feed (GlobalReviewsFeed)
 *   - Following / activity feed (FollowingTab)
 *   - User profile review tabs (UserPage, ProfilePage)
 *   - For You deck review preview (ForYouPage)
 *
 * Originally inlined in GlobalReviewsFeed (commit 7145cf2). Hoisted
 * into a shared component when a user reported the affordance was
 * missing on the Following page — "I should in any place that shows
 * a review, have the option to see the whole thing."
 *
 * Props:
 *   body         — the raw review text (string)
 *   mentions     — optional @-mention metadata (array, passed to MentionBody)
 *   clampLines   — number of lines to clamp to when collapsed (default 4)
 *   fontSize     — body font size in px (default 14, matches Community)
 *   color        — text color (default "var(--text-muted)")
 *   lineHeight   — line-height multiplier (default 1.65)
 *   toggleColor  — color of the Show more / less button (default "var(--accent)")
 *
 * The defaults match the GlobalReviewsFeed style; surfaces with
 * different typography (smaller font on activity rows, etc.) pass
 * their own values.
 */
export function ExpandableReviewBody({
  body,
  mentions,
  clampLines = 4,
  fontSize = 14,
  color = "var(--text-muted)",
  lineHeight = 1.65,
  toggleColor = "var(--accent)",
}) {
  // Per-instance expand state — collapsing returns to the clamped view.
  const [expanded, setExpanded] = useState(false);

  // overflow flag — only show the toggle when the body actually clips.
  // Measure-on-mount via a ref callback: compares scrollHeight to
  // clientHeight one frame after mount (mentions can shift wrap, so
  // we defer through rAF to let layout settle).
  const [overflows, setOverflows] = useState(false);
  const measureRef = (el) => {
    if (!el) return;
    requestAnimationFrame(() => {
      setOverflows(el.scrollHeight - el.clientHeight > 1);
    });
  };

  return (
    <>
      <p
        ref={measureRef}
        style={{
          fontSize,
          color,
          lineHeight,
          margin: 0,
          display: "-webkit-box",
          // "unset" rather than removing the property entirely so the
          // display:-webkit-box layout stays stable across the toggle —
          // no reflow flicker on collapse.
          WebkitLineClamp: expanded ? "unset" : clampLines,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          whiteSpace: "pre-wrap",
        }}
      >
        <MentionBody body={body} mentions={mentions} />
      </p>
      {overflows && (
        <button
          onClick={() => setExpanded((e) => !e)}
          style={{
            alignSelf: "flex-start",
            background: "none",
            border: "none",
            padding: "2px 0",
            color: toggleColor,
            fontSize: Math.max(11, fontSize - 2),
            fontWeight: 600,
            cursor: "pointer",
            marginTop: -2,
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}
