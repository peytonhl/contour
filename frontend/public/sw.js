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

// Bumped v3 → v4 (2026-05-26): user reported "Save failed: 'text/html' is
// not a valid javascript mime type" when downloading a review share card.
// Root cause: the SW's cacheFirst strategy was caching the Vercel SPA-
// fallback HTML under /assets/<chunk>.js URLs. Sequence:
//   1. Old deploy: main bundle bakes in reference to /assets/media-A.js
//   2. SW caches old main bundle (cacheFirst on /assets/)
//   3. New deploy: chunk hash rotates to media-B.js
//   4. User triggers dynamic import of @capacitor-community/media (save flow)
//   5. Cached old main bundle imports /assets/media-A.js (which no longer
//      exists in the new deploy)
//   6. Vercel rewrites all unmatched paths to /index.html (vercel.json)
//   7. SW receives 200 OK + text/html, caches it under the JS URL
//   8. Browser tries to execute HTML as JS → MIME error
//
// This bump invalidates any v3 cache entries that may be HTML-disguised-
// as-JS. Combined with the vercel.json fix (exclude /assets/ from the
// SPA rewrite — non-existent assets now 404 cleanly) and the
// Content-Type guard added to cacheFirst below, the failure mode is
// shut at every layer.
const CACHE_VERSION = 'contour-v4';
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
  if (cached) {
    // Defense in depth: a previously-cached entry under /assets/<x>.js
    // could be the Vercel SPA-fallback HTML if this code shipped before
    // the v4 bump that purged those stale entries. If the cached
    // response has the wrong Content-Type for the URL extension, evict
    // it and re-fetch fresh. This is the bug that surfaced as
    // "Save failed: 'text/html' is not a valid javascript mime type."
    if (!_responseMimeMatchesUrl(req.url, cached)) {
      cache.delete(req).catch(() => {});
    } else {
      return cached;
    }
  }
  try {
    const fresh = await fetch(req);
    // Only cache if the response Content-Type matches what the URL
    // extension implies. Stops the SPA-fallback HTML from poisoning
    // the /assets/ cache. If the asset genuinely 404s (after the
    // vercel.json rewrite fix), the fresh response will have a 4xx
    // status and we skip caching anyway via fresh.ok.
    if (fresh.ok && _responseMimeMatchesUrl(req.url, fresh)) {
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (e) {
    return cached || Response.error();
  }
}

// Returns true if the response's Content-Type is consistent with the
// extension on the URL. Used by cacheFirst to refuse caching HTML under
// JS/CSS URLs — the exact failure mode that produced the v3 → v4 bump.
// Tolerant: when in doubt (extension we don't know about, missing
// Content-Type header), returns true and trusts the response.
function _responseMimeMatchesUrl(urlStr, response) {
  let pathname = "";
  try { pathname = new URL(urlStr).pathname; } catch { return true; }
  const ct = (response.headers.get("Content-Type") || "").toLowerCase();
  if (pathname.endsWith(".js") || pathname.endsWith(".mjs")) {
    return ct.includes("javascript") || ct.includes("ecmascript");
  }
  if (pathname.endsWith(".css")) return ct.includes("css");
  if (pathname.endsWith(".json")) return ct.includes("json");
  return true;
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
