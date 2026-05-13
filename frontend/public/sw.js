/**
 * Contour service worker — caches JS/CSS bundles for instant repeat-launch.
 *
 * Cache strategies by request type:
 *   - /assets/*           (hashed, immutable)  → cache-first
 *   - HTML navigations    (/, /album/123, etc.) → network-first (so updates land)
 *   - Same-origin static  (manifest, icons)    → stale-while-revalidate
 *   - Cross-origin        (Railway API, image CDNs) → passthrough (no cache)
 *
 * Updates: on every deploy, Vite emits new hashed asset filenames. The HTML
 * (always network-fetched first) points at the new hashes, so new assets get
 * downloaded automatically. Old hashed assets stay cached unused until the
 * version-cleanup on activate purges them.
 *
 * Versioning: CACHE_VERSION below is the only manual bump needed. Increment
 * it when you ship a breaking change to *this file's* logic (e.g. a new
 * routing rule that requires re-priming caches). Asset hashes handle the
 * common case automatically.
 *
 * Kill switch: if a SW deploy breaks the app, replace this file's contents
 * with a registration.unregister() stub and ship. Old clients will pull the
 * stub on next launch and self-uninstall.
 */

const CACHE_VERSION = 'contour-v2';
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const HTML_CACHE = `${CACHE_VERSION}-html`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Install: activate immediately, no waiting for old controlled pages to close.
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Activate: clean stale caches from older versions, claim all clients.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([ASSET_CACHE, HTML_CACHE, RUNTIME_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (keep.has(k) ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Pass through cross-origin requests untouched — we never want to intercept
  // Railway API calls (auth-sensitive) or image CDN responses (already cached
  // by the browser's HTTP cache).
  if (url.origin !== self.location.origin) return;

  // Hashed assets — content-addressed, safe to cache forever.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }

  // HTML navigations — network-first so deploys land on the next refresh.
  // Cached HTML is the offline fallback.
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(req, HTML_CACHE));
    return;
  }

  // Everything else same-origin (manifest, icons, favicons, sw.js itself)
  // — return cached fast, refresh in background.
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});

// ── Strategies ──────────────────────────────────────────────────────────────

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (e) {
    return cached || Response.error();
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last-resort: serve the cached entry for / when the exact requested
    // navigation URL isn't cached. Lets SPA routes work offline.
    const rootCached = await cache.match('/');
    return rootCached || Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

// Allow the page to trigger an early activation if it wants to force the
// new SW to take over without waiting for natural app close. Currently
// unused — kept in case we add an in-app "reload to update" affordance.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
