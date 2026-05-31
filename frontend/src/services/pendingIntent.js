// ─────────────────────────────────────────────────────────────────────────────
// Pending-intent store — the backbone of contextual auth + intent preservation.
//
// When a GUEST takes a gated action (rate, review, follow, save a list/card,
// claim a profile), we capture what they were trying to do HERE, launch OAuth,
// and replay it after they sign in (see services/authGate.js).
//
// WHY localStorage (not React state): Google OAuth is a FULL-PAGE REDIRECT
// (SigninGate's <a href=.../auth/login> → Google → /auth/success). The page
// UNLOADS, so any in-memory intent is destroyed. On native it's an external
// Safari round-trip back via the contour:// deep link — same story. localStorage
// is the only thing that survives both. (Apple uses a popup and stays mounted,
// but we persist uniformly so every provider replays through one code path.)
//
// The payload must be SELF-CONTAINED — everything needed to replay the action
// headlessly via the API, without depending on any screen still being mounted
// with the right data. e.g. a feed rating stores the resolved Spotify id +
// value + display name, NOT a reference to the swipe deck (which is gone after a
// reload).
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "contour_pending_intent_v1";
// Intents older than this are stale — a user who bailed on the OAuth flow and
// wandered back an hour later shouldn't have a surprise rating fire. 15 min
// comfortably covers a real OAuth round-trip (incl. account picker + 2FA).
const TTL_MS = 15 * 60 * 1000;

/**
 * Persist a pending intent. Shape:
 *   {
 *     kind: string,          // e.g. "rate_track" — keys the replay registry
 *     triggerLabel: string,  // analytics bucket: rate|review|save|card|profile|onboarding
 *     returnTo: string,      // path to land on after a full-page-redirect auth
 *     payload: object,       // self-contained args for the replay fn
 *   }
 * `ts` is stamped automatically for TTL expiry.
 */
export function setPendingIntent(intent) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...intent, ts: Date.now() }));
  } catch {
    /* storage full/disabled — degrade to "no replay" (auth still works) */
  }
}

/** Read without consuming. Returns null if absent or expired (expired → cleared). */
export function peekPendingIntent() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const intent = JSON.parse(raw);
    if (!intent || typeof intent !== "object") return null;
    if (!intent.ts || Date.now() - intent.ts > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return intent;
  } catch {
    return null;
  }
}

/** Read AND remove — call this when you're about to replay so it can't double-fire. */
export function consumePendingIntent() {
  const intent = peekPendingIntent();
  try { localStorage.removeItem(KEY); } catch {}
  return intent;
}

/** Drop any pending intent (e.g. user dismisses the prompt without signing in). */
export function clearPendingIntent() {
  try { localStorage.removeItem(KEY); } catch {}
}

// ── Reopen-after-auth ─────────────────────────────────────────────────────────
// For modal-INPUT actions (save taste card, edit/claim profile) the "creative
// action" happens INSIDE a modal whose form state we can't capture at gate time
// — the guest only got as far as opening it. Intent preservation for these means
// "return them to the screen with that modal re-opened" so they continue where
// they left off. The replay sets this one-shot tag; the target screen reads it
// on mount (after returnTo lands them there post-redirect) and re-opens the
// modal. Separate from the pending-intent payload because there's no headless
// API call to replay — just UI to restore.
const REOPEN_KEY = "contour_reopen_after_auth_v1";

export function setReopenAfterAuth(tag) {
  try { localStorage.setItem(REOPEN_KEY, tag); } catch {}
}

/** Read AND clear the reopen tag. Returns null when there's nothing to reopen. */
export function consumeReopenAfterAuth() {
  try {
    const v = localStorage.getItem(REOPEN_KEY);
    if (v) localStorage.removeItem(REOPEN_KEY);
    return v || null;
  } catch { return null; }
}
