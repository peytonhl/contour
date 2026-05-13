/**
 * Service worker registration.
 *
 * Strategy:
 *   - Register after `window load` so SW install doesn't compete with the
 *     critical render path. The first launch sees no benefit; subsequent
 *     launches load JS/CSS from disk in ~10ms.
 *   - On update available (new SW in "installing" state while there's
 *     already a controller), we don't auto-reload. The new SW will take
 *     over on next natural app cold-start (Capacitor closes + reopens,
 *     web tab refresh, etc.) — safer than yanking the page mid-session.
 *   - Skip entirely in dev (vite dev) since hot-reload + SW caching fight.
 */

export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  // Dev / non-secure contexts: don't register. SW + HMR don't mix well, and
  // SW only works on https or localhost anyway.
  if (import.meta.env.DEV) return;

  // Defer registration so it doesn't compete with the initial paint.
  // Capacitor's WebView fires `load` once the HTML is fully parsed + initial
  // scripts have run, which is exactly the gap we want SW work to fall into.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        // Non-fatal — app continues without offline caching.
        // eslint-disable-next-line no-console
        console.warn('[contour] service worker registration failed:', err);
      });
  });
}
