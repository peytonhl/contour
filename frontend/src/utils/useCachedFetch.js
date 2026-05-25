import { useEffect, useState, useCallback } from "react";

/**
 * SWR-lite cache for fetch-on-mount calls — eliminates the "loading spinner
 * every time I navigate back to this tab" experience.
 *
 * Strategy (per cache key):
 *   1. On mount, seed React state directly from the module-level cache so
 *      the first paint is instant when we have data. No "Loading…" flash
 *      for the back-to-tab case.
 *   2. If the cached entry is fresher than `freshMs`, skip the fetch
 *      entirely. The user just left this surface; the data hasn't moved.
 *   3. If stale but within `ttlMs`, render cached data immediately AND
 *      kick off a background refetch. The result swaps in silently.
 *   4. Beyond `ttlMs`, discard the cache and pay the full round-trip
 *      with the loading placeholder.
 *
 * Cache is keyed by a stable string the caller controls — typically a
 * surface name combined with the relevant entity ID (e.g.
 * `profile:reviews:{userId}`). Same key from different callers shares
 * the same entry, which is fine because the fetcher is deterministic
 * per-key.
 *
 * Origin: extracted from components/FollowingTab.jsx after the same
 * pattern was inlined there as the "tab switch Friends → Profile →
 * Friends took 5+ seconds" fix. Generalizing because that experience
 * exists everywhere we fetch on mount.
 *
 * Limits:
 *   - Module-level cache → wiped on full page reload / app launch.
 *     Don't use this for data that needs to survive across launches.
 *   - No request deduping across components. Two components mounting
 *     simultaneously with the same key fire two fetches and the later
 *     one wins the cache write. Acceptable for the SWR use case; if
 *     it ever matters we can add an in-flight Promise map.
 *   - Network errors during revalidate are SILENT. The previously
 *     cached data stays rendered. If the caller needs to surface
 *     errors, it should observe the optional `error` return.
 *
 * Returns:
 *   data:        cached or freshly-fetched value (or null while loading first time)
 *   loading:     true only when there's no usable cached data to show yet
 *   error:       most recent fetch error (cleared on success)
 *   mutate(v):   replace the cached value (use after a mutation
 *                returns the new state; saves a refetch round-trip)
 *   invalidate(): drop the cache entry entirely (next mount/visit
 *                  will full-fetch)
 *   refetch():   force a re-fetch ignoring fresh window
 */

const _caches = new Map(); // key -> { data, fetchedAt }

const DEFAULT_FRESH_MS = 60_000;       // 60s: skip fetch
const DEFAULT_TTL_MS = 5 * 60_000;     // 5min: discard cache

export function useCachedFetch(key, fetcher, opts = {}) {
  const {
    freshMs = DEFAULT_FRESH_MS,
    ttlMs = DEFAULT_TTL_MS,
    enabled = true,
  } = opts;

  // Seed from cache at construct time so the FIRST render after remount
  // already has data. Reading the cache here (not in useEffect) is what
  // makes the experience feel instant.
  const cached = key != null ? _caches.get(key) : null;
  const valid = cached && Date.now() - cached.fetchedAt < ttlMs;
  const [data, setData] = useState(valid ? cached.data : null);
  const [loading, setLoading] = useState(enabled && key != null && !valid);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || key == null) {
      setLoading(false);
      return;
    }
    const entry = _caches.get(key);
    const isValid = entry && Date.now() - entry.fetchedAt < ttlMs;
    const isFresh = entry && Date.now() - entry.fetchedAt < freshMs;

    // Reset seeded state if the key just changed AND we have a valid
    // entry for it (otherwise leave whatever was there until the
    // fetch lands).
    if (entry && isValid && data !== entry.data) {
      setData(entry.data);
    }

    if (isFresh) {
      setLoading(false);
      return;
    }

    // Stale-or-missing: revalidate. Show loading only when there's
    // no cached data to render.
    if (!isValid) setLoading(true);
    let cancelled = false;
    fetcher()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        _caches.set(key, { data: d, fetchedAt: Date.now() });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e);
        // Preserve cached data on error; only set null if we had
        // nothing to begin with.
        if (!isValid) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, freshMs, ttlMs]);

  const mutate = useCallback((newData) => {
    if (key == null) return;
    setData(newData);
    setError(null);
    _caches.set(key, { data: newData, fetchedAt: Date.now() });
  }, [key]);

  const invalidate = useCallback(() => {
    if (key == null) return;
    _caches.delete(key);
  }, [key]);

  const refetch = useCallback(async () => {
    if (!enabled || key == null) return;
    setLoading(true);
    try {
      const d = await fetcher();
      setData(d);
      setError(null);
      _caches.set(key, { data: d, fetchedAt: Date.now() });
      return d;
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { data, loading, error, mutate, invalidate, refetch };
}

/**
 * Drop every cached entry whose key starts with the given prefix.
 * Useful in mutation handlers — e.g. after follow/unfollow:
 *   invalidateCachePrefix(`user:${otherId}:`);  // their counts changed
 *   invalidateCachePrefix(`profile:following`); // my list changed
 */
export function invalidateCachePrefix(prefix) {
  for (const k of _caches.keys()) {
    if (typeof k === "string" && k.startsWith(prefix)) {
      _caches.delete(k);
    }
  }
}

/**
 * Nuke every cache entry. Call on logout so the next signed-in user
 * doesn't see the previous user's stale state.
 */
export function clearAllCaches() {
  _caches.clear();
}
