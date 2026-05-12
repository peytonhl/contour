/**
 * Helpers for detecting and adapting to the Capacitor iOS / Android shell.
 *
 * `@capacitor/core` is imported lazily-ish: it's bundled into the web build
 * too (same JS for web and native), but `Capacitor.isNativePlatform()`
 * cleanly returns false in the browser. No build-time exclusion needed.
 */
import { Capacitor } from "@capacitor/core";

export function isNativePlatform() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/**
 * Append the ?from=native flag to a URL when running inside the native
 * shell. Used to tell the backend OAuth flow to redirect back via the
 * `contour://` URL scheme (which iOS / Android wake the app up on) instead
 * of the web-style `${FRONTEND_URL}/auth/success` redirect.
 *
 * No-op on web. Safe to wrap any URL — handles both query-string-present
 * and query-string-absent inputs.
 */
export function withNativeAuthFlag(url) {
  if (!isNativePlatform()) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}from=native`;
}

/**
 * Props to spread onto an `<a>` that should open in the external system
 * browser when on native (and behave like a regular same-tab link on web).
 *
 * Why this matters for OAuth: Google explicitly refuses to render its
 * sign-in pages inside WKWebView (UA-sniffing — Guideline 4.2 of their
 * "Use secure browsers for OAuth" doc). So in-app sign-in is impossible;
 * we MUST open external Safari, complete the OAuth dance there, and rely
 * on the `contour://` URL scheme + appUrlOpen handler to wake the app
 * back up with the token.
 *
 * On web we want default behavior (same-tab navigation), so this returns
 * an empty object when not native.
 *
 * Usage:  <a href={LOGIN_URL} {...externalLinkProps()}>Sign in</a>
 */
export function externalLinkProps() {
  if (!isNativePlatform()) return {};
  return { target: "_blank", rel: "noopener noreferrer" };
}
