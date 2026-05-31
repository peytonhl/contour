// ─────────────────────────────────────────────────────────────────────────────
// Replay registry — one entry per gated-action kind.
//
// Imported once for its side effects (main.jsx) so every kind is registered
// before any auth completes. Each fn receives the self-contained payload that
// requireAuth captured and re-applies the action via the API, returning an
// optional { toast } confirmation. Keeping every replay in this single file is
// the spec's "none gets forgotten" guarantee — a new gated action = one new
// entry here, beside all the others.
//
// Replays are HEADLESS (call the API directly) rather than re-dispatching into
// the originating screen's handler: that survives Google's full-page reload
// (the screen is gone) and means no entry point can drift its own broken replay
// path. The user lands fresh on now-persisted server state, so the UI renders
// the applied action correctly.
//
// Two kinds (card, profile) are modal-INPUT actions with no pre-captured data —
// their "replay" restores the screen + re-opens the modal via the
// reopen-after-auth tag rather than calling an API. See pendingIntent.js.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from "./api.js";
import { analytics } from "./analytics.js";
import { registerReplay } from "./authGate.js";
import { setReopenAfterAuth } from "./pendingIntent.js";

const forName = (name) => (name ? ` for ${name}` : "");

// ── Rate (track / album / artist) ────────────────────────────────────────────
// payload: { entityType, entityId, rating, name? }. entityId is the resolved
// Spotify id, captured at gate time (the feed resolves it before prompting;
// entity pages already key off it).
registerReplay("rate", async (p) => {
  if (!p.entityId) return {}; // couldn't resolve an id — nothing safe to replay
  await api.rateEntity(p.entityType || "track", p.entityId, p.rating);
  analytics.ratingSubmitted(p.entityType || "track", p.entityId, p.rating);
  return { toast: `Saved your ${p.rating}★ rating${forName(p.name)}` };
});

// ── Review ───────────────────────────────────────────────────────────────────
// payload: { entityType, entityId, body, name? }. The review text WAS captured
// (typed in the modal before the gate fired at submit), so this replays cleanly.
registerReplay("review", async (p) => {
  if (!p.entityId || !p.body) return {};
  await api.submitReview(p.entityType || "track", p.entityId, p.body);
  analytics.reviewSubmitted(p.entityType || "track", p.body.length);
  return { toast: `Posted your review${forName(p.name)}` };
});

// ── Follow (artist / user) ───────────────────────────────────────────────────
// payload: { followType: "artist"|"user", id, name? }. The guest wasn't
// following anyone, so following (not toggling off) is always the intent.
registerReplay("follow", async (p) => {
  if (!p.id) return {};
  if (p.followType === "artist") await api.followUser(p.id);
  else await api.toggleFollow(p.id);
  analytics.followUser();
  return { toast: `Following${forName(p.name)}` };
});

// ── Backlog / want-to-listen ─────────────────────────────────────────────────
// payload: { albumId, name? }
registerReplay("backlog", async (p) => {
  if (!p.albumId) return {};
  await api.addToBacklog(p.albumId);
  analytics.backlogAdded(p.albumId);
  return { toast: `Saved to your backlog${forName(p.name)}` };
});

// ── Taste card (modal-input) ─────────────────────────────────────────────────
// No API to replay — restore the screen + re-open the card modal so the user
// continues where they left off. AuthSuccessPage navigates to returnTo (the
// profile), where TasteSection reads the reopen tag on mount.
registerReplay("card", async () => {
  setReopenAfterAuth("card");
  return { toast: "You're in — finishing your taste card" };
});

// ── Claim / edit profile (modal-input) ───────────────────────────────────────
registerReplay("profile", async () => {
  setReopenAfterAuth("profile");
  return { toast: "Welcome — this is your page" };
});
