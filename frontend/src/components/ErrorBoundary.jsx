import { Component } from "react";

/**
 * Top-level error boundary.
 *
 * The single most important defensive layer for the "white screen on
 * resume" class of bug. iOS WKWebView can evict the JS heap when the
 * app is backgrounded under memory pressure; on resume the page
 * reloads from scratch. If anything in that reload path throws
 * (expired auth token, stale localStorage shape, missing context
 * provider, ReferenceError in a recent diff), React unmounts the
 * entire tree and the WebView shows its default white background.
 * The user has no recovery option except force-quitting the app.
 *
 * With this boundary in place, the same exception instead renders a
 * visible "Something went wrong" screen with the error message, a
 * truncated stack trace, and a Reload button. The user can recover
 * without losing the app session, AND we can read the error message
 * over their shoulder (or via screenshot) to diagnose the next layer
 * of bug instead of staring at a white screen.
 *
 * Per CLAUDE.md feedback_blackscreen_is_render_exception: black/white
 * screens on mobile are almost always uncaught render exceptions
 * (ReferenceError in a recent diff, undefined accessors, etc.), not
 * CSS. First move is always an ErrorBoundary, not theorizing about
 * containment or transforms.
 *
 * Scope decision: wraps the WHOLE app, not individual routes. A
 * route-scoped boundary would let the error surface render but the
 * unmount could still take down the layout chrome. Catching at the
 * root means we always have a recovery surface.
 *
 * Note: React error boundaries only catch RENDER errors (and effect
 * teardown errors). They do NOT catch:
 *   - Errors in async handlers (promise rejections from fetch, etc.)
 *   - Errors thrown in event handlers (onClick, etc.)
 *   - Errors during the initial main.jsx parse
 * Those failure modes need their own try/catch or window error
 * listeners. This boundary is necessary but not sufficient.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Persist the last error so it survives a Reload click — lets us
    // (or the user, via a debug URL) pull the most recent crash out
    // of localStorage even after recovery. Truncate to 2KB so a
    // chatty stack doesn't blow out localStorage quota.
    try {
      const payload = {
        when: new Date().toISOString(),
        msg: String(error?.message || error || "(no message)"),
        stack: String(error?.stack || "").slice(0, 1500),
        componentStack: String(info?.componentStack || "").slice(0, 500),
        url: typeof window !== "undefined" ? window.location.pathname + window.location.search : "",
      };
      localStorage.setItem("contour_last_error", JSON.stringify(payload));
    } catch {
      // Storage might be unavailable (private mode, quota exceeded) —
      // skip silently. We still display the error in-page.
    }
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught:", error, info);
  }

  handleReload = () => {
    // Hard reload — bypasses bfcache so any stale module state is
    // dropped. Resume-after-eviction bugs that stem from cached state
    // mismatches recover cleanly here.
    try {
      window.location.reload();
    } catch {
      // Fallback if reload is somehow unavailable.
      window.location.href = window.location.pathname;
    }
  };

  handleHome = () => {
    try {
      window.location.href = "/";
    } catch {
      // Final fallback — at minimum, attempt a route reset.
      this.setState({ error: null, info: null });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const msg = String(this.state.error?.message || this.state.error || "Unknown error");
    const stack = String(this.state.error?.stack || "").split("\n").slice(0, 6).join("\n");

    return (
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 99999,
          background: "#08080a",
          color: "#fafafa",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "32px 24px",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          textAlign: "center",
          gap: 16,
          overflowY: "auto",
        }}
        role="alert"
      >
        <div style={{ fontFamily: "Georgia, serif", fontSize: 32, fontWeight: 400 }}>
          Something went wrong
        </div>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", maxWidth: 360, margin: 0, lineHeight: 1.55 }}>
          The app hit an unexpected error. Tap Reload to start fresh —
          your ratings and reviews are safe on the server.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            onClick={this.handleReload}
            style={{
              padding: "10px 20px",
              background: "#d97a3b",
              border: "none", borderRadius: 8,
              color: "#000", fontSize: 14, fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          <button
            onClick={this.handleHome}
            style={{
              padding: "10px 20px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: 8,
              color: "rgba(255,255,255,0.85)",
              fontSize: 14, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Go home
          </button>
        </div>
        {/* Error details — collapsed by default. Tap to expand. The
            user is unlikely to read it but a screenshot of it is the
            single most useful diagnostic artifact we can ask for. */}
        <details style={{ marginTop: 16, maxWidth: 520, width: "100%" }}>
          <summary style={{
            cursor: "pointer", fontSize: 12, color: "rgba(255,255,255,0.5)",
            textAlign: "center", padding: 6,
          }}>
            Error details
          </summary>
          <pre style={{
            marginTop: 8,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: 10,
            fontSize: 11, lineHeight: 1.5,
            color: "rgba(255,255,255,0.75)",
            textAlign: "left",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "'SF Mono', Menlo, Consolas, monospace",
          }}>
{msg}{stack ? "\n\n" + stack : ""}
          </pre>
        </details>
      </div>
    );
  }
}
