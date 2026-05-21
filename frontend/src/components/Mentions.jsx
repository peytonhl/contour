import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";

// Regex MUST match backend/services/mentions.py's _MENTION_RE — same prefix
// boundary (start of string or non-name char), same token shape (starts
// with letter/digit/underscore, total length 2–30, allowed chars
// [A-Za-z0-9_.-]). Kept in sync by convention; if you change one, change
// the other.
const MENTION_RE =
  /(^|[^A-Za-z0-9_.\-])@([A-Za-z0-9_][A-Za-z0-9_.\-]{1,29})(?![A-Za-z0-9_.\-])/g;

// Match while the user is mid-typing — same allowed chars but no trailing
// boundary (the cursor IS the boundary). Used by MentionInput to detect
// the "in progress" mention prefix at cursor.
const IN_PROGRESS_RE =
  /(?:^|[^A-Za-z0-9_.\-])@([A-Za-z0-9_][A-Za-z0-9_.\-]{0,29})$/;

const ACCENT = "#d97a3b";

// ── Body renderer ────────────────────────────────────────────────────────────

/**
 * Render a review/reply body with @-mentions as links.
 *
 * Walks the body once with MENTION_RE; for each match, looks up the token
 * in `mentions` (a list of {id, display_name} from the backend) case-
 * insensitively. Matched tokens render as <Link> to /user/{id}; unmatched
 * tokens fall back to the literal "@token" text. This is the rename-edge
 * case: backend stored the mention IDs at write time, but if the user
 * later renamed themselves, the literal body still has the old token and
 * the `mentions` list has the current display_name — they won't match
 * case-insensitively, and the @-token degrades gracefully to plain text.
 *
 * Returns an array of React children (strings + <Link>s + <br/>s for
 * newlines). Renders whitespace via white-space CSS on the parent — this
 * component does NOT wrap its own output.
 */
export function MentionBody({ body, mentions }) {
  const nodes = useMemo(() => {
    if (!body) return [];

    // Build a lookup of normalized display_name → user id from the
    // backend-supplied mentions list. Falls back to an empty Map if no
    // mentions provided (handles older clients / non-mention bodies).
    const byName = new Map();
    if (Array.isArray(mentions)) {
      for (const m of mentions) {
        if (m?.id && m?.display_name) {
          byName.set(m.display_name.toLowerCase(), m);
        }
      }
    }

    const out = [];
    let cursor = 0;
    let keyCounter = 0;
    // global regex — exec walks through all matches with .lastIndex
    MENTION_RE.lastIndex = 0;
    let match;
    while ((match = MENTION_RE.exec(body)) !== null) {
      const [whole, boundary, token] = match;
      const tokenStart = match.index + boundary.length; // position of '@'
      // Push any plain text between the previous match and this token's
      // leading boundary char (which we keep as literal text).
      if (tokenStart > cursor) {
        out.push(body.slice(cursor, tokenStart));
      }
      const linked = byName.get(token.toLowerCase());
      if (linked) {
        out.push(
          <Link
            key={`m${keyCounter++}`}
            to={`/user/${linked.id}`}
            style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}
          >
            @{token}
          </Link>
        );
      } else {
        // Unresolved (deleted user, rename, or never matched on backend) —
        // render as plain text so the body reads naturally.
        out.push(`@${token}`);
      }
      cursor = match.index + whole.length;
    }
    if (cursor < body.length) {
      out.push(body.slice(cursor));
    }
    return out;
  }, [body, mentions]);
  return <>{nodes}</>;
}

// ── Autocomplete input ───────────────────────────────────────────────────────

/**
 * Drop-in replacement for a controlled <input> or <textarea> that adds
 * @-mention autocomplete. When the user types `@` followed by 0+ allowed
 * chars at the cursor position, a dropdown appears with up to 6
 * matching users from /users/search. Arrow keys move the highlight,
 * Enter / Tab inserts the selected user's display_name (replacing the
 * in-progress token), Escape dismisses.
 *
 * Props: same shape as a native input/textarea (value, onChange,
 * onKeyDown, etc.) plus `as` ("input" | "textarea", default "input").
 * Layout: rendered inside a position:relative wrapper so the dropdown
 * can absolutely-position underneath the field.
 */
