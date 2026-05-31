import { describe, it, expect, beforeEach, vi } from "vitest";

// jsdom provides localStorage + window in the vitest environment. If the
// project's vitest env is "node", these tests stub them below.
function ensureBrowserGlobals() {
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
  }
  if (typeof globalThis.window === "undefined") {
    const listeners = {};
    globalThis.window = {
      addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
      removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
      dispatchEvent: (e) => { (listeners[e.type] || []).forEach((fn) => fn(e)); return true; },
    };
  }
  if (typeof globalThis.CustomEvent === "undefined") {
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  }
}
ensureBrowserGlobals();

// Mock the API + analytics BEFORE importing replays (which imports them).
const rateCalls = [];
vi.mock("../services/api.js", () => ({
  api: {
    rateEntity: async (type, id, val) => { rateCalls.push({ type, id, val }); return { ok: true }; },
    submitReview: async () => ({ ok: true }),
    followUser: async () => ({ ok: true }),
    toggleFollow: async () => ({ ok: true }),
    addToBacklog: async () => ({ ok: true }),
  },
}));
vi.mock("../services/analytics.js", () => ({
  analytics: new Proxy({}, { get: () => () => {} }),
}));

// Import AFTER the mocks. Single ESM graph → authGate and replays share ONE
// module instance, exactly as a bundled prod build does (the dual-instance
// issue only appears in the Vite dev eval sandbox, never here or in prod).
const { requireAuth, replayPendingIntent, isSignedIn } = await import("../services/authGate.js");
const { peekPendingIntent, clearPendingIntent } = await import("../services/pendingIntent.js");
await import("../services/replays.js"); // registers rate/review/follow/backlog/card/profile

beforeEach(() => {
  rateCalls.length = 0;
  clearPendingIntent();
  localStorage.removeItem("contour_token");
});

describe("requireAuth gate", () => {
  it("blocks a guest, captures the intent, returns false", () => {
    const proceed = requireAuth({
      kind: "rate", triggerLabel: "rate", returnTo: "/",
      payload: { entityType: "track", entityId: "abc", rating: 4 },
    });
    expect(proceed).toBe(false);
    expect(peekPendingIntent()?.payload?.entityId).toBe("abc");
  });

  it("proceeds for a signed-in user and captures nothing", () => {
    localStorage.setItem("contour_token", "t");
    const proceed = requireAuth({ kind: "rate", triggerLabel: "rate", payload: { v: 1 } });
    expect(proceed).toBe(true);
    expect(peekPendingIntent()).toBe(null);
    expect(isSignedIn()).toBe(true);
  });
});

describe("replayPendingIntent — the rate entry point end to end", () => {
  it("replays a captured rating via the API and consumes the intent", async () => {
    // Guest captures a 4★ rating
    requireAuth({
      kind: "rate", triggerLabel: "rate", returnTo: "/",
      payload: { entityType: "track", entityId: "trk_abc", rating: 4, name: "Black Star" },
    });
    expect(peekPendingIntent()).not.toBe(null);

    // User signs in → this is what AuthContext.login() calls
    localStorage.setItem("contour_token", "t");
    const out = await replayPendingIntent();

    expect(out.replayed).toBe(true);
    expect(rateCalls).toEqual([{ type: "track", id: "trk_abc", val: 4 }]);
    expect(peekPendingIntent()).toBe(null); // consumed — can't double-fire
  });

  it("no-ops quietly when nothing is pending (returning-user Log in path)", async () => {
    const out = await replayPendingIntent();
    expect(out.replayed).toBe(false);
  });

  it("skips an unknown kind without throwing (stale intent from old version)", async () => {
    localStorage.setItem("contour_token", "t");
    // write a bogus intent directly
    localStorage.setItem("contour_pending_intent_v1", JSON.stringify({ kind: "bogus_xyz", ts: Date.now(), payload: {} }));
    const out = await replayPendingIntent();
    expect(out.replayed).toBe(false);
    expect(out.reason).toBe("no-handler");
  });

  it("registered every gated-action kind (none forgotten)", async () => {
    localStorage.setItem("contour_token", "t");
    for (const kind of ["rate", "review", "follow", "backlog", "card", "profile"]) {
      localStorage.setItem("contour_pending_intent_v1", JSON.stringify({ kind, ts: Date.now(), payload: {} }));
      const out = await replayPendingIntent();
      // present in registry → reason is never "no-handler" (may be {} from a
      // payload guard, but the handler exists)
      expect(out.reason, `kind "${kind}" must be registered`).not.toBe("no-handler");
    }
  });
});
