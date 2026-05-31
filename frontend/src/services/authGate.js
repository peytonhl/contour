// ─────────────────────────────────────────────────────────────────────────────
// Contextual auth gate + central replay dispatcher.
//
// This is the ONE place gated actions go through and the ONE place interrupted
// actions are replayed after sign-in. Centralizing both halves is deliberate:
// the spec calls intent-preservation "the part teams botch" precisely because
// per-screen replay logic silently breaks at one entry point and not others.
// Here, every entry point shares the same capture → prompt → replay path, and
// every replayable action is one entry in REPLAY_REGISTRY — so none can be
// forgotten.
//
//   requireAuth(intent)        — the gate. Signed in → run now. Guest → capture
//                                intent, fire the prompt, return false.
//   replayPendingIntent()      — run after login() resolves (Apple popup in
//                                context; Google/native after the reload, from
//                                AuthSuccessPage / the deep-link handler).
//   registerReplay(kind, fn)   — wire a kind to its headless API replay.
// ─────────────────────────────────────────────────────────────────────────────

import { setPendingIntent, consumePendingIntent } from "./pendingIntent.js";
import { analytics } from "./analytics.js";
import { showToast } from "./toast.js";

// Event the AuthPromptSheet (mounted at App level) listens for to open itself.
// Using the existing window-event bus pattern (contour:guest-mode-changed,
// contour:taste-updated) so a non-React caller can trigger React UI.
export const AUTH_PROMPT_EVENT = "contour:auth-prompt";

const REPLAY_REGISTRY = new Map();

/** Register a headless replay for an intent kind. fn(payload) → optional
 *  { toast } | Promise thereof. Called exactly once after successful auth. */
export function registerReplay(kind, fn) {
  REPLAY_REGISTRY.set(kind, fn);
}

/**
 * Is there a token? Synchronous source of truth for the gate. The React `user`
 * object is authoritative for RENDER, but the gate fires inside event handlers
 * where a sync check against the same localStorage token AuthContext bootstraps
 * from is correct and avoids threading the hook through every caller.
 */
export function isSignedIn() {
  try { return !!localStorage.getItem("contour_token"); } catch { return false; }
}

/**
 * THE GATE. Call at the top of any gated action handler.
 *
 *   const gate = useRequireAuth();           // in a component
 *   if (!gate({ kind, triggerLabel, returnTo, payload })) return;
 *   ...proceed with the action normally...
 *
 * Signed in → returns true (caller proceeds; nothing captured).
 * Guest → captures the intent, logs signup_prompt_shown, opens the contextual
 * sheet, returns false (caller bails; the action replays post-auth).
 */
export function requireAuth(intent) {
  if (isSignedIn()) return true;
  setPendingIntent(intent);
  try { analytics.signupPromptShown(intent.triggerLabel || intent.kind); } catch {}
  try {
    window.dispatchEvent(new CustomEvent(AUTH_PROMPT_EVENT, {
      detail: { kind: intent.kind, triggerLabel: intent.triggerLabel },
    }));
  } catch {}
  return false;
}

/**
 * Replay the captured action after sign-in. Idempotent by construction
 * (consume removes the intent first, so a double-call no-ops). Safe to call on
 * every login — returns quietly when there's nothing pending (the
 * returning-user "Log in" path has no intent).
 */
export async function replayPendingIntent() {
  const intent = consumePendingIntent();
  if (!intent) return { replayed: false };

  const fn = REPLAY_REGISTRY.get(intent.kind);
  if (!fn) {
    // Unknown kind (e.g. a stale intent from an older app version). Don't throw
    // — the user is signed in; just skip the replay.
    return { replayed: false, reason: "no-handler" };
  }

  try {
    const result = await fn(intent.payload || {});
    try { analytics.signupPromptCompleted(intent.triggerLabel || intent.kind); } catch {}
    if (result && result.toast) showToast(result.toast);
    return { replayed: true };
  } catch (e) {
    // The action failed post-auth (network, validation). The user is signed in,
    // so they can simply redo it on the screen they land on. Surface a gentle
    // nudge rather than silently swallowing.
    showToast("Couldn't finish that automatically — give it another tap.", { kind: "error" });
    return { replayed: false, reason: "replay-error" };
  }
}
