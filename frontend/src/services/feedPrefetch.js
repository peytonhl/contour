import { api } from "./api.js";

/**
 * Initial-feed prefetch: fire the very first /discover/feed request
 * BEFORE React mounts so the network round-trip overlaps with bundle
 * parse + mount + first paint.
 *
 * Without this, the cold-start waterfall is:
 *   1. HTML loads (~200-800ms on cellular)
 *   2. JS bundle downloads (~500-2000ms on cellular)
 *   3. main.jsx parses + executes (~50-150ms)
 *   4. React mounts (~50ms)
 *   5. ForYouFeed's useEffect fires fetchBatch (~50ms)
 *   6. /discover/feed network round-trip (~200-1500ms)
 *   7. setTracks → first deck card renders
 *
 * Steps 1-5 add up to ~1-3s of dead time before the user-visible
 * feed request even starts. By kicking off /discover/feed from
 * main.jsx (step 3), we overlap steps 4-6 with the same wall time
 * as 6 alone. ForYouFeed's fetchBatch consumes the in-flight
 * promise via consumeInitialFeed() instead of starting a fresh
 * request. Net: visible "Tuning your feed" duration drops from
 * ~1-2s typical to ~0-300ms typical.
 *
 * Single-shot: only fires once per app session. If the user
 * deliberately resets the deck (different code path), the existing
 * fetchBatch logic takes over.
 *
 * Mirrors the param-build logic in ForYouFeed.fetchBatch's first
 * call (append=false, attempt=0, no in-session exclusions yet).
 * Keys MUST stay in sync with the constants at the top of
 * pages/ForYouPage.jsx — they're duplicated here rather than
 * imported to avoid pulling ForYouPage's React-side code into the
 * pre-React boot path.
 */

const GENRES_KEY = "contour_genres_v1";
const HISTORY_KEY = "contour_history_v1";
const DISLIKED_KEY = "contour_disliked_v1";
const LANGUAGE_KEY = "contour_language_v1";
const ENGLISH_ONLY_KEY = "contour_english_only_v1";  // legacy boolean fallback
const SEEN_KEY = "contour_seen_v1";

let _inflight = null;
let _consumed = false;

function _readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function _loadLanguage() {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    if (v === "english" || v === "spanish" || v === "all") return v;
    // Older clients may still have the boolean key set. "false" mapped
    // to language=all back when the toggle was just english-only on/off.
    const englishOnly = localStorage.getItem(ENGLISH_ONLY_KEY);
    if (englishOnly === "false") return "all";
  } catch {}
  return "english";
}

function _buildInitialParams() {
  const history = _readJSON(HISTORY_KEY, []);
  const liked = [...new Set(
    history
      .filter((h) => h && h.rating >= 4)
      .map((h) => h && h.artistId)
      .filter(Boolean)
  )].slice(0, 5);
  const ratedSourceIds = history
    .map((h) => h && h.trackId)
    .filter(Boolean)
    .slice(0, 200);
  const genres = _readJSON(GENRES_KEY, []);
  const disliked = _readJSON(DISLIKED_KEY, []);
  const seen = _readJSON(SEEN_KEY, []).slice(0, 500);

  return {
    genres: Array.isArray(genres) ? genres.slice(0, 3) : [],
    liked_artists: liked,
    disliked_artists: Array.isArray(disliked) ? disliked : [],
    exclude: Array.from(new Set([...seen, ...ratedSourceIds])),
    language: _loadLanguage(),
    limit: 10,
  };
}

/**
 * Kick off the initial /discover/feed request. Safe to call multiple
 * times — only the first call actually fires. Subsequent calls return
 * the same in-flight promise.
 */
export function prefetchInitialFeed() {
  if (_inflight) return _inflight;
  if (_consumed) return null;
  try {
    const params = _buildInitialParams();
    _inflight = api.getDiscoverFeed(params);
    // Swallow rejection at the prefetch layer so an unhandled promise
    // rejection doesn't fire if the consumer never awaits this.
    // consumeInitialFeed's caller re-awaits and can handle the
    // rejection itself.
    _inflight.catch(() => {});
  } catch {
    _inflight = null;
  }
  return _inflight;
}

/**
 * Read-and-clear the in-flight promise. Returns null if no prefetch
 * is available (e.g. called twice, or called before prefetchInitialFeed
 * fired). Callers should `await` the returned promise inside a
 * try/catch — the prefetch may have rejected, in which case awaiting
 * it throws and the caller should fall back to a fresh fetch.
 */
export function consumeInitialFeed() {
  if (!_inflight || _consumed) return null;
  _consumed = true;
  return _inflight;
}
