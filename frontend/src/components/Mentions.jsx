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
 * Driven by the backend-supplied `mentions` array (each item:
 * {id, display_name}) rather than a regex parse, because display names
 * can contain spaces ("@Adam Zhang") and a regex stop-at-whitespace
 * approach would only ever match "@Adam". For every mention we search
 * the body for the literal "@<display_name>" (case-insensitive,
 * word-bounded) and wrap matched ranges as <Link> to /user/{id}.
 *
 * Sort by display_name length DESCENDING so that "@Adam Zhang" wins
 * over "@Adam" when both could match — prevents the longer mention
 * from being shadowed by a shorter one with the same prefix.
 *
 * Unmatched @-text (a typed token that no mention entry covers) is
 * left as plain text. This is the "the author renamed themselves
 * post-write" degradation path: the backend stored their old ID, but
 * the body's literal "@oldname" doesn't match the current
 * "newname" — we don't try to be clever, just leave the text alone.
 *
 * Returns React children — render inside a parent with
 * white-space: pre-wrap if the body uses newlines.
 */
export function MentionBody({ body, mentions }) {
  const nodes = useMemo(() => {
    if (!body) return [];

    // Build a sorted list of {id, display_name} from the backend
    // mentions array. Longer names first so "@Adam Zhang" claims its
    // range before "@Adam" tries.
    const ms = Array.isArray(mentions)
      ? mentions
          .filter((m) => m?.id && m?.display_name)
          .slice()
          .sort((a, b) => b.display_name.length - a.display_name.length)
      : [];

    // Walk the body once, claiming non-overlapping ranges for each
    // mention. claimed[i] = true means body[i] is already part of a
    // resolved mention link.
    const claimed = new Array(body.length).fill(false);
    const ranges = []; // {start, end, mention}
    const lowerBody = body.toLowerCase();
    for (const m of ms) {
      const needle = "@" + m.display_name.toLowerCase();
      let from = 0;
      while (from <= lowerBody.length - needle.length) {
        const idx = lowerBody.indexOf(needle, from);
        if (idx === -1) break;
        const end = idx + needle.length;
        // Word-boundary check: char before "@" must NOT be a name char
        // (so we don't match the @ inside an email address), and the
        // char after the name must NOT be another display-name char
        // (so "@Adam" inside "@Adam Zhang" doesn't shadow the longer
        // match — we already process longer names first, so claimed
        // covers it, but the boundary check is the canonical guard).
        const beforeOk =
          idx === 0 || !/[A-Za-z0-9_.\-]/.test(body[idx - 1]);
        const afterOk =
          end === body.length || !/[A-Za-z0-9_.\-]/.test(body[end]);
        if (!beforeOk || !afterOk) {
          from = idx + 1;
          continue;
        }
        // Skip if this range overlaps an already-claimed range (a
        // shorter mention later trying to grab a slice of a longer
        // one already linked).
        let overlap = false;
        for (let i = idx; i < end; i++) {
          if (claimed[i]) { overlap = true; break; }
        }
        if (overlap) {
          from = idx + 1;
          continue;
        }
        for (let i = idx; i < end; i++) claimed[i] = true;
        ranges.push({ start: idx, end, mention: m });
        from = end;
      }
    }

    // Sort claimed ranges by start position so we can walk the body
    // left-to-right.
    ranges.sort((a, b) => a.start - b.start);

    const out = [];
    let cursor = 0;
    let key = 0;
    for (const r of ranges) {
      if (r.start > cursor) {
        out.push(body.slice(cursor, r.start));
      }
      out.push(
        <Link
          key={`m${key++}`}
          to={`/user/${r.mention.id}`}
          // Stop click bubbling so the parent row's onClick (used by
          // ProfilePage / UserPage review rows) doesn't fight the
          // mention's own navigation.
          onClick={(e) => e.stopPropagation()}
          style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}
        >
          {body.slice(r.start, r.end)}
        </Link>
      );
      cursor = r.end;
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
  onPickedUsersChange,
  style,
  inputRef,
  ...rest
}) {
  const localRef = useRef(null);
  const fieldRef = inputRef || localRef;
  const [results, setResults] = useState([]);
  const [openIdx, setOpenIdx] = useState(0);
  const [activeQuery, setActiveQuery] = useState(null); // {start, end, prefix} or null

  // Tracked locally so the parent form can submit the explicit picked
  // IDs alongside the body. Each entry is {id, display_name}. Pruned
  // on every value change to drop users whose @<display_name> token
  // no longer appears in the body. The backend can still resolve
  // single-word @-tokens via regex, but multi-word names need this
  // explicit list because the backend regex stops at whitespace.
  const pickedRef = useRef([]);
  function notifyPickedChange(next) {
    pickedRef.current = next;
    if (onPickedUsersChange) {
      onPickedUsersChange(next.map((u) => u.id));
    }
  }

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
    // Record the explicit pick so the parent form can submit it
    // alongside the body. Dedup by id — a user mentioned twice still
    // only counts once for the backend's notification fanout.
    const already = pickedRef.current.some((u) => u.id === user.id);
    if (!already) {
      notifyPickedChange([
        ...pickedRef.current,
        { id: user.id, display_name: user.display_name },
      ]);
    }
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

  // Prune picked users whose @<display_name> token is no longer in the
  // value (the user deleted the mention from the body). Runs on every
  // value change so the picked list stays consistent with what's
  // actually written.
  useEffect(() => {
    if (pickedRef.current.length === 0) return;
    const lowered = (value || "").toLowerCase();
    const still = pickedRef.current.filter((u) =>
      lowered.includes("@" + u.display_name.toLowerCase())
    );
    if (still.length !== pickedRef.current.length) {
      notifyPickedChange(still);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

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
