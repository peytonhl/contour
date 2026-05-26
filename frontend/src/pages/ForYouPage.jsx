import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo, Component } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { analytics } from "../services/analytics.js";
import { logSilentError } from "../utils/observability.js";
import { trackPath, artistPath, albumPath } from "../constants/routes.js";

// Tier source for analytics — backend tags deezer-sourced tracks with _source,
// everything else came through Spotify (tier 1 related-artist or tier 2 genre).
// Coarser than the full tier1..tier5 enum but reflects what the data we have.
function tierSourceOf(track) {
  return track?._source === "deezer" ? "deezer" : "spotify";
}

// Stable-identity callback that always delegates to the latest version of
// `handler`. The returned function's reference is constant across renders, so
// it's safe to pass into a React.memo'd child without invalidating
// memoization — yet calls always run against the latest closure (current
// state, current refs). This is the pattern React's RFC'd `useEffectEvent`
// hook codifies; we shim it locally to avoid a dependency. Use for parent-
// side handlers passed to memoized children — NOT for handlers that need
// their identity to update (e.g. inside a useEffect dep array).
function useEvent(handler) {
  const ref = useRef(handler);
  useLayoutEffect(() => { ref.current = handler; });
  return useCallback((...args) => ref.current(...args), []);
}

import { GlobalReviewsFeed } from "../components/GlobalReviewsFeed.jsx";
import { CardPreviewModal } from "../components/CardPreviewModal.jsx";
import { MentionInput } from "../components/Mentions.jsx";
import {
  GENRE_OPTIONS,
  GENRE_OPTIONS_BASE,
  GENRE_OPTIONS_EXTENDED,
  GenreChip,
} from "../components/OnboardingModal.jsx";
// FollowingTab moved to the dedicated /friends route (FriendsPage). The
// in-page "Friends" sub-tab here was retired alongside that move so users
// have one canonical entry point to followed-user activity (bottom-nav
// Friends icon → /friends) instead of two competing surfaces.
import { SpotifyIcon, AppleMusicIcon, YouTubeIcon } from "../components/PlatformIcons.jsx";
import { AlertIcon } from "../components/Icons.jsx";
import { ACCENT_A, ACCENT_B, GOLD, DANGER } from "../theme.js";
import { consumeInitialFeed } from "../services/feedPrefetch.js";

// ── Swipe physics ────────────────────────────────────────────────────────────
// Helpers used by the touchmove/touchend handlers in ForYouFeed to make the
// deck feel less mechanical:
//
//   - snapDurationFromVelocity: short animations for hard flicks, longer for
//     slow drags. Replaces the fixed 240ms commit duration that previously
//     made hard flicks feel sluggish (the commit waited for the same 240ms
//     regardless of how hard the user threw the card).
//
//   - rubberBand: Apple's classic UIScrollView damping formula. At the deck
//     boundaries (first/last card), drag distance was previously hard-clamped
//     to zero — felt like hitting a wall. With rubber-band, the deck gives a
//     bit and then resists, exactly as iOS native scroll views do.
//
// Pure functions; standalone-tested in /tmp/swipe-physics-test.mjs before
// being imported into the deck. Don't tune these without re-running the
// test — the cubic-bezier in the wrapper transition is matched to the
// duration range below.
function snapDurationFromVelocity(absVelocityPxPerMs) {
  // Linear map over [0, 1.5] px/ms → [340, 175] ms.
  //   v=0    (slow drag past threshold) → 340ms relaxed settle
  //   v=0.25 (flick threshold)          → 312ms
  //   v=1.0  (hard flick)               → 230ms
  //   v=1.5+ (very hard)                → 175ms snappy commit
  //
  // Widened from the previous [280, 160] range because slow drags
  // at 280ms still felt rigid — neither punchy nor leisurely. The
  // longer slow-end (340ms) lets a gentle drag-past-threshold
  // commit with a real settle motion that reads as physical
  // rather than mechanical. Hard flicks barely changed (was 160,
  // now 175) so the snap still has bite when you mean it.
  const v = Math.min(Math.max(absVelocityPxPerMs, 0), 1.5);
  return Math.round(340 - v * 110);
}

function rubberBand(distance, maxStretch) {
  // f(x) = (x * c * d) / (d + c * x), c = 0.55 (Apple's UIScrollView constant).
  // Asymptotically approaches `maxStretch` as `distance` grows; monotonic;
  // f(0) = 0. The curve passes through (~maxStretch, maxStretch * 0.355).
  const c = 0.55;
  return (distance * c * maxStretch) / (maxStretch + c * distance);
}


// ── LocalStorage keys ─────────────────────────────────────────────────────────
const GENRES_KEY = "contour_genres_v1";
const HISTORY_KEY = "contour_history_v1";
const DISLIKED_KEY = "contour_disliked_v1";
const ENGLISH_ONLY_KEY = "contour_english_only_v1";  // legacy boolean key
const LANGUAGE_KEY = "contour_language_v1";          // new 3-state key
// Persistent "seen" list — every track the user has either swiped past
// OR just had displayed as the active card in the For You feed. Drives
// cross-session dedup so a user who closed the app on a track they hadn't
// rated yet doesn't see it again next launch. Capped at the most recent
// 1000 IDs (was 500) — a power user can burn through that in a session
// or two and 1000 is still cheap localStorage (~12KB) and fits in the
// exclude-param URL well under any proxy/CDN limit when we slice for
// transport.
const SEEN_KEY = "contour_seen_v1";
const SEEN_CAP = 1000;

// Genre-browse mode. When non-empty, the user has explicitly picked a set
// of genres to browse — the /feed request overrides personalization with
// these genres (equal-weight sampling, no decade pref / target popularity
// / disliked artists / excluded genres). Rated tracks are still excluded
// server-side so the user doesn't see duplicates. Cleared on "Exit browse"
// from the gear panel; persists across app launches via localStorage so a
// user who deliberately switched into "show me jazz" mode doesn't lose
// it on app close.
const BROWSE_GENRES_KEY = "contour_browse_genres_v1";
const BROWSE_GENRES_MAX = 6;  // mirrors backend cap; UX-side warning at 6

function loadBrowseGenres() {
  try {
    const v = JSON.parse(localStorage.getItem(BROWSE_GENRES_KEY) || "[]");
    return Array.isArray(v) ? v.filter(Boolean).slice(0, BROWSE_GENRES_MAX) : [];
  } catch { return []; }
}
function saveBrowseGenres(slugs) {
  try {
    if (slugs && slugs.length) {
      localStorage.setItem(BROWSE_GENRES_KEY, JSON.stringify(slugs.slice(0, BROWSE_GENRES_MAX)));
    } else {
      localStorage.removeItem(BROWSE_GENRES_KEY);
    }
  } catch {}
}

// Language filter — three modes:
//   "english" → Latin script only, no Spanish-leaning bias (default; matches
//               the old english_only=true behavior)
//   "spanish" → Latin script PLUS a Spanish-language indicator on title/artist
//   "all"     → no filter; everything shows including CJK / Cyrillic / etc.
function loadLanguage() {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    if (v === "english" || v === "spanish" || v === "all") return v;
    // Migrate from the older boolean key so existing users keep their setting.
    const legacy = localStorage.getItem(ENGLISH_ONLY_KEY);
    if (legacy === "false") return "all";
    return "english"; // default
  } catch { return "english"; }
}
function saveLanguage(val) {
  try { localStorage.setItem(LANGUAGE_KEY, val); } catch {}
}

// Soft ramp threshold — past this many ratings we hide the "rate to personalize"
// banner. Personalization itself kicks in from rating #1; this number only
// controls the banner UI, NOT whether the backend sees the user's signals.
//
// Bumped back to 5 alongside the onboarding rebuild (2026-05-14). The
// genre picker is gone — ratings are now the *only* taste signal — so the
// calibration bar carries a heavier load and 5 chunks of feedback give
// the user a clearer sense of "you're tuning this." Tier-2 of the For You
// feed (UserTasteProfile.genres) grows organically as each 4–5★ rating
// folds in the rated artist's Spotify genres.
const PERSONALIZATION_RAMP = 5;

// ── Seen-track history ────────────────────────────────────────────────────────
// Records every track the user has actively swiped past. Used by the
// exclude param on /feed requests so already-seen tracks (rated OR just
// skipped) stop reappearing in future batches — including across app
// reopens. The server-side dedup only knows about RATED tracks via the
// Rating table; this client-side list closes the gap for "swiped past
// without rating" which is the bulk of feed interactions.
function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch { return []; }
}
function markSeen(trackId) {
  if (!trackId) return;
  try {
    const prev = loadSeen();
    // Move-to-front if already present, otherwise prepend. Keeps the most
    // recently seen IDs at the front so the slice we send to the backend
    // always reflects the user's most current scroll history.
    const next = [trackId, ...prev.filter((id) => id !== trackId)].slice(0, SEEN_CAP);
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch { /* localStorage may be full or disabled */ }
}

// Reset the cross-session dedup state — user-triggered from the feed's
// settings panel via "Reset feed". The user is explicitly asking to see
// previously-skipped tracks again, so we wipe SEEN_KEY entirely. Rated
// tracks are NOT cleared (those are server-side in the Rating table,
// authoritative). Disliked artists are NOT cleared (separate "Clear
// not-interested" affordance handles that).
function clearSeen() {
  try { localStorage.removeItem(SEEN_KEY); } catch {}
}

// ── Genre prefs ───────────────────────────────────────────────────────────────
function loadGenres() {
  try { return JSON.parse(localStorage.getItem(GENRES_KEY) || "[]"); } catch { return []; }
}
function saveGenre(genre) {
  const prev = loadGenres();
  if (!prev.includes(genre)) {
    localStorage.setItem(GENRES_KEY, JSON.stringify([genre, ...prev].slice(0, 10)));
  }
}


// ── Listen / rating history ───────────────────────────────────────────────────
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}

/**
 * Record a rating in local history. Schema (v1 → v1.5 implicit upgrade):
 *   { trackId, artistId, rating, ts,
 *     name?, artist?, source?, synced? }
 *
 * The `name`, `artist`, `source` fields are new — captured so a Deezer-
 * sourced rating that initially failed to resolve to a Spotify ID can be
 * retried later (the retry needs a name+artist to search Spotify again).
 *
 * `synced` is set to true once the backend has confirmed the rating
 * landed in the DB. The orphan-backfill flow in syncOrphanedRatings()
 * uses this to skip entries that don't need re-submission.
 */
function recordRating(trackId, artistId, rating, track = null) {
  const prev = loadHistory();
  const idx = prev.findIndex((h) => h.trackId === trackId);
  const enriched = track ? {
    name: track.name,
    artist: track.artists?.[0],
    source: track._source || "spotify",
  } : {};
  if (idx >= 0) {
    prev[idx] = { ...prev[idx], ...enriched, rating, ts: Date.now(), synced: false };
  } else {
    prev.unshift({ trackId, artistId, rating, ts: Date.now(), synced: false, ...enriched });
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(prev.slice(0, 300)));
}

/** Mark a previously-recorded rating as synced to the backend.
 *  Called from handleRate after a successful api.rateEntity. */
function markRatingSynced(trackId, syncedId = null) {
  const prev = loadHistory();
  const idx = prev.findIndex((h) => h.trackId === trackId);
  if (idx < 0) return;
  prev[idx] = { ...prev[idx], synced: true, ...(syncedId ? { syncedSpotifyId: syncedId } : {}) };
  localStorage.setItem(HISTORY_KEY, JSON.stringify(prev));
}

/** Drop a rating from local history — companion to recordRating, called
 *  when the user explicitly unrates a track (misclick recovery). Without
 *  this, syncOrphanedRatings would re-submit the deleted rating on the
 *  next session and undo the user's unrate. */
function forgetRating(trackId) {
  const prev = loadHistory();
  const next = prev.filter((h) => h.trackId !== trackId);
  if (next.length !== prev.length) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }
}

const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;

/**
 * Find ratings the user made locally that never reached the backend (the
 * old "Saved ✓ but actually nothing happened" failures from before the
 * lenient _resolveSpotifyId fix) and re-submit them.
 *
 * Two paths:
 *   - Spotify-formatted local IDs: re-submit directly. Backend upserts so
 *     a duplicate is a no-op.
 *   - Deezer-formatted local IDs: only retryable if we captured the track's
 *     name + artist at rate time (new in this commit — old entries don't
 *     have them and stay orphaned).
 *
 * Runs in the background once per session. Capped at 30 attempts to keep
 * the load bounded; remaining orphans drain next session.
 *
 * Returns the count of ratings successfully synced (for analytics / debug).
 */
async function syncOrphanedRatings({ resolveSpotifyId, api, setRatingCount }) {
  const history = loadHistory().filter((h) => h.rating !== null && !h.synced);
  if (!history.length) return 0;

  // Diff against backend so we don't waste calls on ratings that ARE on
  // the server (just missing the synced flag because they were rated
  // before this code shipped).
  let savedIds = new Set();
  try {
    const profile = await api.getProfile();
    savedIds = new Set((profile?.ratings || [])
      .filter((r) => r.entity_type === "track")
      .map((r) => r.entity_id));
  } catch {
    // Can't reach the backend — skip this session, retry next.
    return 0;
  }

  // Mark anything already on the server as synced so future runs skip it.
  for (const h of history) {
    if (savedIds.has(h.trackId)) markRatingSynced(h.trackId);
    if (h.syncedSpotifyId && savedIds.has(h.syncedSpotifyId)) markRatingSynced(h.trackId);
  }

  // Find genuine orphans: in local history, not on backend.
  const orphans = history.filter((h) => {
    if (savedIds.has(h.trackId)) return false;
    if (h.syncedSpotifyId && savedIds.has(h.syncedSpotifyId)) return false;
    // Spotify-format IDs are directly retryable.
    if (SPOTIFY_ID_RE.test(h.trackId)) return true;
    // Non-Spotify IDs (Deezer numeric) need captured name+artist to retry.
    return Boolean(h.name && h.artist);
  }).slice(0, 30);

  if (!orphans.length) return 0;

  let synced = 0;
  for (const o of orphans) {
    let spotifyId = null;
    try {
      if (SPOTIFY_ID_RE.test(o.trackId)) {
        // Direct path — local ID is already a Spotify ID.
        spotifyId = o.trackId;
      } else if (o.name && o.artist) {
        // Deezer path — resolve via name + artist.
        const fakeTrack = {
          id: o.trackId,
          name: o.name,
          artists: [o.artist],
          _source: "deezer",
        };
        spotifyId = await resolveSpotifyId(fakeTrack);
      }
      if (!spotifyId) continue;
      await api.rateEntity("track", spotifyId, o.rating, o.artistId ?? null);
      markRatingSynced(o.trackId, spotifyId);
      synced++;
    } catch {
      // Skip individual failures; try again next session.
    }
    // Space out calls so we don't burst the Spotify rate limit on retries.
    await new Promise((r) => setTimeout(r, 250));
  }

  // If we synced anything, refresh the cold-start banner count.
  if (synced > 0 && setRatingCount) {
    try {
      const token = localStorage.getItem("contour_token");
      if (token) {
        const me = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.ok ? r.json() : null);
        if (me?.rating_count !== undefined) setRatingCount(me.rating_count);
      }
    } catch (e) {
      logSilentError("foryou_refresh_rating_count_after_sync", e);
    }
  }

  return synced;
}

/** Artist IDs the user has given 4–5 stars, deduped, max 5. */
function getLikedArtists() {
  return [...new Set(
    loadHistory()
      .filter((h) => h.rating >= 4)
      .map((h) => h.artistId)
      .filter(Boolean),
  )].slice(0, 5);
}

/** How many tracks the user has rated (used for cold-start gate). */
function getRatingCount() {
  return loadHistory().filter((h) => h.rating !== null).length;
}

// ── Disliked artists ──────────────────────────────────────────────────────────
// Local cache only — for logged-in users the server profile is the source of
// truth (synced via api.addArtistDislike). For logged-out users this *is*
// the source of truth, sent as the disliked_artists query param.
function loadDisliked() {
  try { return JSON.parse(localStorage.getItem(DISLIKED_KEY) || "[]"); } catch { return []; }
}
function recordDislike(artistId) {
  if (!artistId) return;
  const prev = loadDisliked().filter((a) => a !== artistId);
  // New entries go to the front so the cap evicts the oldest, not the newest.
  // The previous slice(0, 50) silently dropped every dislike past 50.
  const next = [artistId, ...prev].slice(0, 50);
  localStorage.setItem(DISLIKED_KEY, JSON.stringify(next));
}

// ── Share helper ──────────────────────────────────────────────────────────────
async function shareTrack(track) {
  const url = `${window.location.origin}${trackPath(track.id)}`;
  const title = `${track.name} · ${track.artists?.[0]}`;
  const text = `Listen to "${track.name}" by ${track.artists?.[0]} on Contour`;

  if (navigator.share) {
    try { await navigator.share({ title, text, url }); } catch { /* cancelled */ }
  } else {
    try { await navigator.clipboard.writeText(url); return true; } catch { }
  }
  return false;
}

