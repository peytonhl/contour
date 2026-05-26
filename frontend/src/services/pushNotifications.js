/**
 * Push-notification lifecycle hook.
 *
 * On native (iOS/Android Capacitor shell) AND when a user is signed in:
 *   1. Request permission (no-op if already granted; one-shot system
 *      prompt if not).
 *   2. Listen for the platform's `registration` event to receive the
 *      device token.
 *   3. POST the token to the backend so future Notifications fan out to
 *      this device. Stores the token in localStorage so we can
 *      unregister it cleanly on sign-out without waiting for another
 *      registration round-trip.
 *
 * On web: no-op. The `@capacitor/push-notifications` plugin is imported
 * dynamically and gated on `isNativePlatform()` so web bundles don't pay
 * the cost of (or break on) the native-only module.
 *
 * Hard rule: this hook must NEVER throw during render. Failures
 * (permission denied, plugin missing, network error) are swallowed +
 * logged. A bricked push system shouldn't take the whole app down.
 */

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { isNativePlatform } from "../utils/native.js";
import { api } from "./api.js";
import { logSilentError } from "../utils/observability.js";

const STORAGE_KEY = "contour_push_token";
// Sticky breadcrumb of the most recent push-registration attempt's outcome.
// Written on every branch (plugin missing / permission denied / token
// registered / etc) so a user reporting "I'm not getting pushes" can read
// it back from localStorage AND so the server can see it without needing
// Xcode debugger access to the user's device. Format:
//   { state: "...", at: ISO timestamp, detail?: string }
//
// Two writes per call: (1) localStorage for client-side inspection,
// (2) POST /notifications/push-trace (fire-and-forget) so the
// server-side /notifications/diagnostic endpoint can read the latest
// state without the user running a console snippet on iOS.
const DIAG_KEY = "contour_push_diag";
function _writeDiag(state, detail) {
  try {
    localStorage.setItem(DIAG_KEY, JSON.stringify({
      state,
      at: new Date().toISOString(),
      ...(detail ? { detail: String(detail).slice(0, 200) } : {}),
    }));
  } catch { /* ignore */ }
  // Server-side mirror. Fire-and-forget; the POST helper's .catch
  // swallows failures so a network blip on a breadcrumb write doesn't
  // disrupt the registration flow itself.
  try { api.postPushTrace(state, detail); } catch { /* ignore */ }
}


function detectPlatform() {
  // Capacitor.getPlatform() returns "ios" | "android" | "web". The hook
  // calling this is gated on isNativePlatform() so we should only see
  // ios/android in practice; default to ios on the off chance the call
  // throws (older Capacitor builds).
  try {
    const p = Capacitor.getPlatform();
    return p === "ios" || p === "android" ? p : "ios";
  } catch {
    return "ios";
  }
}


export function usePushNotifications(user) {
  useEffect(() => {
    if (!isNativePlatform()) {
      _writeDiag("skip_non_native");
      return;
    }
    if (!user?.id) {
      _writeDiag("skip_no_user");
      return;
    }
    _writeDiag("attempt_started");

    let cancelled = false;
    let removeListeners = () => {};

    (async () => {
      try {
        // Dynamic import keeps the web bundle from pulling the plugin in.
        // The native shell ships with the plugin compiled in via Capacitor's
        // sync step; the JS-side import resolves to the runtime stub.
        const mod = await import("@capacitor/push-notifications");
        const PushNotifications = mod.PushNotifications;
        if (!PushNotifications) {
          // Plugin import succeeded but the runtime export is missing —
          // means Capacitor sync didn't pick up the plugin (typical when
          // the IPA was built before the plugin was added to package.json).
          _writeDiag("plugin_export_missing");
          logSilentError("push_plugin_export_missing", new Error("PushNotifications export missing"));
          return;
        }
        _writeDiag("plugin_loaded");

        const perm = await PushNotifications.requestPermissions();
        if (cancelled) return;
        _writeDiag("perm_returned", `receive=${perm.receive}`);
        if (perm.receive !== "granted") {
          // User declined the system prompt OR has previously denied.
          // Log so we know WHY no token is registering. Drop any
          // previously-stored token so we don't keep claiming to be
          // registered.
          _writeDiag("perm_not_granted", `receive=${perm.receive}`);
          logSilentError("push_permission_denied", new Error(`receive=${perm.receive}`));
          try {
            const stale = localStorage.getItem(STORAGE_KEY);
            if (stale) {
              await api.unregisterPushToken(stale).catch(() => {});
              localStorage.removeItem(STORAGE_KEY);
            }
          } catch { /* ignore */ }
          return;
        }

        // Wire listeners BEFORE calling register so we don't miss the
        // immediate "registration" event some platforms fire.
        const regHandle = await PushNotifications.addListener(
          "registration",
          async (event) => {
            const token = event?.value;
            if (!token) {
              _writeDiag("reg_event_no_token");
              logSilentError("push_registration_no_token", new Error("event.value empty"));
              return;
            }
            _writeDiag("reg_event_received", `token_len=${token.length}`);
            try {
              await api.registerPushToken(token, detectPlatform());
              try { localStorage.setItem(STORAGE_KEY, token); } catch { /* ignore */ }
              _writeDiag("token_post_success");
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("[contour] push token register failed:", e?.message);
              _writeDiag("token_post_failed", e?.message);
              logSilentError("push_token_post_failed", e);
            }
          },
        );
        const errHandle = await PushNotifications.addListener(
          "registrationError",
          (err) => {
            // APNs / FCM refused to issue a token. Most common cause on
            // iOS: missing `aps-environment` entitlement, OR running in
            // a simulator without push capability, OR APNs unreachable.
            // eslint-disable-next-line no-console
            console.warn("[contour] push registrationError:", err);
            _writeDiag("reg_error", JSON.stringify(err));
            logSilentError("push_registration_error", err instanceof Error ? err : new Error(JSON.stringify(err)));
          },
        );
        removeListeners = () => {
          regHandle?.remove?.();
          errHandle?.remove?.();
        };

        _writeDiag("register_called");
        await PushNotifications.register();
      } catch (e) {
        // Plugin missing entirely (the IPA hasn't been rebuilt yet, OR the
        // user is on an old TestFlight build that predates the plugin
        // addition). Web users hit this path silently because the
        // isNativePlatform() gate above filters them out before we get
        // here. So any hit on this branch is a NATIVE-ONLY plugin-load
        // failure — strong signal that the IPA needs a Codemagic rebuild
        // tagged ios-v*.
        // eslint-disable-next-line no-console
        console.warn("[contour] push setup skipped:", e?.message);
        _writeDiag("setup_failed", e?.message);
        logSilentError("push_setup_failed", e);
      }
    })();

    return () => {
      cancelled = true;
      try { removeListeners(); } catch { /* ignore */ }
    };
    // Re-run on user change so signing in as a different account on the
    // same device re-registers under the new user_id. The backend's
    // INSERT-OR-UPDATE on token uniqueness handles the steal-ownership
    // semantics.
  }, [user?.id]);
}


/**
 * Best-effort unregister called from AuthContext.logout(). Reads the
 * cached token, posts unregister, clears localStorage. Safe to call
 * without a token cached (no-op).
 */
export async function unregisterCurrentDevice() {
  try {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) return;
    await api.unregisterPushToken(token).catch(() => {});
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}