export function MentionInput({
  as = "input",
  value,
  onChange,
  onKeyDown,
  style,
  inputRef,
  ...rest
}) {
  const localRef = useRef(null);
  const fieldRef = inputRef || localRef;
  const [results, setResults] = useState([]);
  const [openIdx, setOpenIdx] = useState(0);
  const [activeQuery, setActiveQuery] = useState(null); // {start, end, prefix} or null

  // Compute whether we should be showing the autocomplete based on the
  // current value + cursor position. Debounced fetch lives in the effect
  // below; this just tracks the in-progress token range.
  function recomputeQueryFromCursor() {
    const el = fieldRef.current;
    if (!el) {
      setActiveQuery(null);
      return;
    }
    const cursor = el.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const m = IN_PROGRESS_RE.exec(before);
    if (!m) {
      setActiveQuery(null);
      return;
    }
    const prefix = m[1] ?? "";
    // The '@' character — at-position of the leading boundary char (if any)
    // plus the boundary's length, OR 0 if the boundary was the empty
    // string-start anchor. We computed match index relative to `before`,
    // so the '@' sits at `m.index + (boundary length)`.
    const boundaryLen = m[0].length - prefix.length - 1; // -1 for the '@'
    const atPos = m.index + boundaryLen;
    setActiveQuery({ start: atPos, end: cursor, prefix });
    setOpenIdx(0);
  }

  // Debounce the user-search fetch so typing fast doesn't hammer the API.
  // 150ms is short enough to feel instant on a stable connection but cuts
  // request volume by an order of magnitude vs per-keystroke.
  useEffect(() => {
    if (activeQuery === null) {
      setResults([]);
      return;
    }
    const q = activeQuery.prefix;
    // An empty prefix (user typed just '@' and is staring at the field)
    // doesn't hit the backend — wait for at least one char so we don't
    // dump the entire user list. Show a hint via the empty-results state
    // and let the user keep typing.
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const users = await api.searchUsers(q);
        if (cancelled) return;
        setResults((users || []).slice(0, 6));
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [activeQuery?.prefix]);

  function applyResult(user) {
    if (!activeQuery || !user) return;
    const { start, end } = activeQuery;
    // Replace the in-progress "@prefix" span with "@displayName " (trailing
    // space so the next character the user types isn't appended to the
    // mention by accident).
    const next =
      value.slice(0, start) + "@" + user.display_name + " " + value.slice(end);
    onChange({ target: { value: next } });
    setActiveQuery(null);
    setResults([]);
    // Focus + place cursor right after the inserted token.
    queueMicrotask(() => {
      const el = fieldRef.current;
      if (!el) return;
      const newPos = start + 1 + user.display_name.length + 1;
      el.focus();
      try { el.setSelectionRange(newPos, newPos); } catch { /* ignored */ }
    });
  }

  function handleKey(e) {
    // Forward to the caller first so they get the keystroke unconditionally.
    // The autocomplete overrides only when it's actively open AND the key
    // is one we handle.
    if (onKeyDown) onKeyDown(e);
    if (e.defaultPrevented) return;
    if (!activeQuery || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpenIdx((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpenIdx((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applyResult(results[openIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setActiveQuery(null);
    }
  }

  const sharedProps = {
    ref: fieldRef,
    value,
    onChange: (e) => {
      onChange(e);
      // Defer to next microtask so selectionStart reflects the post-input
      // cursor position (some browsers update it after the change event).
      queueMicrotask(recomputeQueryFromCursor);
    },
    onKeyUp: recomputeQueryFromCursor,
    onClick: recomputeQueryFromCursor,
    onBlur: () => {
      // Delay dismissal so a click inside the dropdown can register before
      // blur closes it. 150ms covers the click handler being scheduled
      // after the blur.
      setTimeout(() => setActiveQuery(null), 150);
    },
    onKeyDown: handleKey,
    style,
    ...rest,
  };

  const showDropdown = activeQuery !== null && results.length > 0;

  return (
    <div style={{ position: "relative", flex: rest.flex || "1 1 200px", minWidth: 0 }}>
      {as === "textarea" ? <textarea {...sharedProps} /> : <input {...sharedProps} />}
      {showDropdown && (
        <div
          // mousedown over click — fires before blur, so we don't lose the
          // selection to the input's blur handler.
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            overflow: "hidden",
          }}
        >
          {results.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onClick={() => applyResult(u)}
              onMouseEnter={() => setOpenIdx(i)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 10px",
                background: i === openIdx ? "var(--surface2)" : "transparent",
                border: "none", textAlign: "left", cursor: "pointer",
                color: "var(--text)",
              }}
            >
              {u.image_url
                ? <img src={u.image_url} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
                : <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--surface2)" }} />}
              <span style={{ fontSize: 13, fontWeight: 600 }}>{u.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