// ── Star rating ───────────────────────────────────────────────────────────────
// Half-star picker. Mirrors components/StarRating.jsx click-position logic:
// the left half of each star = N-0.5, the right half = N. SVG with a clipped
// gold overlay so half-fill renders cleanly even on dark backgrounds.
function HalfStarSvg({ fill, size = 30 }) {
  // fill: "full" | "half" | "empty"
  const empty = "rgba(255,255,255,0.20)";
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={{ display: "block" }}>
      <defs>
        <clipPath id={`clip-half-${size}`}>
          <rect x="0" y="0" width="10" height="20" />
        </clipPath>
      </defs>
      {/* Base star (always rendered — provides outline + empty fill) */}
      <polygon
        points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7"
        fill={fill === "full" ? GOLD : empty}
      />
      {/* Half overlay: only paint the LEFT half gold when fill === "half" */}
      {fill === "half" && (
        <polygon
          points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7"
          fill={GOLD}
          clipPath={`url(#clip-half-${size})`}
        />
      )}
    </svg>
  );
}

function StarPicker({ value, onChange, disabled }) {
  const [hover, setHover] = useState(null);
  const display = hover ?? value ?? 0;

  function pick(e, starIndex) {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX ?? e.changedTouches?.[0]?.clientX ?? rect.left + rect.width) - rect.left;
    const v = x < rect.width / 2 ? starIndex - 0.5 : starIndex;
    onChange(v);
  }

  function trackHover(e, starIndex) {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setHover(x < rect.width / 2 ? starIndex - 0.5 : starIndex);
  }

  return (
    <div
      style={{ display: "flex", gap: 4, alignItems: "center", cursor: disabled ? "default" : "pointer" }}
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = display >= n ? "full" : display >= n - 0.5 ? "half" : "empty";
        return (
          <div
            key={n}
            onClick={(e) => pick(e, n)}
            onMouseMove={(e) => trackHover(e, n)}
            style={{ lineHeight: 0, padding: "2px 1px" }}
          >
            <HalfStarSvg fill={fill} size={30} />
          </div>
        );
      })}
    </div>
  );
}

