// Minimal app-level toast, used to CONFIRM a replayed action after auth.
//
// After a Google full-page redirect the originating screen is gone, so the
// confirmation can't live on it — it has to be app-level and fire post-reload
// from the replay dispatcher. <ToastHost> (mounted in App.jsx) listens for the
// event and renders. Kept dependency-free and tiny; this is the only toast in
// the app and exists specifically for the auth-replay "Saved your rating" moment.

const EVENT = "contour:toast";

export function showToast(message, opts = {}) {
  if (!message) return;
  try {
    window.dispatchEvent(new CustomEvent(EVENT, {
      detail: { message, kind: opts.kind || "success", duration: opts.duration || 3200 },
    }));
  } catch {}
}

export const TOAST_EVENT = EVENT;
