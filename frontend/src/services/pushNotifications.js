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

const STORAGE_KEY = "contour_push_token";


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
    if (!isNativePlatform()) return;
    if (!user?.id) return;

    let cancelled = false;
    let removeListeners = () => {};

    (async () => {
      try {
        // Dynamic import keeps the web bundle from pulling the plugin in.
        // The native shell ships with the plugin compiled in via Capacitor's
        // sync step; the JS-side import resolves to the runtime stub.
        const mod = await import("@capacitor/push-notifications");
        const PushNotifications = mod.PushNotifications;
        if (!PushNotifications) return;

        const perm = await PushNotifications.requestPermissions();
        if (cancelled) return;
        if (perm.receive !== "granted") {
          // User declined the system prompt. Drop any previously-stored
          // token so we don't keep claiming to be registered.
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
            if (!token) return;
            try {
              await api.registerPushToken(token, detectPlatform());
              try { localStorage.setItem(STORAGE_KEY, token); } catch { /* ignore */ }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("[contour] push token register failed:", e?.message);
            }
          },
        );
        const errHandle = await PushNotifications.addListener(
          "registrationError",
          (err) => {
            // eslint-disable-next-line no-console
            console.warn("[contour] push registrationError:", err);
          },
        );
        removeListeners = () => {
          regHandle?.remove?.();
          errHandle?.remove?.();
        };

        await PushNotifications.register();
      } catch (e) {
        // Plugin missing (the IPA hasn't been rebuilt yet) or platform
        // refused — log + give up. Web users hit this path silently.
        // eslint-disable-next-line no-console
        console.warn("[contour] push setup skipped:", e?.message);
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