// ── Audio progress bar ────────────────────────────────────────────────────────
function AudioBar({ progress }) {
  return (
    <div style={{ height: 3, borderRadius: "var(--radius-sm)", background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
      <div style={{
        height: "100%", borderRadius: "var(--radius-sm)",
        background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
        width: `${Math.min(progress * 100, 100)}%`,
        transition: "width 0.25s linear",
      }} />
    </div>
  );
}

// ── Share icon ────────────────────────────────────────────────────────────────
function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

// Row used inside the overflow action sheet. Background-only hover so taps
// feel responsive without competing with the dropdown's own glass surface.
const actionRowStyle = {
  display: "flex", alignItems: "center", gap: "var(--space-3)",
  padding: "10px 14px",
  fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.85)",
  background: "transparent", border: "none",
  borderRadius: "var(--radius)",
  cursor: "pointer", textDecoration: "none",
  textAlign: "left",
  transition: "background var(--motion-fast) var(--ease)",
};

// Error boundary for DiscoverCard. Peyton reported the feed "blacks out"
// after posting a review (2026-05-18) — symptom of an uncaught render
// exception, since React 18 unmounts the tree when no boundary is present
// and the position:fixed dark-background container stays visible. This
// catches render-side failures and shows a visible error string instead,
// so the same class of regression can never silent-fail again.
class CardErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[DiscoverCard] render exception:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: "100%",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "40px 24px", textAlign: "center",
          background: "#0a0a0a", color: "#fafafa", gap: 12,
        }}>
          <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            Something broke rendering this card.
          </p>
          <p style={{
            fontSize: 12, color: "rgba(255,255,255,0.65)",
            margin: 0, maxWidth: 320, wordBreak: "break-word", lineHeight: 1.5,
          }}>
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 12, padding: "8px 16px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 6,
              color: "#fafafa", fontSize: 13, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Retry render
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Individual discover card ──────────────────────────────────────────────────
function DiscoverCardBase({ track, isActive, onRate, onReview, onDislike, onRemoveRating, onEntityClick, userRating, cardIndex, totalCards }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  // Some Spotify/Deezer responses ship a track without album.images populated
  // (e.g. fresh releases mid-indexing). When that happens, lazily fetch the
  // album to backfill the cover so the card doesn't render as a blank tile.
  const [backfillImage, setBackfillImage] = useState(null);
  const effectiveImage = track.image_url || backfillImage;
  useEffect(() => {
    setBackfillImage(null);
    if (track.image_url || !track.album_id) return;
    let cancelled = false;
    api.getAlbum(track.album_id).then((a) => {
      if (!cancelled && a?.image_url) setBackfillImage(a.image_url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [track.id, track.image_url, track.album_id]);

  // Apple Music deep-link + hi-res artwork — fetched lazily. 404 means no
  // match / service unconfigured, in which case we just don't render the
  // button (and fall back to the Spotify image for the cover).
  //
  // For You feed tracks can come from Deezer (Spotify dropped preview URLs
  // for most tracks late 2023), in which case `track.id` is a Deezer
  // numeric ID, not a Spotify ID — and the backend's DB cache + Spotify
  // lookup both fail. We pass name + first-artist as hints so the backend
  // can still complete the match via Apple Music's text search endpoint.
  //
  // Backend now returns artwork_url alongside the deep-link URL: a 1200×1200
  // Apple Music CDN render that's noticeably sharper than Spotify's 640×640
  // ceiling on high-DPR phones. We prefer it as the cover image when
  // available, falling back to the Spotify image when not.
  const [appleMusicUrl, setAppleMusicUrl] = useState(null);
  const [appleArtworkUrl, setAppleArtworkUrl] = useState(null);
  useEffect(() => {
    setAppleMusicUrl(null);
    setAppleArtworkUrl(null);
    if (!track.id) return;
    let cancelled = false;
    const hint = { name: track.name, artist: track.artists?.[0] };
    api.getAppleMusicLink("track", track.id, "us", hint).then((data) => {
      if (cancelled) return;
      if (data?.url) setAppleMusicUrl(data.url);
      if (data?.artwork_url) setAppleArtworkUrl(data.artwork_url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [track.id, track.name, track.artists]);
  const [progress, setProgress] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewText, setReviewText] = useState("");
  // Mention IDs picked via the autocomplete in the review composer.
  // Sent to api.submitReview alongside the body so multi-word display
  // names resolve on the backend (the regex parser handles single-word
  // tokens only).
  const [reviewPickedIds, setReviewPickedIds] = useState([]);
  // After a successful review submit this holds { reviewId, spotifyId };
  // null before. Drives both the "Review posted ✓" badge AND the
  // "Share card" CTA that opens the CardPreviewModal scoped to this
  // just-posted review. spotifyId is included so the share URL can
  // deep-link to /track/<id>#review-<id> on the entity page.
  const [submittedReview, setSubmittedReview] = useState(null);
  const submitted = submittedReview !== null;
  const [shareCardOpen, setShareCardOpen] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [ratedValue, setRatedValue] = useState(userRating ?? null);
  // Replaces the previous boolean `ratingDone`. Tracks actual save state
  // end-to-end so we stop lying with an instant "Saved ✓" badge that
  // fires before the backend round-trip — which silently fails for
  // Deezer-source tracks that we can't resolve to a Spotify ID.
  //   "idle"    — never been rated by this user
  //   "saved"   — backend confirms the rating exists (or pre-existed)
  //   "saving"  — backend call in flight
  //   "failed"  — backend rejected / network error
  const [ratingStatus, setRatingStatus] = useState(userRating != null ? "saved" : "idle");
  const [copied, setCopied] = useState(false);
  // Single overflow menu replaces the previous 4-button chrome row. Closed by
  // default — keeps the cover art uncluttered. Tap-outside to dismiss.
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef(null);
  useEffect(() => {
    if (!showActions) return;
    function onDocClick(e) {
      if (actionsRef.current && !actionsRef.current.contains(e.target)) setShowActions(false);
    }
    function onEsc(e) { if (e.key === "Escape") setShowActions(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [showActions]);
  const { user } = useAuth();

  // Stop audio when card leaves view
  useEffect(() => {
    if (!isActive && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
    }
  }, [isActive]);

  // Reset state when track changes
  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    setReviewOpen(false);
    setReviewText("");
    setSubmittedReview(null);
    setShareCardOpen(false);
    setReviewError("");
    setRatedValue(userRating ?? null);
    setRatingStatus(userRating != null ? "saved" : "idle");
    setCopied(false);
  }, [track.id]);

  // Preview playback uses a real <audio> DOM element controlled via ref —
  // see the JSX below. Previously we created the audio element in JS via
  // `new Audio(...)` on first tap, but iOS WKWebView (the Capacitor shell)
  // silently rejects play() on detached audio elements: WebKit doesn't
  // treat them as user-visible media so they don't inherit the user's
  // tap gesture, even when play() runs synchronously inside an onClick.
  // Symptom on iOS: tap Play → nothing happens, no error, no console log.
  //
  // Putting a real <audio> in the DOM avoids the whole class of problem.
  // React owns the element's lifecycle so we drop the manual cleanup
  // useEffect that used to null out audioRef on track.id change.
  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[contour] audio.play() rejected:", err?.name, err?.message);
        setPlaying(false);
      });
      setPlaying(true);
      analytics.forYouTrackPlayed(tierSourceOf(track));
    }
  }

  async function handleRate(value) {
    setRatedValue(value);
    setRatingStatus("saving");
    const ok = await onRate(track, value);
    setRatingStatus(ok ? "saved" : "failed");
  }

  // Misclick recovery on the deck. Clears the local stars + status
  // immediately, then defers to the parent's onRemoveRating which
  // handles the userRatings map, local-history forget, ratingCount
  // decrement, and the backend DELETE call. We don't show a confirm
  // here — the deck card surface is already throwaway (next swipe
  // forgets it) and a confirm would feel heavy for "I tapped 4 by
  // accident."
  async function handleRemoveRatingLocal() {
    setRatedValue(null);
    setRatingStatus("idle");
    setReviewOpen(false);
    setSubmittedReview(null);
    setShowActions(false);
    if (onRemoveRating) {
      try { await onRemoveRating(track); } catch {}
    }
  }

  async function handleSubmitReview() {
    if (!reviewText.trim()) return;
    // Defensive: every state mutation inside the success branch wrapped in
    // try/catch so an exception in the post-submit re-render path can't
    // produce a black-screen / wedged-deck symptom Peyton reported 2026-05-18.
    // If anything throws, surface it in-band via reviewError instead of
    // letting React unmount the card tree silently.
    try {
      const result = await onReview(track, reviewText.trim(), ratedValue, reviewPickedIds);
      if (result?.reviewId) {
        setSubmittedReview(result);
        setReviewOpen(false);
      } else {
        // handleReview now throws labeled errors for every failure mode,
        // so reaching this fallback means the upstream contract changed
        // (e.g. someone reintroduced a return-null path) — log it loudly
        // so the next regression is caught on the first occurrence.
        setReviewError("Couldn't save. Try again.");
        logSilentError("foryou_review_submit_returned_falsy", new Error("handleReview returned non-truthy without throwing"));
      }
    } catch (e) {
      // Show the actual error message instead of a generic placeholder.
      // The labeled errors thrown by handleReview have specific copy
      // (Spotify-resolve failed, missing review ID, timeout, etc.) that
      // tells the user AND the next bug report exactly what failed.
      // logSilentError also fires so we get telemetry on the failure
      // mode without waiting for another user report.
      setReviewError(`Post failed: ${e?.message || e}`);
      logSilentError("foryou_review_submit_failed", e);
    }
  }

  async function handleShare() {
    const wasCopied = await shareTrack(track);
    if (wasCopied) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const year = track.release_date?.slice(0, 4);

  // Lock the cover URL to whichever source resolves FIRST and don't swap
  // it for the rest of the card's mount. Previously this was
  // `appleArtworkUrl || effectiveImage`, which let the Spotify URL paint
  // first and then swap to the Apple Music URL once /apple-music/match
  // resolved — causing the browser to abandon its in-flight fetch and
  // restart against a different origin. On first launch (cold cellular,
  // no cached image, no warm TLS to mzstatic) that swap produced a
  // visible glitch — the "images don't load right the first time, every
  // time" report. Locking removes the swap entirely; second launches
  // were fine before because both URLs were OS-cached.
  //
  // Trade-off: usually locks to the Spotify image (640×640) since
  // /apple-music/match is a backend roundtrip while the Spotify URL is
  // already on the track object. The deep-link button still uses the
  // Apple Music URL regardless — only the cover is locked here.
  const [lockedCover, setLockedCover] = useState(null);
  useEffect(() => { setLockedCover(null); }, [track.id]);
  useEffect(() => {
    if (lockedCover) return;
    const candidate = appleArtworkUrl || effectiveImage;
    if (candidate) setLockedCover(candidate);
  }, [appleArtworkUrl, effectiveImage, lockedCover]);
  const coverImage = lockedCover;

  return (
    <div style={{
      height: "100%",
      position: "relative", overflow: "hidden",
      background: "#0a0a0a",
    }}>
      {/* Unified card backdrop — spans the ENTIRE card so the cover
          area and metadata area share a single continuous surface.
          Pre-2026-05-25 this lived inside the cover-region div only,
          producing a visible seam at the 65% boundary: above the seam
          the backdrop had the album's blurred color/texture; below it
          the info region's flat #0a0a0a gradient. Even though both
          met at the same color at the line, the visual transition
          read as "two stacked panels" — exactly the dating-app
          comparison the user made ("they don't move together, like
          two separate pieces"). Now the blurred backdrop fills the
          whole card and the info region's bg is removed; everything
          inside is just elements floating on the same atmospheric
          surface. */}
      {coverImage && (
        <div aria-hidden style={{
          position: "absolute", inset: "-20px",
          backgroundImage: `url(${coverImage})`,
          backgroundSize: "cover", backgroundPosition: "center",
          // 24px blur (was 40px). At 40px the backdrop had no
          // high-frequency detail for the eye to track during a
          // swipe — it appeared to "smear" while the sharper cover
          // image and text moved crisply, contributing to the
          // "moving at different speeds" perception the user
          // reported. 24px still reads as atmospheric/soft but
          // preserves enough structure (album-cover edges, broad
          // color regions) for visual motion to feel coherent
          // across all layers. Saturation bumped 1.5 → 1.7 to
          // compensate for the less-aggressive blur so the
          // backdrop color still pops at the lower brightness.
          filter: "blur(24px) saturate(1.7) brightness(0.40)",
          transform: "scale(1.1)",
          zIndex: 0,
        }} />
      )}

      {/* Bottom darken — strong-enough gradient over the lower half so
          the track name / artist / stars stay readable against whatever
          color the blurred backdrop happens to be doing. Starts soft
          near the cover image's bottom edge and ramps to ~0.78 opacity
          at the card's bottom. Single linear, no hard line. Replaces
          the old "fade cover region into #0a0a0a" vignette AND the
          flat info-region bg — both did parts of this job separately
          and the boundary between them was the seam. */}
      <div aria-hidden style={{
        position: "absolute", left: 0, right: 0, top: "45%", bottom: 0,
        background: "linear-gradient(to bottom, rgba(10,10,10,0) 0%, rgba(10,10,10,0.55) 45%, rgba(10,10,10,0.85) 100%)",
        pointerEvents: "none",
        zIndex: 1,
      }} />

      {/* Album art — top 65% of the card. Now overlaid on the unified
          backdrop above (zIndex:2). The previous separate
          per-cover-region backdrop + bottom vignette have moved out
          (see above). The 65% absolute positioning is preserved to
          avoid the WKWebView flex-collapse bug (reported 2026-05-17)
          where the cover region would shrink to ~8% under repeated
          swipe animations. Explicit dimensions = no flex
          recomputation = no drift.

          EDGE-TO-EDGE COVER (2026-05-25, fourth pass) — the image is
          full-width with NO border-radius, NO box-shadow, and NO
          horizontal margins. Anchored to the TOP of the cover region
          (alignItems: flex-start) per user feedback that the empty
          backdrop band at the top — where the gear icon floats — felt
          awkward. With top-anchor the album art touches the top of the
          deck (flush against the tab header) and the gear / "···"
          chrome buttons float ON the image, matching the TikTok / Reels
          pattern where overlaid controls sit over the media. The
          remaining empty backdrop (between the bottom of the square
          image and the top of the info region) is small on phone-shape
          viewports — image height equals card width = ~50% of card
          height, leaving ~15% backdrop band below the image before the
          info section at 65%. That band reads as a soft fade into the
          metadata rather than a floating-polaroid feel.

          Trade-off vs. the previous bottom-anchor:
            • + Cover hits the top of the screen, no awkward dark band
              at the top.
            • + Cover is the dominant first impression of the card.
            • − The image no longer kisses the info-region edge; the
              boundary is now a ~15%-card-height backdrop strip. This
              IS a visible gap, but because the backdrop is the
              SAME blurred album-cover surface throughout the card
              (set on the card root with inset:-20px), the gap reads
              as continuous atmospheric color rather than two stacked
              panels. The 5% bottom-mask gradient on the image fades
              the album art into that backdrop so the boundary is a
              soft fade, not a hard line.

          Why no border-radius, no box-shadow: the previous "centered
          polaroid" treatment made the cover read as a separate UI
          element from everything else. Flat + edge-to-edge = the
          cover IS the card surface at this region; no framing. */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: "65%",
        overflow: "hidden",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        zIndex: 2,
      }}>
        {coverImage
          ? <>
              <img
                src={coverImage}
                alt={track.album_name}
                decoding="async"
                fetchpriority="high"
                style={{
                  // Full-width edge-to-edge. aspect-ratio computes the
                  // height from the width (cardWidth × cardWidth square).
                  // maxHeight: 100% safety-caps on landscape viewports
                  // where cardWidth would otherwise exceed the cover
                  // region's height.
                  width: "100%",
                  aspectRatio: "1 / 1",
                  maxHeight: "100%",
                  // No borderRadius — edge-to-edge means the image
                  // shares its sides + bottom with the card boundary
                  // and the info region. Rounded corners would
                  // reintroduce the "framed photo" perception we just
                  // removed.
                  // No boxShadow — the shadow was the polaroid-floating
                  // feel that made the cover look like a separate UI
                  // element from the info region. Without it, the
                  // cover image lives ON the same surface as everything
                  // else.
                  objectFit: "cover",
                  position: "relative", zIndex: 1,
                  // Sharper upscale on Safari. Spotify's source images cap at
                  // 640×640 and on high-DPR phones (3x) the cover renders at
                  // ~1200px target, which means the browser is upsampling.
                  // optimize-contrast nudges Safari toward a sharper filter.
                  imageRendering: "-webkit-optimize-contrast",
                  // Soft mask at the bottom 5% of the image — fades the
                  // album art into the darkened backdrop below where the
                  // info region starts. Without this, the image's bottom
                  // edge is a hard horizontal line where album-art-color
                  // meets backdrop-color, which reads as a "seam" between
                  // the cover and the metadata. With the fade, the eye
                  // can't pinpoint exactly where the cover ends and the
                  // info area begins — the card flows continuously top
                  // to bottom. 5% (~20px on a 400px-wide phone) is small
                  // enough that the visible album art barely loses any
                  // content while killing the seam. The two mask
                  // properties are kept in sync — Safari/iOS WebKit
                  // needs the -webkit- prefix.
                  maskImage: "linear-gradient(to bottom, black 0%, black 95%, transparent 100%)",
                  WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 95%, transparent 100%)",
                }}
              />
              {/* The per-cover bottom vignette that used to live here
                  has moved out to the card-root unified darken (above
                  the cover region in the JSX). With one continuous
                  backdrop spanning the whole card, the seam it was
                  patching no longer exists — the gradient at card-
                  root handles legibility for both the cover-region
                  base AND the info section beneath. */}
            </>
          : <div style={{ width: "100%", height: "100%", background: "var(--surface2)" }} />
        }

        {/* Top-right: single overflow button. Tap reveals an action sheet with
            Share + platform deep-links. Defaulting to one button instead of a
            row of four keeps the cover art uncluttered — the primary action
            on this surface is the rate gesture below, not these chrome links.
            Position indicator was here too; it's been removed (TikTok / Reels
            don't show one — swipe just flows). */}
        <div ref={actionsRef} style={{
          position: "absolute", top: 14, right: 14, zIndex: 6,
        }}>
          <button
            onClick={() => setShowActions(o => !o)}
            title="More actions"
            aria-label="More actions"
            aria-expanded={showActions}
            className="glass"
            style={{
              width: 32, height: 32, borderRadius: "50%",
              border: "none", cursor: "pointer",
              color: showActions ? "var(--accent)" : "rgba(255,255,255,0.85)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>

          {showActions && (
            <div
              role="menu"
              className="glass"
              style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0,
                minWidth: 200,
                borderRadius: "var(--radius-lg)",
                padding: "var(--space-1)",
                boxShadow: "var(--shadow-2)",
                display: "flex", flexDirection: "column",
                animation: "page-in 140ms ease both",
              }}
            >
              <button
                onClick={() => { handleShare(); setShowActions(false); }}
                style={actionRowStyle}
                role="menuitem"
              >
                <ShareIcon />
                <span>{copied ? "Copied!" : "Share"}</span>
              </button>
              {track.external_url && (
                <a
                  href={track.external_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => { analytics.spotifyLinkClicked("track"); setShowActions(false); }}
                  style={actionRowStyle}
                  role="menuitem"
                >
                  <SpotifyIcon size={16} />
                  <span>Open in Spotify</span>
                </a>
              )}
              {appleMusicUrl && (
                <a
                  href={appleMusicUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => { analytics.appleMusicLinkClicked("track"); setShowActions(false); }}
                  style={actionRowStyle}
                  role="menuitem"
                >
                  <AppleMusicIcon size={16} />
                  <span>Open in Apple Music</span>
                </a>
              )}
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.name} ${track.artists?.[0] ?? ""}`)}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setShowActions(false)}
                style={actionRowStyle}
                role="menuitem"
              >
                <YouTubeIcon size={16} />
                <span>Search on YouTube</span>
              </a>
              {/* Remove rating — only shown after the user has rated this
                  card. Misclick recovery for the swipe-and-tap-by-mistake
                  case (the rate gesture is one tap on a star, easy to
                  trigger by accident on a small screen). Hidden when
                  there's no rating to remove so the menu doesn't show
                  dead options. */}
              {ratedValue != null && (
                <button
                  onClick={() => { handleRemoveRatingLocal(); }}
                  style={{ ...actionRowStyle, color: "var(--danger)" }}
                  role="menuitem"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                  <span>Remove rating</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Info + controls — sits BELOW the cover region (top:65% =
          flush with the cover's bottom edge). The previous attempt
          (top:58%, overlaying the title onto the cover image) was
          reverted after a user report and screenshot showed albums
          with busy bottom artwork (e.g. ELASTIBOY by PlaqueBoyMax
          — track name printed on the cover next to a Parental
          Advisory sticker) made the overlaid title unreadable. Even
          with a text-shadow, our white title text competed with
          whatever the album art itself had at the bottom. Title
          visibility wins over the "title-and-cover-as-one-unit"
          perception trick — readability is non-negotiable.

          The other "one card" fixes still stand: edge-to-edge
          cover image with no boxShadow or borderRadius, anchored
          to the bottom of the cover region (touching the info
          region directly), with a 5% mask gradient at the image's
          bottom so the boundary softens into the dark backdrop
          gradient instead of being a hard line. These together
          still convey "one card" without the readability tradeoff.

          overflowY:auto inside lets long tracklist / review content
          scroll within the section without affecting the cover
          region's size.

          IMPORTANT: this section deliberately has NO own background.
          The card-root unified blurred backdrop + bottom-darken
          gradient show through here. */}
      <div style={{
        position: "absolute", top: "65%", left: 0, right: 0, bottom: 0,
        display: "flex", flexDirection: "column",
        padding: "14px 24px 12px",
        gap: 10, overflowY: "auto",
        zIndex: 3,
      }}>

        {/* Track info */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <h2 style={{
              fontSize: 20, fontWeight: 800, margin: 0,
              color: "#fff", lineHeight: 1.2, flex: 1,
              overflow: "hidden", display: "-webkit-box",
              WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              // Text shadow gives the title a clean lift over the
              // album art it now sits on top of. The bottom-darken
              // gradient handles the bulk of the contrast work, but
              // on cards with very light album art the shadow makes
              // the difference between "readable" and "ghosted".
              textShadow: "0 2px 8px rgba(0, 0, 0, 0.55)",
            }}>
              {/* Always stay in-app: resolves Deezer tracks to Spotify on
                  click and navigates to the internal track page. Falls back
                  to opening Deezer only if no Spotify equivalent exists. */}
              <a
                href={track._source === "deezer" ? track.external_url : trackPath(track.id)}
                onClick={(e) => { e.preventDefault(); onEntityClick?.(track, "track"); }}
                style={{ color: "#fff", textDecoration: "none", cursor: "pointer" }}
              >
                {track.name}
              </a>
            </h2>
            {track.explicit && (
              <span style={{ fontSize: 9, background: "rgba(255,255,255,0.15)", borderRadius: "var(--radius-sm)", padding: "2px 5px", color: "rgba(255,255,255,0.5)", fontWeight: 700, flexShrink: 0, marginTop: 2 }}>E</span>
            )}
          </div>
          <div style={{
            fontSize: 13, color: "rgba(255,255,255,0.6)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            // Same text-shadow logic as the title h2 — subtitle now
            // sits on or just below the album art so it needs the
            // same legibility boost on light covers.
            textShadow: "0 1px 4px rgba(0, 0, 0, 0.5)",
          }}>
            <a
              href={track._source === "deezer" ? "#" : artistPath(track.artist_ids?.[0])}
              onClick={(e) => { e.preventDefault(); onEntityClick?.(track, "artist"); }}
              style={{ color: "rgba(255,255,255,0.75)", fontWeight: 600, textDecoration: "none", cursor: "pointer" }}
            >
              {track.artists?.[0]}
            </a>
            {track.album_name && (track._source !== "deezer") && track.album_id && (
              <> · <Link to={albumPath(track.album_id)} style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none" }}>{track.album_name}</Link></>
            )}
            {track.album_name && (track._source === "deezer" || !track.album_id) && ` · ${track.album_name}`}
            {year && ` · ${year}`}
          </div>
        </div>

        {/* Preview player
            Spotify deprecated preview_url for most tracks in late 2023.
            We prefer the direct 30s clip when available; otherwise fall back
            to the Spotify embed (30s for non-premium, full for premium — we
            can't restrict that without violating Spotify's TOS). */}
        {track.preview_url ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Real <audio> element keyed on track.id so React fully
                replaces it when the user swipes to a new card. iOS
                WKWebView reliably plays DOM-attached audio elements
                triggered by a user tap; the previous `new Audio()`
                pattern silently failed on iOS because detached audio
                elements don't inherit user-gesture privileges.
                preload="none" keeps us from fetching the audio until
                the user actually plays it — saves bandwidth on the
                ~9 unplayed cards in every 10-card batch. */}
            <audio
              key={track.id}
              ref={audioRef}
              src={track.preview_url}
              preload="none"
              playsInline
              onTimeUpdate={(e) => {
                const cur = e.currentTarget.currentTime;
                // Cap at 30 s in case the file is longer than the preview window
                if (cur >= 30) {
                  e.currentTarget.pause();
                  setPlaying(false);
                  setProgress(1);
                  return;
                }
                setProgress(cur / 30);
              }}
              onEnded={() => { setPlaying(false); setProgress(0); }}
              onError={(e) => {
                const err = e.currentTarget.error;
                // eslint-disable-next-line no-console
                console.warn(
                  "[contour] preview audio failed to load:",
                  { code: err?.code, message: err?.message, src: e.currentTarget.src },
                );
                setPlaying(false);
              }}
            />
            <button
              onClick={togglePlay}
              style={{
                width: 44, height: 44, borderRadius: "50%",
                background: `linear-gradient(135deg, ${ACCENT_A}, ${ACCENT_B})`,
                border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, flexShrink: 0,
                boxShadow: `0 2px 12px ${ACCENT_A}50`,
                transition: "transform 0.1s",
              }}
              onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.92)"; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
            >
              {playing
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="#000" stroke="none"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="#000" stroke="none"><polygon points="5,3 19,12 5,21"/></svg>
              }
            </button>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <AudioBar progress={progress} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>30s preview</span>
            </div>
          </div>
        ) : (
          // No preview_url available (common for older/classical catalog —
          // Spotify dropped preview clips for most tracks in late 2023).
          // Previously we embedded Spotify's official iframe player here,
          // but the iframe renders its own thumbnail + title + artist row
          // INSIDE the player, duplicating the same info our card chrome
          // already shows above. On a Puccini opera card you'd see the
          // album cover + title at top, then the iframe's mini-thumbnail +
          // title pill, then the rating stars — visually redundant and
          // read as a layout bug. Replaced with a clean external-link
          // affordance that opens the track in Spotify (app on mobile,
          // web on desktop). Inline playback is lost for these tracks but
          // the cards stay readable, and tracks WITH preview_url still
          // get the inline audio player branch above.
          track.external_url && (
            <a
              href={track.external_url}
              target="_blank"
              rel="noreferrer noopener"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                alignSelf: "flex-start",
                padding: "8px 14px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "var(--radius-pill)",
                color: "rgba(255,255,255,0.85)",
                fontSize: 12, fontWeight: 600,
                textDecoration: "none",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5,3 19,12 5,21" fill="currentColor" stroke="none"/>
              </svg>
              Listen on Spotify
            </a>
          )
        )}

        {/* Rating */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {!user ? (
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>Sign in to rate</p>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <StarPicker value={ratedValue} onChange={handleRate} disabled={ratingStatus === "saving"} />
              {ratingStatus === "saving" && (
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Saving…</span>
              )}
              {ratingStatus === "saved" && (
                <span style={{ fontSize: 12, color: ACCENT_B, fontWeight: 700 }}>Saved ✓</span>
              )}
              {ratingStatus === "failed" && (
                <button
                  onClick={() => handleRate(ratedValue)}
                  title="The backend didn't accept this rating — tap to retry"
                  style={{
                    fontSize: 12, fontWeight: 600, color: "#fb7185",
                    background: "rgba(251,113,133,0.1)", border: "1px solid rgba(251,113,133,0.3)",
                    borderRadius: "var(--radius-sm)", padding: "3px 9px", cursor: "pointer",
                  }}
                >
                  Couldn't save · Retry
                </button>
              )}
            </div>
          )}
        </div>

        {/* Review trigger — the actual composer is a bottom sheet rendered
            below, outside the card's overflowY: auto section. The inline-
            form approach was unusable on mobile: when the iOS keyboard
            popped up to fill the bottom half of the screen, the Post
            button got pushed off-screen and the inner scroll competed
            with the swipe-deck container around it, so the user could
            scroll past Post but not actually tap it without losing
            position. Bottom sheet is position: fixed and iOS handles
            keyboard positioning natively for fixed elements. */}
        {user && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!submitted && (
              <button
                onClick={() => { setReviewOpen(true); setReviewError(""); }}
                style={{
                  alignSelf: "flex-start", fontSize: 12, color: "rgba(255,255,255,0.45)",
                  background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "var(--radius-sm)", padding: "5px 14px", cursor: "pointer",
                  letterSpacing: "0.01em",
                }}
              >
                Write a review
              </button>
            )}
            {submitted && (
              // Post-submit row: confirmation badge + inline Share-card CTA.
              // The share button captures the high-intent moment right after
              // posting — same modal as ReviewSection's share button so the
              // user gets the editorial-quote PNG and a Save / Share sheet.
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: ACCENT_B, fontWeight: 600 }}>Review posted ✓</span>
                <button
                  onClick={() => setShareCardOpen(true)}
                  style={{
                    fontSize: 12, color: "#000",
                    background: ACCENT_A,
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    padding: "5px 12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Share card
                </button>
              </div>
            )}
          </div>
        )}

        {reviewOpen && user && (
          <>
            {/* Backdrop — tap to dismiss. Inset 0 plus z-index above the
                swipe deck so it intercepts taps everywhere outside the
                sheet. Slight blur so the card behind reads as deprioritized. */}
            <div
              onClick={() => { setReviewOpen(false); setReviewError(""); }}
              style={{
                position: "fixed", inset: 0,
                background: "rgba(0,0,0,0.55)",
                backdropFilter: "blur(2px)",
                WebkitBackdropFilter: "blur(2px)",
                zIndex: 90,
              }}
            />
            {/* Bottom sheet. position: fixed at bottom: 0 means iOS
                automatically pushes the entire sheet up when the
                keyboard appears — the Post button stays visible. */}
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "fixed",
                left: 0, right: 0, bottom: 0,
                zIndex: 100,
                background: "#111",
                borderTop: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "var(--radius-xl) var(--radius-xl) 0 0",
                padding: "18px 20px calc(env(safe-area-inset-bottom, 16px) + 16px)",
                display: "flex", flexDirection: "column", gap: 12,
                boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
              }}
            >
              {/* Drag handle — visual cue that this is dismissible */}
              <div style={{
                width: 36, height: 4, borderRadius: "var(--radius-sm)",
                background: "rgba(255,255,255,0.2)",
                margin: "0 auto 4px",
              }} />
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 8,
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {track.name}
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {track.artists?.[0]}
                  </div>
                </div>
              </div>
              <MentionInput
                as="textarea"
                autoFocus
                value={reviewText}
                onChange={(e) => { setReviewText(e.target.value.slice(0, 2000)); setReviewError(""); }}
                onPickedUsersChange={setReviewPickedIds}
                placeholder="What did you think? Use @ to mention another user."
                rows={4}
                style={{
                  width: "100%", padding: "12px 14px", fontSize: 15,
                  background: "rgba(255,255,255,0.07)",
                  border: `1px solid ${reviewError ? `${DANGER}80` : "rgba(255,255,255,0.15)"}`,
                  borderRadius: "var(--radius)", color: "#fff", resize: "none",
                  outline: "none", boxSizing: "border-box",
                  fontFamily: "inherit", lineHeight: 1.5,
                }}
              />
              {reviewError && (
                <span style={{ fontSize: 12, color: "var(--danger)" }}>{reviewError}</span>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => { setReviewOpen(false); setReviewError(""); }}
                  style={{
                    padding: "10px 18px", borderRadius: "var(--radius-pill)", fontSize: 14,
                    background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
                    color: "rgba(255,255,255,0.65)", cursor: "pointer",
                  }}
                >Cancel</button>
                <button
                  onClick={handleSubmitReview}
                  disabled={!reviewText.trim()}
                  style={{
                    padding: "10px 24px", borderRadius: "var(--radius-pill)", fontSize: 14, fontWeight: 700,
                    background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                    border: "none", color: "#000",
                    cursor: reviewText.trim() ? "pointer" : "default",
                    opacity: reviewText.trim() ? 1 : 0.5,
                  }}
                >Post</button>
              </div>
            </div>
          </>
        )}

        {/* Bottom-pinned group: "Not interested" + swipe hint. marginTop:
            auto pushes the whole group to the bottom of the metadata strip,
            so on tall phones the dead space sits BETWEEN the rating row and
            this group rather than below it — and the swipe hint visually
            anchors to the bottom-nav above it. */}
        <div style={{
          marginTop: "auto",
          display: "flex", flexDirection: "column", gap: 6,
          alignItems: "center",
        }}>
          <button
            onClick={() => onDislike(track)}
            style={{
              fontSize: 11, color: "rgba(255,255,255,0.3)",
              background: "none", border: "none", cursor: "pointer",
              padding: "4px 10px", borderRadius: "var(--radius-sm)",
              transition: "color 0.15s", letterSpacing: "0.01em",
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.55)"}
            onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.3)"}
          >
            Not interested in {track.artists?.[0]}
          </button>

          {/* Swipe hint — shown on first card only */}
          {cardIndex === 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, opacity: 0.28 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
              <span style={{ fontSize: 11, color: "#fff", letterSpacing: "0.03em" }}>Swipe up for next</span>
            </div>
          )}
        </div>
      </div>
      {/* Card-share modal scoped to the just-posted review. Same component
          used by ReviewSection / UserPage / ProfilePage / SavedComparison —
          single source of truth for the preview-then-share UX. Captures
          the high-intent post-review moment so users share before swiping
          on to the next track. */}
      {submittedReview && (
        <CardPreviewModal
          open={shareCardOpen}
          onClose={() => setShareCardOpen(false)}
          cardUrl={`${window.location.origin}/api/og/review?id=${submittedReview.reviewId}`}
          shareUrl={`${window.location.origin}${trackPath(submittedReview.spotifyId)}#review-${submittedReview.reviewId}`}
          shareText={`${user?.display_name ?? "A Contour user"}'s review on Contour`}
          fileName={`contour-review-${submittedReview.reviewId}.png`}
        />
      )}
    </div>
  );
}

// Memo wrapper around DiscoverCard. Custom comparator skips function-prop
// identity changes — the parent recreates handleRate / handleReview /
// handleDislike / handleEntityClick on every render, but ForYouFeed passes
// them via ref-latest-closure stable refs (see `useStableRef` in ForYouFeed),
// so identity is actually stable AND the latest closure is always called.
// Comparing only the data props means a swipe (which flips dragging /
// transitioning state on the parent) no longer cascades into a re-render of
// every mounted card — only the cards whose isActive / userRating / track /
// cardIndex / totalCards actually changed do work. This is the single
// biggest commit-time perf win.
const DiscoverCard = memo(DiscoverCardBase, (prev, next) => (
  prev.track === next.track &&
  prev.isActive === next.isActive &&
  prev.userRating === next.userRating &&
  prev.cardIndex === next.cardIndex &&
  prev.totalCards === next.totalCards
  // Function props intentionally omitted — see comment above.
));

// ── Personalization-ramp progress banner ──────────────────────────────────────
// The feed adapts from rating #1; this banner just lets users see that more
// ratings = a stronger signal until they hit the ramp threshold.
//
// Segmented bar (one chunk per remaining rating) instead of a continuous fill
// because discrete chunks read as "I'm 1 of 3 done" rather than "the bar is
// 33% full" — the unit of progress matches the unit of action (one rating =
// one chunk lights up). The lit chunks carry a soft accent glow so a newly
// filled chunk reads as a small reward, not a passive state change.
// Permanent "I've graduated past cold-start" flag. Set on the first render
// where ratingCount crosses PERSONALIZATION_RAMP; checked on every subsequent
// render to ensure the banner never re-appears.
//
// Without this, the banner could come back via two paths:
//   1. Fresh device / cleared localStorage — local rating_count is 0 until
//      /auth/me lands with the server count. During that ~100-500ms window
//      the banner renders the cold-start message even though the user is
//      experienced. Race.
//   2. Future schema change that ever resets ratingCount.
// The flag is set-and-forget: written once, never cleared. Even if the
// user unrates a bunch of tracks, the banner stays gone.
const CALIBRATED_KEY = "contour_calibrated_v1";

function readCalibratedFlag() {
  try { return localStorage.getItem(CALIBRATED_KEY) === "1"; } catch { return false; }
}
function writeCalibratedFlag() {
  try { localStorage.setItem(CALIBRATED_KEY, "1"); } catch {}
}

function ColdStartBanner({ ratingCount }) {
  // Set the flag once the user has crossed the ramp. useEffect so the
  // write is post-render and not a side effect during the render phase
  // (lints cleaner, plays nice with concurrent rendering). Idempotent
  // — writeCalibratedFlag is a no-op if the key is already "1".
  useEffect(() => {
    if (ratingCount >= PERSONALIZATION_RAMP && !readCalibratedFlag()) {
      writeCalibratedFlag();
    }
  }, [ratingCount]);

  // If the user has previously crossed the calibration threshold,
  // never show the banner again — even if ratingCount momentarily
  // appears low (new device with empty local history before /auth/me
  // lands, etc.). Reported case: "I rated 5 songs and it said feed
  // calibrated. But now I go back it's asking me again to rate 5
  // songs to calibrate." The flag is sticky once set.
  if (readCalibratedFlag()) return null;

  // Visible while the user is in the cold-start band: 0..PERSONALIZATION_RAMP
  // inclusive (≤ 5). At exactly 5 the bar is full and we swap to a one-rating
  // "feed calibrated" celebration; on the 6th rating the banner is gone for
  // good. The "≤ 5" gate (rather than "< 5") is deliberate so the bar gets
  // to visibly reach 5/5 before disappearing — fades to nothing on a fill
  // moment feels better than vanishing mid-stride.
  if (ratingCount > PERSONALIZATION_RAMP) return null;
  const remaining = PERSONALIZATION_RAMP - ratingCount;
  const label = ratingCount === 0
    ? "Rate 5 tracks to calibrate your feed"
    : ratingCount >= PERSONALIZATION_RAMP
      ? "Feed calibrated — keep rating to refine"
      : remaining === 1
        ? "One more to dial it in"
        : `${ratingCount} of ${PERSONALIZATION_RAMP}: feed is sharpening`;

  return (
    <div style={{
      // LEFT padding 54px to clear the floating gear button (top:8 left:10,
      // 32px wide → right-edge at 42px + 12px breathing room). Comment
      // here used to claim the RIGHT padding was for the gear, but the
      // gear actually sits at LEFT — this was stale from before a
      // gear-position change. Screenshot showed the gear circle
      // overlapping the first progress segment and the leading edge of
      // the label, leaving the user with a chopped-off "Rate 5 tracks
      // to calibrate your feed" line. Standard 16px on the right.
      padding: "8px 16px 8px 54px",
      background: "rgba(217,122,59,0.08)",
      borderBottom: "1px solid rgba(217,122,59,0.15)",
      display: "flex", alignItems: "center", gap: 10,
      flexShrink: 0,
    }}>
      {/* Segmented progress — one chunk per rating up to the ramp. Filled
          chunks are solid amber (the brand accent); the old amber→cobalt
          gradient leaked entity-B color into a brand surface where it
          didn't carry the "side B in Compare" semantic that color is
          reserved for. */}
      <div style={{ flex: 1, display: "flex", gap: 4, height: 5 }}>
        {Array.from({ length: PERSONALIZATION_RAMP }, (_, i) => {
          const filled = i < ratingCount;
          return (
            <div
              key={i}
              style={{
                flex: 1, borderRadius: "var(--radius-sm)",
                background: filled ? ACCENT_A : "rgba(255,255,255,0.1)",
                boxShadow: filled ? `0 0 6px ${ACCENT_A}80` : "none",
                transition: "background 0.35s ease, box-shadow 0.35s ease",
              }}
            />
          );
        })}
      </div>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap", flexShrink: 0, fontWeight: 600 }}>
        {label}
      </span>
    </div>
  );
}

// ── For You scroll feed ───────────────────────────────────────────────────────
function ForYouFeed() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [userRatings, setUserRatings] = useState({});
  // For signed-in users, prefer the authoritative server count (covers ratings
  // made via album/track pages, not just For You feed). Falls back to the
  // local-storage history count for signed-out users / before /me lands.
  const [ratingCount, setRatingCount] = useState(() => {
    return (user?.rating_count !== undefined ? user.rating_count : getRatingCount());
  });
  useEffect(() => {
    if (user?.rating_count !== undefined) setRatingCount(user.rating_count);
  }, [user?.rating_count]);
  const [language, setLanguage] = useState(loadLanguage);
  const languageRef = useRef(loadLanguage());
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Genre-browse mode state. browseGenres = currently-applied selection
  // (drives fetchBatch). Ref companion for the inside-effect read in
  // fetchBatch so a stale closure doesn't send last-render's selection.
  // pickerOpen, pendingPicks, showExtendedGenres are picker UI state —
  // pendingPicks is the in-progress selection inside the picker, kept
  // separate from the applied browseGenres so Cancel can discard.
  const [browseGenres, setBrowseGenres] = useState(() => loadBrowseGenres());
  const browseGenresRef = useRef(browseGenres);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingPicks, setPendingPicks] = useState([]);
  const [showExtendedGenres, setShowExtendedGenres] = useState(false);
  const containerRef = useRef(null);
  const genresRef = useRef(loadGenres());
  const fetchingMoreRef = useRef(false);
  // Continuous recalibration counter: how many ratings the user has made
  // in THIS session. When this hits a multiple of RECALIBRATE_EVERY, the
  // feed refreshes its unseen queue with the latest taste signal so the
  // user starts feeling the personalization within the same scroll
  // instead of waiting for the prefetch boundary 10 tracks out.
  //
  // Session-only (not total ratingCount) so a returning user with 47 prior
  // ratings doesn't immediately refresh on the first /auth/me sync.
  const sessionRatingsRef = useRef(0);
  const RECALIBRATE_EVERY = 5;

  async function fetchBatch(append = false, attempt = 0) {
    if (append && fetchingMoreRef.current) return;
    if (append) fetchingMoreRef.current = true;

    const setter = append ? setLoadingMore : setLoading;
    setter(true);
    setFetchError(false);

    // First-batch shortcut: main.jsx kicks off the initial
    // /discover/feed request before React mounts (see
    // services/feedPrefetch.js). By the time this useEffect-driven
    // fetchBatch fires, the response is either in flight or already
    // resolved — consume it instead of running a redundant fetch.
    // Only applies to the very first call (not append, not retry).
    // If the prefetch errored or returned empty, fall through to
    // the normal fetch path below.
    if (!append && attempt === 0) {
      const prefetched = consumeInitialFeed();
      if (prefetched) {
        try {
          const batch = await prefetched;
          if (Array.isArray(batch) && batch.length > 0) {
            setTracks(batch);
            setActiveIdx(0);
            setLoading(false);
            return;
          }
          // Empty batch — let the normal fetch path retry without
          // the disliked filter (attempt=1).
          setter(false);
          await new Promise((r) => setTimeout(r, 1500));
          return fetchBatch(false, 1);
        } catch {
          // Prefetch failed — fall through to a fresh fetch.
        }
      }
    }

    try {
      // Soft ramp: send everything we have, from rating #1. The backend
      // already handles the empty-signal case by falling through to baseline
      // tiers, so there's no upside to gating on the client.
      const likedArtists = getLikedArtists();
      // On retry (attempt >= 1) skip the disliked filter — the user may have
      // marked so many artists as "not interested" that nothing is left.
      // (For logged-in users this only affects the local cache; the server
      // profile dislikes are still applied — but the nuclear-fallback tier
      // on the backend handles that case.)
      const dislikedArtists = attempt === 0 ? loadDisliked() : [];
      // Tell the backend which tracks to exclude from this batch. Three
      // sources, merged + deduped:
      //
      //   1. Past-seen track IDs (the new SEEN_KEY localStorage). Captures
      //      every card the user has swiped past — whether they rated it,
      //      disliked it, or just skipped. Persists across app reopens, so
      //      a user who scrolls past 50 chart-toppers today doesn't see the
      //      same 50 again tomorrow. This is the primary repeat-prevention
      //      mechanism; the server-side Rating-table dedup only covers
      //      rated tracks, not skipped ones.
      //
      //   2. Past-rated source IDs (from HISTORY_KEY). The server-side
      //      Rating table stores the *resolved Spotify ID* for every
      //      rating — but a Deezer-sourced rating's original numeric ID
      //      isn't there, so the same song coming back from the Deezer
      //      chart wouldn't be filtered server-side. Sending history.trackId
      //      (the source-native ID at rate time) closes that gap.
      //
      //   3. In-session shown tracks (append=true only) — prevents
      //      prefetch from repeating tracks visible in the same scroll
      //      session when the Deezer chart cache is still warm.
      //
      // Cap to keep the URL bounded: ~12 chars per ID + comma. 500 seen +
      // 200 rated + 80 in-session = max ~780 IDs ≈ 9.4KB serialized, still
      // well under any proxy/CDN limit. Bumped from 250/150 alongside the
      // active-card-mark-seen fix so users with longer histories don't get
      // chart-toppers re-surfacing once they push past the old 250 window.
      // dedup via Set means overlap (a seen+rated track) only counts once.
      const seenIds = loadSeen().slice(0, 500);
      const ratedSourceIds = loadHistory()
        .map((h) => h.trackId)
        .filter(Boolean)
        .slice(0, 200);
      const inSession = append
        ? tracks.slice(-80).map((t) => t.id).filter(Boolean)
        : [];
      const sessionExclude = Array.from(new Set([
        ...seenIds, ...ratedSourceIds, ...inSession,
      ]));

      // One-shot fresh-feed bypass: set by TasteProfilePage's "Open fresh
      // feed" button via localStorage. Forces the server to ignore the
      // user's personalization for this batch. Consumed on read so it
      // doesn't persist across batches — fresh-feed is intentionally
      // a one-session affordance, not a permanent setting.
      let freshOnce = false;
      try {
        if (localStorage.getItem("contour_fresh_feed_once") === "1") {
          freshOnce = true;
          localStorage.removeItem("contour_fresh_feed_once");
        }
      } catch {}

      const batch = await api.getDiscoverFeed({
        genres: genresRef.current.slice(0, 3),
        liked_artists: likedArtists,
        disliked_artists: dislikedArtists,
        exclude: sessionExclude,
        language: languageRef.current,
        limit: 10,
        fresh: freshOnce,
        // When non-empty, the server bypasses personalization in favor
        // of an equal-weight sample from these genres. Rated tracks are
        // still excluded server-side so the user doesn't see duplicates.
        // Ref read (not state) so a fetch initiated mid-render sees the
        // freshest selection.
        genre_browse: browseGenresRef.current || [],
      });

      // If Spotify returned empty, retry once ignoring disliked filter
      if (batch.length === 0 && !append && attempt === 0) {
        setter(false);
        await new Promise((r) => setTimeout(r, 1500));
        return fetchBatch(false, 1);
      }

      if (batch.length === 0 && !append) {
        // Auto-diagnose: fetch debug info to show user what's broken
        api.getDiscoverDebug().then(setDebugInfo).catch(() => {});
      }
      setTracks((prev) => append ? [...prev, ...batch] : batch);
    } catch {
      if (!append) {
        setFetchError(true);
        api.getDiscoverDebug().then(setDebugInfo).catch(() => {});
      }
    } finally {
      setter(false);
      if (append) fetchingMoreRef.current = false;
    }
  }

  function clearNotInterested() {
    localStorage.removeItem(DISLIKED_KEY);
    // Best-effort server clear for logged-in users — failure is non-fatal,
    // they just see their server-side dislikes again on the next fetch.
    if (user) api.clearArtistDislikes().catch(() => {});
    fetchBatch();
  }

  function setLanguagePref(val) {
    if (val === languageRef.current) return;
    saveLanguage(val);
    languageRef.current = val;
    setLanguage(val);
    setTracks([]);
    setActiveIdx(0);
    fetchBatch();
  }

  // Continuous recalibration: trim the unseen queue past the current card
  // and append a fresh batch built from the latest taste signal. The
  // currently-active track and anything the user already swiped past stay
  // put — the refresh is invisible to where the user is right now, but
  // their *next* card reflects the ratings they just gave.
  //
  // Triggered from handleRate when sessionRatingsRef hits a multiple of
  // RECALIBRATE_EVERY. Keep this distinct from the contour:taste-updated
  // event handler (which fully resets activeIdx to 0) — that's for
  // discrete state changes like the onboarding genre save; this is for
  // the ambient "every 5 ratings the feed sharpens a little" loop.
  async function recalibrate() {
    setTracks((prev) => prev.slice(0, activeIdx + 1));
    await fetchBatch(true);
  }

  // User-triggered "I'm seeing the same songs" escape hatch. Wipes the
  // cross-session SEEN_KEY (and the current queue) and refetches. Rated
  // tracks stay excluded server-side via the Rating table; only the
  // skipped-but-not-rated history gets cleared. Closes the settings panel
  // so the user lands on a fresh card without an interim chrome state.
  function resetFeed() {
    clearSeen();
    setSettingsOpen(false);
    setTracks([]);
    setActiveIdx(0);
    fetchBatch();
  }

  // ── Genre-browse handlers ──────────────────────────────────────────────────
  // Open the in-panel genre picker. Seed the in-progress selection with
  // whatever's currently applied so the user can tweak instead of
  // restarting from scratch.
  function openPicker() {
    setPendingPicks([...browseGenres]);
    setPickerOpen(true);
    setShowExtendedGenres(false);
  }

  // Toggle a genre slug in/out of the in-progress selection. Cap at
  // BROWSE_GENRES_MAX (mirrors the server's cap) — silently no-op on
  // attempts past the cap; the Apply button's count label warns at the
  // edge.
  function togglePick(slug) {
    setPendingPicks((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= BROWSE_GENRES_MAX) return prev;
      return [...prev, slug];
    });
  }

  // Cancel the picker without committing the selection. browseGenres
  // (the applied list) is untouched.
  function cancelPicker() {
    setPickerOpen(false);
    setShowExtendedGenres(false);
    setPendingPicks([]);
  }

  // Apply the picker selection: commits to localStorage + the ref +
  // state, closes the panel, and refetches a clean batch from the
  // browse-mode feed.
  function applyBrowseGenres() {
    if (pendingPicks.length === 0) return;
    const slugs = pendingPicks.slice(0, BROWSE_GENRES_MAX);
    saveBrowseGenres(slugs);
    browseGenresRef.current = slugs;
    setBrowseGenres(slugs);
    setPickerOpen(false);
    setShowExtendedGenres(false);
    setPendingPicks([]);
    setSettingsOpen(false);
    setTracks([]);
    setActiveIdx(0);
    // Drop SEEN history too — when the user explicitly switches into
    // browse mode, they're starting a fresh exploration of that genre
    // and shouldn't have to scroll past already-seen tracks from their
    // personalized feed to get there.
    clearSeen();
    fetchBatch();
  }

  // Exit browse mode. Restores the personalized feed by clearing the
  // applied selection. SEEN history is preserved so the user doesn't
  // suddenly see tracks they swiped past while in browse mode reappear
  // in their main feed.
  function exitBrowseMode() {
    saveBrowseGenres([]);
    browseGenresRef.current = [];
    setBrowseGenres([]);
    setSettingsOpen(false);
    setTracks([]);
    setActiveIdx(0);
    fetchBatch();
  }

  useEffect(() => { fetchBatch(); }, []);

  // Mark the active card as seen as soon as it's displayed. Previously
  // only the LEAVING track got marked on a swipe, which meant the
  // currently-viewed card never made it into SEEN_KEY if the user closed
  // the app while looking at it. That created a "same songs over and over"
  // feeling on session restart because the active-but-not-yet-swiped card
  // kept reappearing. markSeen dedups against the existing list so this
  // is safe to fire on every active-id change.
  const activeTrackId = tracks[activeIdx]?.id;
  useEffect(() => {
    if (activeTrackId) markSeen(activeTrackId);
  }, [activeTrackId]);

  // Refetch when taste signals change mid-session — primarily fired by
  // OnboardingModal after the genre picker saves. Without this, a new user
  // who finishes onboarding keeps seeing the cold-start batch they got on
  // initial mount until they scroll ~10 tracks to the prefetch boundary.
  // Also rehydrates genresRef from localStorage so the next fetchBatch sees
  // the new picks (the ref only updates on rating events otherwise).
  useEffect(() => {
    function handler() {
      genresRef.current = loadGenres();
      setTracks([]);
      setActiveIdx(0);
      fetchBatch();
    }
    window.addEventListener("contour:taste-updated", handler);
    return () => window.removeEventListener("contour:taste-updated", handler);
  }, []);

  // Background backfill of orphaned ratings — see syncOrphanedRatings().
  // Runs once per mount after a short delay so the initial feed render
  // isn't competing for network with the backfill API calls. Capped at
  // 30 attempts per session inside the helper.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      try {
        const synced = await syncOrphanedRatings({
          resolveSpotifyId: _resolveSpotifyId,
          api,
          setRatingCount,
        });
        if (synced > 0) {
          // eslint-disable-next-line no-console
          console.info(`[contour] Backfilled ${synced} orphaned rating${synced === 1 ? "" : "s"} to server.`);
        }
      } catch (e) {
        logSilentError("foryou_orphan_rating_backfill", e);
      }
    }, 3000);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [user?.id]);

  // ── Tinder-style swipe deck ─────────────────────────────────────────────
  // Cards are absolutely positioned at -100% / 0 / 100% of the container
  // height. During a drag, all three translate together by dragOffset px;
  // on release with a sufficient swipe, the deck animates to ±cardHeight
  // and then commits an activeIdx change with the transition momentarily
  // disabled, so the swap is visually seamless and only ONE card occupies
  // the viewport at any settled time. Replaces the previous scroll-based
  // implementation, which always showed a seam between adjacent cards
  // mid-transition (the "Write a review / Not interested" peek-through
  // the user reported).
  // dragOffset is a REF, not state — the drag delta drives a transform
  // applied directly to the wrapper's DOM node. The previous useState version
  // triggered a full ForYouFeed re-render on every touchmove (60–120 Hz on
  // iOS ProMotion), which cascaded into all mounted DiscoverCard children
  // and dropped frames mid-swipe. The handlers below write to
  // `wrapperRef.current.style.transform` directly, and a useLayoutEffect
  // keeps the DOM transform in sync whenever activeIdx / dragging change.
  // Stored as a PERCENT of cardHeight (same units the wrapper uses).
  const dragOffsetRef = useRef(0);
  // `dragging` true → CSS transition disabled (finger follow + atomic commit
  // reset). False → 280ms ease for the snap animation.
  const [dragging, setDragging] = useState(false);
  // Latched true while the snap animation is running so new touchstarts
  // don't interrupt mid-flight.
  const [transitioning, setTransitioning] = useState(false);
  // Snap animation duration in ms — variable so hard flicks resolve faster
  // than slow drags past threshold. Set by touchend / advance based on the
  // gesture's exit velocity (see snapDurationFromVelocity). Default 240 is
  // the mid-range value the previous fixed-duration version used so the
  // first ever render (before any touch) feels familiar.
  const [snapDuration, setSnapDuration] = useState(240);
  // The deck container's current pixel height. We render all transforms in
  // pixels (not calc(N * 100%)) because iOS WebView occasionally rounds %
  // transforms differently from JS-measured clientHeight — that fractional
  // mismatch was causing a 0.5-1px snap at the commit moment, perceived as
  // a tiny jitter between songs. With pure pixel arithmetic the wrapper's
  // pre-commit and post-commit transform values are bitwise identical.
  //
  // Initialize with a sensible estimate (full viewport height) so the very
  // first render isn't computed against cardHeight=0 — that produced an
  // ugly cascade where (a) all three cards stacked at y=0 making the user
  // briefly see the LAST-rendered card (card 1) instead of the active card
  // (card 0), and (b) the cover img sized from maxHeight: 94% of 0 = 0 and
  // then grew to full size once cardHeight was measured ("picture enlarges
  // visibly"). The useLayoutEffect below refines the estimate to the actual
  // measured container height before paint.
  const [cardHeight, setCardHeight] = useState(() => (
    typeof window !== "undefined" ? window.innerHeight : 800
  ));
  const cardHeightRef = useRef(0);

  // Measure card height before paint. useLayoutEffect (not useEffect) is
  // critical here — it fires synchronously between the React commit and
  // the browser paint, so the user never sees a frame computed against
  // the initial estimate vs the precise measurement.
  useLayoutEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const h = containerRef.current.clientHeight;
        cardHeightRef.current = h;
        setCardHeight(h);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Treat touches starting on textareas/inputs as native interactions
  // (focus, scroll inside the textarea) — never as deck swipes.
  function isInteractiveTarget(el) {
    let node = el;
    while (node && node !== containerRef.current) {
      const tag = node.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return true;
      node = node.parentElement;
    }
    return false;
  }

  const touchStartRef = useRef(null);
  function handleTouchStart(e) {
    if (transitioning) return;
    if (e.touches.length !== 1) return;
    if (isInteractiveTarget(e.target)) return;
    touchStartRef.current = { y: e.touches[0].clientY, t: Date.now() };
    setDragging(true);
  }
  function handleTouchMove(e) {
    const start = touchStartRef.current;
    if (!start) return;
    let dy = e.touches[0].clientY - start.y;
    const h = cardHeightRef.current || containerRef.current?.clientHeight || 800;
    // Rubber-band at the deck boundaries (was a hard clamp to 0). At the
    // first / last card, the user can pull a bit in the over-scroll
    // direction and feel resistance — same UIScrollView curve iOS uses
    // everywhere. Max stretch is 30% of card height, which feels
    // generous-enough to be felt but tight-enough that the deck can't be
    // dragged dramatically off-center. Without this, the deck stopped dead
    // when you tried to swipe back from card 0 — read as "broken" rather
    // than "end of list."
    const maxStretch = h * 0.3;
    if (activeIdx === 0 && dy > 0) {
      dy = rubberBand(dy, maxStretch);
    } else if (activeIdx >= tracks.length - 1 && dy < 0) {
      dy = -rubberBand(-dy, maxStretch);
    }
    // Convert finger-px to %-of-cardHeight at touchmove time so the wrapper
    // transform can be pure %. Mixing % and px in the calc() expression
    // caused a subpixel mismatch: `100%` resolves to the wrapper's rendered
    // (potentially fractional) height, while JS-measured cardHeight is the
    // integer clientHeight. The 0.5px gap was the "snaps too low / auto-
    // adjusts higher" overshoot at the commit moment.
    dragOffsetRef.current = (dy / h) * 100;
    // Direct DOM write — bypasses React reconciliation entirely so we keep
    // 60–120 fps on iOS even with heavy DiscoverCard children mounted.
    const w = wrapperRef.current;
    if (w) {
      w.style.transform =
        `translate3d(0, ${-activeIdx * 100 + dragOffsetRef.current}%, 0)`;
    }
  }
  function handleTouchEnd(e) {
    const start = touchStartRef.current;
    // No pending drag → don't touch state. This is the path taken when
    // a touchstart was skipped (transition in flight, multi-touch, etc.).
    // The previous version reset dragOffset here, which interrupted any
    // in-flight snap animation — the user would see the wrapper bounce
    // back to 0 and then jump to the next card when the commit timer
    // fired 290ms later. That was the "jumping back and forth that
    // doesn't stop" jitter when fingers grazed the screen mid-swipe.
    if (!start) return;
    touchStartRef.current = null;

    const endY = e.changedTouches[0].clientY;
    const dy = endY - start.y;
    const dt = Math.max(1, Date.now() - start.t);
    const velocity = Math.abs(dy / dt);

    // Looser commit thresholds (was 50px / 0.35 px/ms). At 50px users
    // had to drag a deliberate ~6-7% of the card before the swipe
    // would commit, which felt like the deck "resisted" the gesture —
    // a textbook mechanical-feeling characteristic. 40px is small
    // enough to commit on a confident-but-not-aggressive drag, and
    // a 0.25 flick velocity means a quick wrist motion is enough
    // even when the finger barely moves.
    const SWIPE_PX = 40;
    const FLICK_VEL = 0.25;

    if (dy < -SWIPE_PX || (dy < 0 && velocity >= FLICK_VEL)) {
      // Set the velocity-responsive snap duration BEFORE calling advance.
      // Both setState calls (this one + the setTransitioning/setDragging
      // inside advance) batch into one render so the JSX picks up the
      // new duration before the CSS transition begins.
      setSnapDuration(snapDurationFromVelocity(velocity));
      advance(1);
    } else if (dy > SWIPE_PX || (dy > 0 && velocity >= FLICK_VEL)) {
      setSnapDuration(snapDurationFromVelocity(velocity));
      advance(-1);
    } else {
      // Sub-threshold — animate back to 0. dragOffsetRef goes to 0 BEFORE
      // toggling dragging so the useLayoutEffect (which runs after the
      // re-render) writes the resting transform. With dragging=false the
      // CSS transition is enabled, so the browser animates from the current
      // drag-offset position to 0. Slightly longer snap-back duration
      // (220ms) because the gesture didn't commit — gives an unhurried
      // "settle" feel rather than a jerk back.
      setSnapDuration(220);
      dragOffsetRef.current = 0;
      setDragging(false);
    }
  }

  // Ref on the wrapper element so we can listen for its transitionend
  // event and commit at the exact moment the snap animation completes —
  // setTimeout-based commit was firing at ~95-98% of the animation, so
  // the React commit was applying its end-state value while the CSS
  // animation hadn't quite reached its end. iOS WebView then snapped
  // the wrapper from where it was to the commit value, which the user
  // perceived as "card undershoots then settles back."
  const wrapperRef = useRef(null);

  // Keep the wrapper's DOM transform in sync with React state. The transform
  // is NOT in the JSX inline style anymore — putting it there caused every
  // touchmove to round-trip through a React render, which dropped frames on
  // iOS WKWebView. Instead, touchmove writes `style.transform` directly, and
  // this effect re-applies the composed transform whenever activeIdx flips
  // (commit) or dragging toggles (touchstart / sub-threshold release /
  // advance). useLayoutEffect runs synchronously after the React commit and
  // before paint, so the user never sees a frame computed against stale
  // state. Since React does fine-grained style reconciliation (only diffs
  // properties present in the style prop), removing `transform` from the
  // JSX means React leaves our direct-write transform alone.
  useLayoutEffect(() => {
    const w = wrapperRef.current;
    if (!w) return;
    w.style.transform =
      `translate3d(0, ${-activeIdx * 100 + dragOffsetRef.current}%, 0)`;
  }, [activeIdx, dragging, transitioning]);

  function advance(direction) {
    if (transitioning) return;
    const target = activeIdx + direction;
    if (target < 0 || target >= tracks.length) {
      dragOffsetRef.current = 0;
      setDragging(false);
      // STUCK-AT-END recovery: a forward swipe that has nowhere to go
      // (target >= tracks.length) was previously a silent no-op. If the
      // initial batch came back thin (1-2 tracks — common right after the
      // v7 pool-cache invalidation or for users with aggressive filters),
      // the user got stuck on card 0 forever because the normal prefetch
      // path (inside commit() at advance success) never fired. Trigger a
      // background fetch here so the next swipe attempt has cards.
      // fetchingMoreRef inside fetchBatch prevents overlapping fetches.
      if (direction === 1) fetchBatch(true);
      return;
    }
    // Set the snap target on the ref BEFORE flipping dragging false — the
    // useLayoutEffect that writes the transform reads `dragOffsetRef.current`
    // and runs after React's render. One full card height = 100% (same units
    // as the wrapper's resting position).
    dragOffsetRef.current = direction === 1 ? -100 : 100;
    setTransitioning(true);
    setDragging(false);                                 // enable CSS transition

    // Commit atomically when the transition actually finishes — not on a
    // pre-set timer. transitionend fires the frame the wrapper's transform
    // reaches its target value, so there's no animated-but-incomplete
    // state to interrupt.
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      setDragging(true);
      // Mark the LEAVING track as seen — only on forward swipes. Back
      // swipes are usually the user looking again at something they
      // already saw, so leaving-them-seen would double-count and add
      // no information. Forward-swipe past = "this card is done; don't
      // show it to me again."
      if (direction === 1 && tracks[activeIdx]?.id) {
        markSeen(tracks[activeIdx].id);
      }
      // Reset the drag ref before committing the new activeIdx — the
      // useLayoutEffect runs after the re-render and writes
      // `translate3d(0, -target*100 + 0 %, 0)`, which is mathematically
      // identical to where the snap animation just landed
      // (-activeIdx*100 + ±100 = -(activeIdx±1)*100). Visually seamless.
      dragOffsetRef.current = 0;
      setActiveIdx(target);
      setTransitioning(false);
      if (direction === 1 && target >= tracks.length - 4) {
        fetchBatch(true);
      }
    };

    const wrapper = wrapperRef.current;
    if (wrapper) {
      const onEnd = (e) => {
        // Only commit on the wrapper's own transform transitionend —
        // ignore events from descendant elements that happen to bubble.
        if (e.target !== wrapper) return;
        if (e.propertyName !== "transform") return;
        wrapper.removeEventListener("transitionend", onEnd);
        commit();
      };
      wrapper.addEventListener("transitionend", onEnd);
      // Safety fallback in case transitionend never fires (transition got
      // cancelled by an intervening style change, etc.). Computed off
      // snapDuration with a 200ms margin so it ALWAYS exceeds the longest
      // possible commit animation (max ~280ms + 200ms = 480ms). Previously
      // hardcoded 400ms, which was fine when duration was fixed at 240ms;
      // now that duration is velocity-responsive, the fallback needs to
      // scale with it. The +200ms cushion absorbs frame-timing jitter on
      // older devices without making the recovery sluggish on real
      // transitionend failures.
      setTimeout(() => {
        wrapper.removeEventListener("transitionend", onEnd);
        commit();
      }, snapDuration + 200);
    } else {
      // Fallback for the very first render before the ref is wired up.
      setTimeout(commit, 300);
    }
  }

  // Programmatic navigation (keyboard arrows, deep-link, etc.). One-step
  // moves use the same animation as a swipe; multi-step jumps skip the
  // animation entirely so they don't feel like a long swipe.
  const goToCard = useCallback((idx) => {
    if (idx < 0 || idx >= tracks.length) return;
    if (transitioning) return;
    if (idx === activeIdx) return;
    if (Math.abs(idx - activeIdx) > 1) {
      setActiveIdx(idx);
      return;
    }
    advance(idx > activeIdx ? 1 : -1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, tracks.length, transitioning]);

  // Keyboard arrow navigation
  useEffect(() => {
    function onKey(e) {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        goToCard(activeIdx + 1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        goToCard(activeIdx - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIdx, goToCard]);

  // Desktop wheel-to-advance — without this, desktop users had only arrow
  // keys to navigate (no visible hint that arrow keys did anything), so the
  // natural "scroll down to see more" instinct produced nothing-happens-on-
  // scroll which reads as "the deck is stuck." Mouse wheel + trackpad both
  // fire `wheel` events; touch swipes don't, so mobile isn't affected.
  //
  // Throttled to one advance per ~350ms — without this, a single trackpad
  // gesture (which emits many small wheel events) would advance five cards
  // at once. The minimum-delta gate filters out trackpad inertia tail-off
  // that would otherwise re-trigger advancement after the user stopped
  // actively scrolling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastAdvance = 0;
    function onWheel(e) {
      if (transitioning) return;
      if (Math.abs(e.deltaY) < 8) return;
      const now = Date.now();
      if (now - lastAdvance < 350) return;
      e.preventDefault();
      if (e.deltaY > 0) goToCard(activeIdx + 1);
      else goToCard(activeIdx - 1);
      lastAdvance = now;
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [activeIdx, transitioning, goToCard]);

  /**
   * For Deezer-sourced tracks, resolve to a Spotify track ID that we've
   * confirmed actually fetches. Returns null when no verified match exists —
   * caller must treat null as "do not save this rating" to prevent orphans.
   *
   * Hardening vs. the original:
   * - Tightened name match (exact, case-insensitive) so we don't swap
   *   "Golden" for "Golden Hour"
   * - Artist match required for strategy 1 (substring either direction) so
   *   we don't pick a same-titled song by a different artist
   * - Each candidate is verified via /tracks/{id} before being returned.
   *   Spotify search occasionally surfaces tracks that 404 on direct fetch
   *   (market restrictions, recent takedowns) — those would orphan the
   *   rating the moment it's saved. With the 30d Redis cache on get_track,
   *   verification is cheap on repeats.
   */
  async function _resolveSpotifyId(track) {
    if (track._source !== "deezer") return track.id;

    // Strip special characters from artist name (slashes, parens, etc. break search)
    const cleanArtist = (track.artists?.[0] ?? "").replace(/[/\\()|&]/g, " ").replace(/\s+/g, " ").trim();
    const trackName = track.name ?? "";
    if (!trackName) return null;
    const trackLower = trackName.toLowerCase();
    const artistLower = cleanArtist.toLowerCase();

    // Verify a candidate actually fetches from our backend. With Redis caching
    // tracks for 30d, repeated verifications of the same ID are free. Used
    // only for fuzzy matches — exact matches skip this to avoid getting
    // tanked by Spotify rate-limit flakiness on the verify call.
    async function verify(id) {
      if (!id) return false;
      try { await api.getTrack(id); return true; } catch { return false; }
    }

    // Strategy 1: name + artist search.
    // 1a) If a result has EXACT name AND EXACT artist match, trust it
    //     immediately — no verify round-trip needed. This is the high-
    //     confidence path that unblocks most popular tracks even when
    //     Spotify is being flaky on get_track.
    // 1b) Otherwise fall back to fuzzy match (substring artist overlap)
    //     and use verify to confirm.
    try {
      const q1 = `${trackName} ${cleanArtist}`.trim();
      const results = (await api.searchTracks(q1) ?? []);

      // 1a — exact name + exact-or-strong artist match wins outright.
      const exact = results.find((t) => {
        if (t.name?.toLowerCase() !== trackLower) return false;
        if (!artistLower) return false;
        return (t.artists || []).some((a) => (a || "").toLowerCase() === artistLower);
      });
      if (exact?.id) return exact.id;

      // 1b — fuzzy candidates with verify fallback.
      const candidates = results.filter((t) => {
        if (t.name?.toLowerCase() !== trackLower) return false;
        if (!artistLower) return true;
        return (t.artists || []).some((a) => {
          const al = (a || "").toLowerCase();
          return al.includes(artistLower) || artistLower.includes(al);
        });
      }).slice(0, 3);
      for (const c of candidates) {
        if (await verify(c.id)) return c.id;
      }
    } catch { /* fall through */ }

    // Strategy 2: name only, for exotic / new artists where the artist
    // string itself breaks the search. Still requires exact-name match.
    // No exact-artist check possible here, so we keep verify.
    try {
      const candidates = (await api.searchTracks(trackName) ?? [])
        .filter((t) => t.name?.toLowerCase() === trackLower)
        .slice(0, 3);
      for (const c of candidates) {
        if (await verify(c.id)) return c.id;
      }
    } catch { /* fall through */ }

    return null;
  }

  async function handleRate(track, value) {
    // Local cache update happens first so the For You feed's "rate ten
    // tracks" cold-start UX continues to feel responsive even when the
    // backend call hasn't completed yet. The returned boolean tells the
    // caller (DiscoverCard) whether the BACKEND actually accepted the
    // rating — that drives the user-facing "Saved ✓" vs "Couldn't save"
    // badge so we don't silently lie about server state.
    setUserRatings((prev) => ({ ...prev, [track.id]: value }));
    // Pass the full track so name/artist/source land in history — that's
    // what makes Deezer-source ratings backfill-able if the resolution
    // fails this session (see syncOrphanedRatings).
    recordRating(track.id, track.artist_ids?.[0], value, track);
    // Also mark seen so the exclude list catches this track on subsequent
    // batches even if the user rated without swiping forward. handleRate
    // can fire from the inline-rate widget on the search page or from the
    // discover card without an immediate advance, so we can't rely on
    // markSeen via the advance handler alone.
    markSeen(track.id);
    const tier = tierSourceOf(track);
    analytics.forYouRated(tier, value);
    try {
      const spotifyId = await _resolveSpotifyId(track);
      if (!spotifyId) return false;  // Deezer-only track we can't match — surfaces as "Retry"

      // Pass artist_id so the server auto-updates the taste profile on high ratings
      await api.rateEntity("track", spotifyId, value, track.artist_ids?.[0] ?? null);
      analytics.ratingSubmitted("track", spotifyId, value);
      // Mark this local entry as synced so future syncOrphanedRatings runs
      // skip it. Stash the resolved Spotify ID too — useful for the diff.
      markRatingSynced(track.id, spotifyId);

      // Optimistic increment so the cold-start banner reflects the new
      // rating without waiting for the next /auth/me round-trip. Skipped
      // when the user is just updating an existing rating (no row added).
      if (!userRatings[track.id]) {
        setRatingCount((prev) => prev + 1);
        sessionRatingsRef.current += 1;
        // Cold-start users (total rating_count below PERSONALIZATION_RAMP)
        // recalibrate after EVERY rating instead of waiting for the
        // every-5-ratings cadence. Reported case: a new user rates a
        // country song 1★ trying to escape a country-heavy cold-start
        // feed, then sees 4 more country songs before the every-5
        // refresh hits — feels like the rating did nothing. With this,
        // the very next batch reflects that 1★ signal.
        //
        // Experienced users (>= PERSONALIZATION_RAMP ratings) keep the
        // every-5 cadence — their feed is already calibrated, and 5×
        // the recalibrate fetches per session is unnecessary load
        // when the marginal signal of one new rating is small against
        // their existing profile.
        //
        // ratingCount is the value BEFORE this rating; the user becomes
        // a "warm" user once they pass the threshold, so the `<` check
        // uses the pre-increment value to ensure rating #5 itself
        // still gets the cold-start fast-path.
        const isColdStart = ratingCount < PERSONALIZATION_RAMP;
        const shouldRecalibrate = isColdStart
          || sessionRatingsRef.current % RECALIBRATE_EVERY === 0;
        if (shouldRecalibrate) {
          // queueMicrotask defers past this turn so we don't refetch
          // in the middle of the current render.
          queueMicrotask(() => recalibrate());
        }
      }

      // Also update local genre cache for logged-out / cold-start scenarios
      if (value >= 4 && track.artist_ids?.[0]) {
        api.getArtist(track.artist_ids[0]).then((artist) => {
          artist.genres?.slice(0, 2).forEach((g) => {
            saveGenre(g);
            genresRef.current = loadGenres();
          });
        }).catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Misclick recovery — remove the user's rating (and any review) for
   * this track. Inverse of handleRate.
   *
   *   1. Local map: drop track.id from userRatings so DiscoverCard
   *      re-renders without a "Saved" badge.
   *   2. Local history (recordRating's localStorage cache): drop the
   *      entry via forgetRating so syncOrphanedRatings doesn't
   *      re-submit it next session.
   *   3. Cold-start counter: decrement ratingCount + sessionRatings so
   *      the "rate X more" UX reflects the new total honestly.
   *   4. Server: DELETE /ratings/{type}/{id}. Backend cascades the
   *      taste-profile retraction (removes the artist from
   *      liked/down_weighted seeds when this was the last same-sign
   *      rating for that artist).
   *
   * Returns true on backend success, false otherwise. Local state is
   * cleared optimistically and stays cleared even on backend failure —
   * the user wanted to undo and we shouldn't fight them; the next
   * session's orphan-sync won't try to recreate the rating because
   * we've forgotten it locally.
   */
  async function handleRemoveRating(track) {
    if (!track || !track.id) return false;
    const hadRating = userRatings[track.id] != null;
    setUserRatings((prev) => {
      const next = { ...prev };
      delete next[track.id];
      return next;
    });
    forgetRating(track.id);
    if (hadRating) {
      setRatingCount((prev) => Math.max(0, prev - 1));
      sessionRatingsRef.current = Math.max(0, sessionRatingsRef.current - 1);
    }
    analytics.forYouRatingRemoved?.(tierSourceOf(track));
    try {
      const spotifyId = await _resolveSpotifyId(track);
      if (!spotifyId) return false;
      await api.deleteRating("track", spotifyId);
      return true;
    } catch {
      return false;
    }
  }

  async function handleReview(track, body, ratingValue, mentionUserIds) {
    // No catch-all wrapper here — errors propagate up to handleSubmitReview
    // in DiscoverCard, which catches and renders e.message. The previous
    // `try { ... } catch { return null; }` swallowed every failure mode
    // into a generic "Couldn't save. Try again." with zero diagnostic
    // signal, which left a user bug report with no information about
    // WHY it failed (Spotify-resolve? timeout? auth? validation?).
    // Specific failure modes now throw labeled errors that the UI
    // surfaces verbatim and logSilentError captures for telemetry.
    const spotifyId = await _resolveSpotifyId(track);
    if (!spotifyId) {
      const err = new Error(
        "Couldn't link this track to Spotify — reviews need a Spotify ID. " +
        "Try the song's track page directly."
      );
      err.code = "spotify_resolve_failed";
      throw err;
    }
    const res = await api.submitReview("track", spotifyId, body, ratingValue, mentionUserIds);
    analytics.reviewSubmitted("track", body.trim().length);
    // Backend returns { ok, review_id }; the id is what the share-card
    // modal needs to render the just-posted review. Spotify id is what
    // the share URL deep-links to (track entity page + review anchor).
    if (!res?.review_id) {
      const err = new Error("Server didn't return a review ID. Try again.");
      err.code = "missing_review_id";
      throw err;
    }
    return { reviewId: res.review_id, spotifyId };
  }

  /**
   * Resolve a track's artist to a Spotify artist ID.
   *
   * Deezer-sourced cards carry a Deezer numeric artist ID, which can't be
   * cross-matched against Spotify-sourced cards from later batches. So we
   * search Spotify by name to get a stable canonical ID for the dislike
   * record. If lookup fails we fall back to whatever we have locally — at
   * worst that just blocks future Deezer cards from the same artist.
   */
  async function _resolveSpotifyArtistId(track) {
    const localId = track.artist_ids?.[0];
    if (track._source !== "deezer") return localId;
    const name = track.artists?.[0];
    if (!name) return localId;
    try {
      const matches = await api.searchArtists(name);
      const exact = matches?.find((a) => a.name?.toLowerCase() === name.toLowerCase());
      return exact?.id ?? matches?.[0]?.id ?? localId;
    } catch {
      return localId;
    }
  }

  async function handleDislike(track) {
    const localArtistId = track.artist_ids?.[0];
    // Immediately remove every track by this artist from the current feed
    // using whatever ID we have locally — don't wait on the network.
    setTracks((prev) => prev.filter((t) => t.artist_ids?.[0] !== localArtistId));
    // Mark seen — the user has explicitly said they don't want this
    // track again. Artist-level dislike covers future artist content
    // but seen-tracking ensures THIS specific track ID is filtered too
    // (covers Deezer/Spotify ID mismatch edge cases for the same song).
    markSeen(track.id);

    // Resolve to a canonical Spotify ID, then persist.
    const canonicalId = await _resolveSpotifyArtistId(track);
    recordDislike(canonicalId);
    // Sync to the server profile so the dislike follows the user across
    // devices (and so the server can apply it before serving the next
    // batch). Best-effort — local cache already holds it for this device.
    if (user && canonicalId) {
      api.addArtistDislike(canonicalId).catch(() => {});
    }
  }

  /**
   * Click handler for the title and artist links on every card. The goal is
   * to keep users in-app: a Deezer-sourced card resolves to its Spotify
   * counterpart and navigates to the internal /track or /artist page rather
   * than opening Deezer in a new tab.
   *
   * Fallback chain when resolution fails (Spotify circuit open, no match,
   * track genuinely not on Spotify): open the external Deezer URL so the
   * user still gets *somewhere*.
   */
  async function handleEntityClick(track, entityType) {
    // Spotify-sourced cards already have a usable internal ID.
    if (track._source !== "deezer") {
      const id = entityType === "track" ? track.id : track.artist_ids?.[0];
      if (id) navigate(`/${entityType}/${id}`);
      return;
    }
    try {
      const spotifyId = entityType === "track"
        ? await _resolveSpotifyId(track)
        : await _resolveSpotifyArtistId(track);
      // _resolveSpotifyArtistId returns the local (Deezer) ID as fallback
      // when nothing better is found — only navigate when the ID looks like
      // a real Spotify ID (22 base62 chars).
      if (spotifyId && /^[A-Za-z0-9]{22}$/.test(spotifyId)) {
        navigate(`/${entityType}/${spotifyId}`);
        return;
      }
    } catch { /* fall through to external */ }
    if (track.external_url) {
      window.open(track.external_url, "_blank", "noreferrer");
    }
  }

  // Stable-identity callbacks for the memoized DiscoverCard. Each call hits
  // the latest closure of the underlying handler (see `useEvent` at the top
  // of the file) so behavior is unchanged — but identity is constant across
  // renders, which lets React.memo on DiscoverCard actually skip work when
  // unrelated parent state (dragging, transitioning) flips during a swipe.
  // The bare `handleRate` etc. are recreated every render and would defeat
  // memo if passed directly.
  const stableOnRate = useEvent(handleRate);
  const stableOnReview = useEvent(handleReview);
  const stableOnDislike = useEvent(handleDislike);
  const stableOnRemoveRating = useEvent(handleRemoveRating);
  const stableOnEntityClick = useEvent(handleEntityClick);

  if (loading) {
    // First thing the user sees after the boot splash snaps off. Used to be
    // a bare "Loading…" text label, which felt like a placeholder against
    // an editorial serif app. Replaced with an italic serif "Tuning your
    // feed" + a subtle pulsing dot — keeps the brand voice intact and
    // signals motion so the wait reads as active rather than stalled.
    return (
      <div style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        height: "100%", gap: 14,
      }}>
        <div
          className="loading-pulse"
          aria-hidden="true"
          style={{
            width: 10, height: 10, borderRadius: "50%",
            background: "rgba(255,255,255,0.5)",
          }}
        />
        <p style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 17,
          margin: 0,
          color: "rgba(255,255,255,0.55)",
        }}>
          Tuning your feed
        </p>
      </div>
    );
  }

  if (!tracks.length) {
    const dislikedCount = loadDisliked().length;
    const spotifyOk = debugInfo?.tiers?.spotify_auth?.ok;
    const spotifyErr = debugInfo?.tiers?.spotify_auth?.error;
    // Deezer is now the baseline tier; fall back to old Spotify tier keys for in-flight deploys
    const tier3 = debugInfo?.tiers?.tier3_deezer_popular ?? debugInfo?.tiers?.tier3_popular_search ?? debugInfo?.tiers?.tier3_global_top50;
    const tier3Ok = tier3?.ok;
    const tier3Count = tier3?.track_count;
    const tier3Err = tier3?.error;
    const deezerOk = tier3?.ok && (tier3?.track_count ?? 0) > 0;

    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, color: "rgba(255,255,255,0.5)", padding: 40, textAlign: "center" }}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden style={{ color: "rgba(255,255,255,0.35)" }}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
        <p style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: 22, fontWeight: 400, color: "#fff", lineHeight: 1.2 }}>
          {fetchError
            ? "Can't reach the server."
            : (dislikedCount >= 5
                ? "The feed ran out of room."
                : "Warming up the feed.")}
        </p>

        {/* Spotify-level diagnosis */}
        {debugInfo && spotifyOk === false && (
          <div style={{ padding: "10px 16px", background: `${DANGER}1a`, border: `1px solid ${DANGER}4d`, borderRadius: "var(--radius-md)", maxWidth: 300 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--danger)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <AlertIcon size={12} /> Spotify API unreachable
            </p>
            {spotifyErr && <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{spotifyErr}</p>}
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              Check that SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are set in Railway.
            </p>
          </div>
        )}

        {debugInfo && spotifyOk === true && tier3Ok === false && (
          <div style={{ padding: "10px 16px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "var(--radius-md)", maxWidth: 300 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--gold)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <AlertIcon size={12} /> Spotify auth OK but track search failed
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              {tier3Err}
            </p>
          </div>
        )}

        {debugInfo && spotifyOk === true && tier3Ok === true && tier3Count === 0 && (
          <div style={{ padding: "10px 16px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "var(--radius-md)", maxWidth: 300 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--gold)", fontWeight: 700 }}>Spotify returned 0 tracks</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              {dislikedCount >= 5 ? `${dislikedCount} artists blocked by your not-interested list.` : "Playlist may be empty or region-restricted."}
            </p>
          </div>
        )}

        {!debugInfo && !fetchError && (
          <p style={{ margin: 0, fontSize: 13, maxWidth: 300, lineHeight: 1.6 }}>
            {dislikedCount >= 5
              ? `${dislikedCount} artists are on your not-interested list. Clearing some out reopens the feed.`
              : "Pulling fresh tracks. Should only take a moment."}
          </p>
        )}

        <button
          onClick={() => fetchBatch()}
          style={{
            marginTop: 4, padding: "10px 24px", borderRadius: "var(--radius-xl)",
            background: ACCENT_A,
            border: "none", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}
        >Try again</button>
        {dislikedCount >= 5 && (
          <button
            onClick={clearNotInterested}
            style={{
              padding: "8px 20px", borderRadius: "var(--radius-xl)", fontSize: 12,
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.55)", cursor: "pointer",
            }}
          >
            Clear not-interested list ({dislikedCount})
          </button>
        )}

        {/* Raw debug dump for dev diagnosis */}
        {debugInfo && (
          <details style={{ marginTop: 8, maxWidth: 320, textAlign: "left" }}>
            <summary style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", cursor: "pointer" }}>Debug info</summary>
            <pre style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {JSON.stringify(debugInfo?.tiers, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
      {/* Floating settings gear. Lives top-LEFT to keep the card's top-right
          clear for the per-card "···" overflow menu (Share / Open in Spotify
          / Apple Music / YouTube). The card-position indicator was removed
          when we consolidated the chrome — feed UIs like TikTok / Reels
          don't show one either. */}
      <button
        onClick={() => setSettingsOpen(o => !o)}
        title="Feed settings"
        aria-label="Feed settings"
        className="glass"
        style={{
          position: "absolute", top: 8, left: 10, zIndex: 5,
          fontSize: 15, lineHeight: 1,
          width: 32, height: 32, borderRadius: "var(--radius-pill)", padding: 0,
          border: "none",
          color: settingsOpen ? "var(--accent)" : "rgba(255,255,255,0.7)",
          cursor: "pointer",
          transition: "color var(--motion-base) var(--ease)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >⚙</button>

      {/* Cold-start progress banner */}
      <ColdStartBanner ratingCount={ratingCount} />

      {/* Settings panel */}
      {settingsOpen && (
        <div style={{
          padding: "12px 20px", background: "rgba(255,255,255,0.05)",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          display: "flex", flexDirection: "column", gap: 10, flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "rgba(255,255,255,0.92)" }}>
              Feed settings
            </span>
            <button onClick={() => setSettingsOpen(false)} aria-label="Close feed settings" style={{ fontSize: 16, background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>✕</button>
          </div>

          {/* Language filter — three modes. Replaces the older English-only
              boolean. Spanish mode is a best-effort heuristic (Spanish
              diacritics or common stopwords on title/artist) — false
              positives on Portuguese / Italian are tolerable. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "#fff", fontWeight: 600 }}>Language</p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                Filter the For You feed by song language.
              </p>
            </div>
            <div style={{
              display: "flex", padding: 3,
              background: "rgba(255,255,255,0.08)",
              borderRadius: "var(--radius-md)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}>
              {[
                { key: "english", label: "English" },
                { key: "spanish", label: "Spanish" },
                { key: "all",     label: "All" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setLanguagePref(key)}
                  style={{
                    flex: 1, padding: "7px 10px", fontSize: 12,
                    fontWeight: language === key ? 700 : 500,
                    background: language === key ? ACCENT_A : "transparent",
                    color: language === key ? "#000" : "rgba(255,255,255,0.65)",
                    border: "none", borderRadius: "var(--radius-sm)",
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Browse by genre — temporarily override the personalized
              feed with an equal-weight sample from a user-picked genre
              set. Doesn't change the underlying taste profile. Rated
              tracks are still excluded server-side so the user doesn't
              see duplicates. Three render branches:
                (a) Not in browse mode + picker closed → "Enable" button
                (b) In browse mode + picker closed → active genres chips
                    + "Change" / "Exit browse" buttons
                (c) Picker open → multi-select grid (base + expandable
                    extended set) + Apply / Cancel

              The picker is rendered inline in the gear panel rather
              than a separate modal so it lives in the same surface as
              the language toggle and reset button — feels like an
              extension of the existing settings, not a new sub-mode.
              maxHeight + overflowY:auto on the picker so it doesn't
              push the deck entirely off-screen on a small viewport.
              The settings panel is rendered as a sibling above the
              deck div, so touches inside it never reach the deck's
              swipe handlers — internal scroll is naturally isolated. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "#fff", fontWeight: 600 }}>
                Browse by genre
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                Temporarily browse a feed of specific genres. Doesn't change your usual feed.
              </p>
            </div>

            {/* (a) Not in browse mode, picker closed */}
            {browseGenres.length === 0 && !pickerOpen && (
              <button
                onClick={openPicker}
                style={{
                  padding: "9px 14px", fontSize: 12, fontWeight: 700,
                  background: ACCENT_A, color: "#000",
                  border: "none", borderRadius: "var(--radius-md)",
                  cursor: "pointer", alignSelf: "flex-start",
                  transition: "filter 0.12s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.filter = "brightness(1.06)"}
                onMouseLeave={(e) => e.currentTarget.style.filter = "brightness(1)"}
              >
                Enable genre browse
              </button>
            )}

            {/* (b) In browse mode, picker closed */}
            {browseGenres.length > 0 && !pickerOpen && (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {browseGenres.map((slug) => {
                    const genre = GENRE_OPTIONS.find((g) => g.slug === slug);
                    return (
                      <span key={slug} style={{
                        display: "inline-flex", alignItems: "center",
                        padding: "4px 10px", fontSize: 11, fontWeight: 600,
                        background: `${ACCENT_A}26`,
                        color: ACCENT_A,
                        borderRadius: "var(--radius-pill)",
                        border: `1px solid ${ACCENT_A}55`,
                      }}>
                        {genre?.label || slug}
                      </span>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={openPicker}
                    style={{
                      padding: "7px 12px", fontSize: 12, fontWeight: 600,
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: "var(--radius-md)",
                      color: "rgba(255,255,255,0.9)",
                      cursor: "pointer",
                    }}
                  >
                    Change genres
                  </button>
                  <button
                    onClick={exitBrowseMode}
                    style={{
                      padding: "7px 12px", fontSize: 12, fontWeight: 600,
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: "var(--radius-md)",
                      color: "rgba(255,255,255,0.7)",
                      cursor: "pointer",
                    }}
                  >
                    Exit browse
                  </button>
                </div>
              </>
            )}

            {/* (c) Picker open — multi-select grid */}
            {pickerOpen && (
              <div
                style={{
                  display: "flex", flexDirection: "column", gap: 10,
                  maxHeight: "55vh", overflowY: "auto",
                  // Keep mobile inertial scroll inside the picker
                  // smooth without exposing the underlying deck. The
                  // panel is already DOM-separate from the deck's
                  // touch handlers, but pan-y here is belt-and-
                  // suspenders so the gesture intent is unambiguous
                  // even mid-flick.
                  touchAction: "pan-y",
                  WebkitOverflowScrolling: "touch",
                  padding: "4px 2px",
                }}
              >
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: 0 }}>
                  Pick up to {BROWSE_GENRES_MAX}. Tap Apply when you're done.
                </p>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {GENRE_OPTIONS_BASE.map((g) => (
                    <GenreChip
                      key={g.slug}
                      genre={g}
                      selected={pendingPicks}
                      onToggle={togglePick}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setShowExtendedGenres((s) => !s)}
                  style={{
                    padding: "6px 12px", fontSize: 11, fontWeight: 600,
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: "var(--radius-sm)",
                    color: "rgba(255,255,255,0.7)",
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  {showExtendedGenres ? "Show fewer genres" : "More genres"}
                </button>

                {showExtendedGenres && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {GENRE_OPTIONS_EXTENDED.map((g) => (
                      <GenreChip
                        key={g.slug}
                        genre={g}
                        selected={pendingPicks}
                        onToggle={togglePick}
                      />
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 6, position: "sticky", bottom: 0, paddingTop: 6, background: "linear-gradient(to top, rgba(10,10,10,0.95) 60%, rgba(10,10,10,0))" }}>
                  <button
                    onClick={applyBrowseGenres}
                    disabled={pendingPicks.length === 0}
                    style={{
                      flex: 1, padding: "9px 14px", fontSize: 13, fontWeight: 700,
                      background: pendingPicks.length > 0 ? ACCENT_A : "rgba(255,255,255,0.06)",
                      color: pendingPicks.length > 0 ? "#000" : "rgba(255,255,255,0.3)",
                      border: "none", borderRadius: "var(--radius-md)",
                      cursor: pendingPicks.length > 0 ? "pointer" : "default",
                    }}
                  >
                    Apply{pendingPicks.length > 0 ? ` (${pendingPicks.length})` : ""}
                  </button>
                  <button
                    onClick={cancelPicker}
                    style={{
                      padding: "9px 14px", fontSize: 13, fontWeight: 600,
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: "var(--radius-md)",
                      color: "rgba(255,255,255,0.7)",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Reset feed — user-facing escape hatch when the algorithm
              feels stuck on the same songs. Clears the SEEN_KEY history
              (skipped-but-not-rated tracks) so the next batch can pull
              from the full chart pool again. Rated tracks stay excluded
              via the server-side Rating table. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "#fff", fontWeight: 600 }}>Reset feed</p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                Seeing the same songs? Clear your skip history and pull a fresh batch.
                Your ratings stay.
              </p>
            </div>
            <button
              onClick={resetFeed}
              style={{
                padding: "9px 14px", fontSize: 12, fontWeight: 700,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "var(--radius-md)",
                color: "rgba(255,255,255,0.9)",
                cursor: "pointer", alignSelf: "flex-start",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.12)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
            >
              Reset feed
            </button>
          </div>
        </div>
      )}

      {/* Swipe deck — single-wrapper transform model.
          The OUTER wrapper translates by `calc(-activeIdx * 100% + dragOffset px)`.
          INNER cards each sit at top:0 with a STATIC transform of
          `translateY(i * 100%)` based on their absolute track index. So
          activeIdx 0 with dragOffset 0 → wrapper at 0%, card[0] at 0%, card[1]
          at 100% (off-screen below).

          Why a single wrapper instead of three cards each with their own
          top:/transform: at the moment of commit (when activeIdx advances
          and dragOffset resets), the combined transform value is mathematically
          identical before and after — outer goes from -N*100% + -cardHeight to
          -(N+1)*100% + 0, which is the same translateY. The swap is invisible
          to the eye AND to the GPU compositor because nothing animates.
          Solves both the back-and-forth jitter AND the seam-peek issues from
          the multi-card approach.

          Hard clamp on dragOffset at the deck boundaries prevents the wrapper
          from ever exposing page-bg above card 0 or below card N — that was
          the "extended header black bar" reported when swiping back from
          the first card. */}
      <div
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          overscrollBehavior: "none",
          touchAction: "pan-y",
          // Defensive: during a snap animation, nothing inside the deck
          // should accept pointer events. Belt-and-suspenders with the
          // `if (transitioning) return` early-out in handleTouchStart —
          // ensures even a tap mid-animation can't kick off a handler.
          pointerEvents: transitioning ? "none" : "auto",
        }}
      >
        <div
          ref={wrapperRef}
          style={{
            position: "absolute", inset: 0,
            // NOTE: `transform` is deliberately NOT set here. The drag
            // handler writes it directly to wrapperRef.current.style.transform
            // on every touchmove so the gesture doesn't round-trip through
            // a React render. A useLayoutEffect above re-applies the resting
            // transform whenever activeIdx / dragging / transitioning change.
            // Stored unit is %-of-cardHeight — same units the wrapper uses
            // (no px↔% mix, so the commit boundary stays subpixel-stable).
            //
            // Softer ease-out curve (was cubic-bezier(0.16, 1, 0.3, 1)
            // — an aggressive easeOutQuint that "slammed" the landing
            // and made every transition feel like the deck snapped
            // into a detent). easeOutQuart `(0.25, 1, 0.5, 1)` is
            // gentler at the end — the wrapper decelerates more
            // gradually as it approaches the target, so the eye reads
            // the motion as "settling" rather than "stopping". Bigger
            // perceptual impact than tuning the duration. Pairs with
            // the wider velocity-to-duration range below (snap
            // duration 175-340ms depending on flick speed).
            transition: dragging ? "none" : `transform ${snapDuration}ms cubic-bezier(0.25, 1, 0.5, 1)`,
            willChange: "transform",
            // `contain: layout paint` was REMOVED here — it was clipping
            // descendants to the wrapper's un-transformed border box, per
            // CSS spec. Cards are positioned via translate3d(0, i*100%, 0)
            // inside the wrapper, so card[1] sits at +100% (one wrapper
            // height below the wrapper's static box). When the wrapper
            // transforms by -100% on a forward swipe, card[1] visually
            // moves into the viewport — but paint containment clipped it
            // against the wrapper's STATIC bounds, leaving a black screen.
            // Symptom on iOS: swipe up shows nothing where the next song
            // should be. The deck container parent already has overflow:
            // hidden so we keep the perf isolation at that level.
          }}
        >
          {tracks.map((track, i) => {
            // Mount activeIdx ± 2 cards. The ±2 window (vs the previous ±1)
            // means the "next-next" card mounts during idle time before the
            // user lands on it — its DiscoverCard effects (Apple Music
            // fetch, audio element wire-up, action menu listeners) run
            // off-screen instead of at commit, where they used to compete
            // with the snap animation's transitionend dispatch and cause
            // perceptible end-of-swipe lag. Cards at ±2 sit two card-heights
            // off-screen via the static translateY below (their absolute
            // index × 100% combined with the wrapper's -activeIdx × 100%
            // resolves to ±200%, well outside the overflow:hidden viewport),
            // so they're invisible until the user swipes toward them.
            // Render budget stays bounded at 5 mounted cards — small memory
            // hit for a significant commit-time perf win on iOS WKWebView.
            if (Math.abs(i - activeIdx) > 2) return null;
            return (
              <div
                key={`${track.id}-${i}`}
                data-card={i}
                style={{
                  position: "absolute", top: 0, left: 0, right: 0, height: "100%",
                  // Static % offset based on track index — doesn't depend on
                  // any state, so cards don't re-render when dragOffset
                  // changes (huge perf win on touchmove).
                  transform: `translate3d(0, ${i * 100}%, 0)`,
                  willChange: "transform",
                }}
              >
                <CardErrorBoundary>
                  <DiscoverCard
                    track={track}
                    isActive={i === activeIdx && !transitioning}
                    onRate={stableOnRate}
                    onReview={stableOnReview}
                    onDislike={stableOnDislike}
                    onRemoveRating={stableOnRemoveRating}
                    onEntityClick={stableOnEntityClick}
                    userRating={userRatings[track.id] ?? null}
                    cardIndex={i}
                    totalCards={tracks.length}
                  />
                </CardErrorBoundary>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── localStorage keys for tab discoverability features ───────────────────────
// `LAST_VIEW_*`: timestamp the user last opened that tab. Used to compute
// "is there new activity since the user last looked here?" → drives the
// purple-dot activity badge.
// `TABS_HINT_SEEN`: flag set after the user dismisses the first-launch
// coachmark pointing at the Community tab.
const LAST_VIEW_COMMUNITY = "contour_lastview_community_v1";
const TABS_HINT_SEEN = "contour_tabs_hint_v1";

function readTs(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}
function writeTs(key, v = Date.now()) {
  try { localStorage.setItem(key, String(v)); } catch {}
}

// ── Page shell with tabs ──────────────────────────────────────────────────────
export function ForYouPage() {
  // Internal state values are "discover" / "community" — the user-facing
  // rename from "For You" → "Discover" lets the bottom-nav "For You"
  // label keep its meaning of "go to home" without colliding with the
  // home-page sub-tab name. "Friends" was a third value here; that
  // surface lives at /friends (own bottom-nav slot) now.
  //
  // URL-backed via ?tab=community (no param = discover, the default).
  // Without this, browser back from a user page that the user reached
  // FROM the Community sub-tab dropped them on Discover instead of
  // restoring Community. Sync direction is state → URL (replace, not
  // push, so accidental sub-tab toggling doesn't bloat history). The
  // back-button case works because navigating away to /user/<id>
  // unmounts ForYouPage; navigating back to / remounts it and
  // useState(initialTab) re-reads the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "community" ? "community" : "discover";
  const [tab, setTab] = useState(initialTab);
  // Keep the URL in sync when tab state changes. replace:true so a
  // user toggling Discover↔Community 5 times doesn't push 5 entries
  // onto history (the back button should leave the page, not unwind
  // sub-tab clicks).
  useEffect(() => {
    const current = searchParams.get("tab") === "community" ? "community" : "discover";
    if (current !== tab) {
      const next = new URLSearchParams(searchParams);
      if (tab === "discover") next.delete("tab");
      else next.set("tab", tab);
      setSearchParams(next, { replace: true });
    }
    // searchParams + setSearchParams deliberately excluded — they're
    // stable refs from the hook and including them would cause an
    // extra render every time the URL changes via this very effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const { user } = useAuth();

  // Activity badge + first-launch hint state.
  // `hasNewCommunity` drives the small purple dot on the Community tab
  // — set true when the latest activity timestamp on that surface is
  // newer than the user's last viewed-at timestamp (stored in
  // localStorage). Clearing the dot updates the stored timestamp.
  const [hasNewCommunity, setHasNewCommunity] = useState(false);
  const [showTabsHint, setShowTabsHint] = useState(false);

  // First-launch hint: show once per device until dismissed. Don't show
  // for signed-out users (the social features require sign-in anyway).
  useEffect(() => {
    if (!user) return;
    try {
      if (!localStorage.getItem(TABS_HINT_SEEN)) {
        // Small delay so it appears after the page settles, not in the
        // initial render flash. Auto-dismissed when the user taps any
        // tab OR the explicit X.
        const t = setTimeout(() => setShowTabsHint(true), 1500);
        return () => clearTimeout(t);
      }
    } catch {}
  }, [user]);
  function dismissTabsHint() {
    setShowTabsHint(false);
    try { localStorage.setItem(TABS_HINT_SEEN, "1"); } catch {}
  }

  // Probe Community feed for newer-than-last-viewed activity. Pulls
  // recent reviews and picks the newest one that ISN'T authored by the
  // viewer — posting your own review shouldn't trigger your own badge
  // (reported as confusing because the dot lit up the instant you
  // submitted). The feed itself still shows your reviews mixed in
  // chronologically; only the freshness signal excludes self.
  //
  // (The Friends probe was retired with the sub-tab itself; the same
  // signal would belong on the bottom-nav /friends route now — a
  // follow-up if we want a dot there.)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        // Probe only needs the first ~5 newest items to find the most
        // recent non-self review — no need to pull a full page. Saves
        // ~80% of the response payload on the freshness probe path.
        // Response shape: { items, has_more } (paginated). Older
        // shape was a flat list — Array.isArray fallback still works
        // during the deploy crossover but should be removable soon.
        const res = await api.getGlobalReviews?.("recent", "all", 5, 0);
        if (cancelled) return;
        const list = Array.isArray(res) ? res : (res?.items || []);
        const newestForeign = list.find((r) => r?.user?.id && r.user.id !== user.id) || null;
        const newest = newestForeign?.created_at
          ? new Date(newestForeign.created_at).getTime()
          : 0;
        setHasNewCommunity(newest > readTs(LAST_VIEW_COMMUNITY));
      } catch (e) {
        logSilentError("foryou_community_freshness_probe", e);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Wrapped setTab that also: stamps the last-viewed timestamp and
  // clears the activity badge for the destination tab, plus dismisses
  // the first-launch hint on any tab interaction.
  function selectTab(next) {
    if (showTabsHint) dismissTabsHint();
    if (next === "community") {
      writeTs(LAST_VIEW_COMMUNITY);
      setHasNewCommunity(false);
    }
    setTab(next);
  }

  const tabStyle = (active) => ({
    flex: 1, padding: "15px 0", fontSize: 14, position: "relative",
    fontWeight: active ? 700 : 500,
    background: "none", border: "none",
    borderBottom: active ? `2px solid ${ACCENT_A}` : "2px solid transparent",
    color: active ? "#fff" : "rgba(255,255,255,0.55)",
    cursor: "pointer", transition: "all 0.15s",
    // Touch target ≥ 44px (iOS HIG). 15px + 14px + 15px = 44 minimum.
    minHeight: 44,
  });

  // Small purple dot rendered top-right of a tab when there's unseen
  // activity. Absolute-positioned relative to the parent button which
  // is now position: relative (added to tabStyle above).
  const activityDot = (
    <span style={{
      position: "absolute", top: 8, right: "calc(50% - 26px)",
      width: 7, height: 7, borderRadius: "50%",
      background: ACCENT_A,
      boxShadow: `0 0 0 2px #0a0a0a`,
    }} />
  );

  // Layout publishes its measured header height as --layout-header-h via
  // ResizeObserver — survives safe-area inset changes, address-bar
  // collapse, and the desktop nav wrapping on narrow viewports. Fallback
  // value covers the brief pre-measurement render before the variable lands.
  const STICKY_TOP = "var(--layout-header-h, 53px)";

  // For the audio-swipe tab we need a fixed-height container so the swipe
  // gesture has room to operate. For the scrollable tabs (Friends, Community)
  // we let the page flow naturally so the document scroll moves them — that's
  // what allows the tab strip's `position: sticky` to actually stick.
  const isSwipe = tab === "discover";

  // Viewport-width gate: on tablet+ (>640px) the Layout top header is the
  // canonical navigation (desktop nav links — Friends / Search / Compare /
  // Profile — and the bottom-nav is display:none). The swipe overlay below
  // anchors to top:0 on phones (full-bleed feed) but must NOT cover the
  // header on tablets — otherwise Discover loses access to navigation
  // entirely on iPad while Community keeps it. Reported 2026-05-17.
  const [isTabletOrLarger, setIsTabletOrLarger] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth > 640 : false
  );
  useEffect(() => {
    const onResize = () => setIsTabletOrLarger(window.innerWidth > 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // While the Discover sub-tab is active, hide the Layout header and zero
  // out the page-content's padding-bottom (both come from CSS rules keyed
  // on this body class). Reasons:
  //   - The Layout header was still rendering in document flow underneath
  //     the position:fixed swipe page; on devices where z-index + stacking
  //     context didn't behave as expected, the user could see a "Contour
  //     banner" line above the swipe content.
  //   - The page-content's padding-bottom (60px + safe-area) was making
  //     the document taller than the viewport even though the swipe page
  //     itself was fixed-position. That residual overflow gave iOS room
  //     to rubber-band-scroll the document and expose page-bg.
  // Removing both via CSS class is structurally cleaner than fighting
  // z-index and layout math.
  useEffect(() => {
    if (isSwipe) {
      document.body.classList.add("foryou-swipe-mode");
      // Also tag <html> so the body-scroll lockdown CSS can pin BOTH
      // elements without relying on :has() (which is iOS Safari 15.4+
      // only). The CSS rule that locks overflow + height + overscroll
      // targets `html.foryou-swipe-html, body.foryou-swipe-mode` so
      // either selector matching is enough on the body side, and the
      // html side gets pinned regardless of :has() support.
      document.documentElement.classList.add("foryou-swipe-html");
    } else {
      document.body.classList.remove("foryou-swipe-mode");
      document.documentElement.classList.remove("foryou-swipe-html");
    }
    return () => {
      document.body.classList.remove("foryou-swipe-mode");
      document.documentElement.classList.remove("foryou-swipe-html");
    };
  }, [isSwipe]);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      background: "#0a0a0a",
      // In swipe mode, pin the page to cover the whole viewport below the
      // iOS status bar and above the bottom-nav. The Layout header
      // (Contour wordmark + bell) is intentionally COVERED on this page —
      // the For You feed wants the full-bleed media surface mobile users
      // expect from TikTok / Spotify Discover, with the layout header
      // available again as soon as they switch to Friends/Community.
      //
      // Why not `top: var(--layout-header-h)` like before: on iPhone with
      // safe-area-inset-top, the header is ~95-105px tall. Anchoring the
      // page below it puts the deck and its top chrome (gear, "···") way
      // below the status bar, which read as "locked too far low" — the
      // buttons felt buried. Anchoring to env(safe-area-inset-top, 0px)
      // puts them just below the status bar where they're tap-able
      // without iOS's status-bar-tap-scroll-to-top affordance interfering.
      //
      // Layout header keeps rendering in document flow underneath this
      // fixed layer — it appears normally when the user switches away
      // from the Discover tab (which goes back to normal flow).
      ...(isSwipe ? {
        position: "fixed",
        // Phone: anchor to top:0 so the surface stays continuous through
        // iOS Safari's opportunistic URL-bar collapse (a non-zero top with
        // env(safe-area-inset-top) shifted under it would expose a black
        // gap). Tablet+: anchor BELOW the Layout header — the desktop top
        // nav (Friends / Search / Compare / Profile) is the only nav on
        // iPad since bottom-nav is hidden >640px, so covering the header
        // strands the user on Discover with no way out.
        top: isTabletOrLarger ? STICKY_TOP : 0,
        left: 0,
        right: 0,
        // Phone reserves room for the bottom-nav (56px). Tablet+ has no
        // bottom-nav (display:none >640px) so the deck can extend to the
        // viewport bottom; safe-area still pads the iPad home indicator.
        bottom: isTabletOrLarger
          ? "env(safe-area-inset-bottom, 0px)"
          : "calc(56px + env(safe-area-inset-bottom, 0px))",
        overflow: "hidden",
        // Phone: z 60 covers Layout's header (z 50) for full-bleed feed.
        // Tablet+: stay UNDER the header (z 40 < 50) so it remains tappable.
        zIndex: isTabletOrLarger ? 40 : 60,
      } : {}),
    }}>
      {/* Three modes — Discover (audio swipe), Friends (followed users'
          activity), Community (global review feed). /feed was retired:
          this is the single home for all three discovery modes.

          Positioning model:
          - Swipe mode (Discover): the outer div has fixed height + overflow:hidden.
            position: sticky degrades to relative-like behavior inside a
            non-scrolling parent on some iOS WebKit configs, occasionally
            allowing inner content to paint above the strip. Use explicit
            position: relative + zIndex isolation to guarantee the strip
            is the topmost layer of the swipe view.
          - Scroll mode (Friends / Community): use sticky so the strip pins
            below Layout's sticky header as the page scrolls.

          zIndex 40 stays under Layout's header (50) in both modes. */}
      <div
        className="foryou-tabs-strip glass"
        style={{
        position: isSwipe ? "relative" : "sticky",
        top: isSwipe ? undefined : STICKY_TOP,
        zIndex: 40,
        display: "flex",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        flexShrink: 0,
        // Pad the strip by safe-area-inset-top in BOTH modes so the tab
        // buttons stay below the iPhone status bar. The glass background
        // extends up into the status-bar area as a continuous header.
        //
        // Why unconditional (was: isSwipe-only): on mobile non-swipe modes
        // (Community / Friends) the Layout header is hidden via the
        // .app-header.hide-on-home-mobile CSS rule, AND the strip's CSS
        // forces `top: 0 !important`. With no safe-area padding, the
        // pinned strip rendered UNDER the status bar — iPhone's system
        // time / battery indicators painted over the "Discover" /
        // "Community" tab labels (reported in prod 2026-05-18).
        //
        // The cost in swipe mode is unchanged (was already applied there).
        // The cost in scroll modes when Layout's header IS visible (i.e.
        // tablet+, or before the user scrolls) is one safe-area-inset-top
        // of vertical whitespace between the header and the strip — minor
        // cosmetic, much better than the overlap glitch.
        paddingTop: "env(safe-area-inset-top, 0px)",
        // Belt-and-suspenders: force the strip onto its own GPU layer so
        // nothing in the content panel paints above it regardless of
        // descendant stacking-context shenanigans.
        isolation: "isolate",
      }}>
        <button style={tabStyle(tab === "discover")} onClick={() => selectTab("discover")}>Discover</button>
        <button style={tabStyle(tab === "community")} onClick={() => selectTab("community")}>
          Community
          {hasNewCommunity && tab !== "community" && activityDot}
        </button>
      </div>

      {/* First-launch coachmark — points users at the Community tab so
          they discover the global review feed. Auto-dismisses on any
          tab interaction; explicit X for impatient users. The Friends
          mention was removed when that sub-tab moved to the bottom-nav
          /friends route — the bottom-nav icon is now the canonical
          discovery surface for followed-user activity. */}
      {showTabsHint && (
        <div style={{
          position: "relative",
          margin: "8px 14px 0",
          padding: "10px 36px 10px 14px",
          background: "rgba(217,122,59,0.12)",
          border: "1px solid rgba(217,122,59,0.35)",
          borderRadius: "var(--radius)",
          fontSize: 12.5, lineHeight: 1.45,
          color: "rgba(255,255,255,0.85)",
        }}>
          <span style={{ fontWeight: 700, color: ACCENT_A }}>Tip:</span>{" "}
          tap <strong>Community</strong> for the global review feed,
          or the <strong>Friends</strong> icon below for people you follow.
          <button
            onClick={dismissTabsHint}
            aria-label="Dismiss tip"
            style={{
              position: "absolute", top: 6, right: 8,
              width: 22, height: 22, borderRadius: "var(--radius)",
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Content — both panels stay mounted so ForYouFeed never loses its
          track list or scroll position when the user flips tabs.
          isolation: isolate scopes any inner zIndex shenanigans to this
          subtree — children cannot paint above the tab strip. */}
      <div style={{
        position: "relative", background: "var(--bg)",
        isolation: "isolate",
        ...(isSwipe ? { flex: 1, overflow: "hidden", minHeight: 0 } : {}),
      }}>
        <div style={{ display: tab === "discover" ? "flex" : "none", flexDirection: "column", height: "100%" }}>
          <ForYouFeed />
        </div>
        <div style={{ display: tab === "community" ? "block" : "none" }}>
          <GlobalReviewsFeed />
        </div>
      </div>
    </div>
  );
}
