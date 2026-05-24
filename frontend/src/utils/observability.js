// Silent-error logging helper. Wraps PostHog so a catch block that "swallows"
// an error still leaves a trail we can search later.
//
// Use this inside any catch block where:
//   - the error is from an API / network / SDK call (i.e. could indicate a real
//     production problem), AND
//   - the catch is intentionally silent for UX reasons (don't want to disrupt
//     the user with a modal / alert)
//
// Do NOT use this for catches that handle EXPECTED failures:
//   - localStorage quota / disabled
//   - user-cancelled share-sheet (AbortError)
//   - optimistic-UI updates that the server will reconcile
//   - DOM ops on detached elements
// Those are properly silent. Adding noise to them dilutes the signal.
//
// Falls back to console.warn if analytics isn't ready (dev mode, no PostHog
// key set) so the dev-tools console still shows the warning during local work.
import { track } from "../services/analytics.js";

export function logSilentError(context, error, extra = {}) {
  const message = error?.message ?? String(error ?? "unknown");
  const stack = error?.stack;
  const props = {
    context,
    error_message: message,
    error_name: error?.name,
    ...extra,
  };
  // Best-effort: PostHog might not be initialized (no VITE_POSTHOG_KEY in dev
  // or in a private-mode browser where localStorage threw). Don't let a logging
  // failure propagate — that'd be ironic and bad.
  try { track("silent_error", props); } catch {}
  // Also dump to console so a developer poking through the live console sees
  // it even when analytics isn't reporting. `warn` (not error) keeps the
  // page's console clean of red — these are documented-silent failures.
  if (typeof console !== "undefined" && console.warn) {
    console.warn(`[silent] ${context}: ${message}`, stack ? { stack } : "");
  }
}
