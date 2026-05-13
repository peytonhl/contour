import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { analytics } from "../services/analytics.js";

// Tier source for analytics — backend tags deezer-sourced tracks with _source,
// everything else came through Spotify (tier 1 related-artist or tier 2 genre).
// Coarser than the full tier1..tier5 enum but reflects what the data we have.
function tierSourceOf(track) {
  return track?._source === "deezer" ? "deezer" : "spotify";
}

import { GlobalReviewsFeed } from "../components/GlobalReviewsFeed.jsx";
import { FollowingTab } from "../components/FollowingTab.jsx";
import { SpotifyIcon, AppleMusicIcon, YouTubeIcon } from "../components/PlatformIcons.jsx";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";
const GOLD = "#f59e0b";

// ── LocalStorage keys ─────────────────────────────────────────────────────────
const GENRES_KEY = "contour_genres_v1";
const HISTORY_KEY = "contour_history_v1";
const DISLIKED_KEY = "contour_disliked_v1";
const ENGLISH_ONLY_KEY = "contour_english_only_v1";

function loadEnglishOnly() {
  try {
    const v = localStorage.getItem(ENGLISH_ONLY_KEY);
    return v === null ? true : v === "true"; // default ON
  } catch { return true; }
}
function saveEnglishOnly(val) {
  localStorage.setItem(ENGLISH_ONLY_KEY, String(val));
}

// Soft ramp threshold — past this many ratings we hide the "rate to personalize"
// banner. Personalization itself kicks in from rating #1; this number only
// controls the banner UI, NOT whether the backend sees the user's signals.
//
// Was 5 — dropped to 3 so the user sees real momentum (and a real reward
// for finishing) within the first minute, matching the "Rate a few tracks"
// copy in OnboardingModal's value-prop card.
const PERSONALIZATION_RAMP = 3;

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
    } catch { /* ignore */ }
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
  const url = `${window.location.origin}/track/${track.id}`;
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
    <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
      <div style={{
        height: "100%", borderRadius: 2,
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

// ── Individual discover card ──────────────────────────────────────────────────
function DiscoverCard({ track, isActive, onRate, onReview, onDislike, onEntityClick, userRating, cardIndex, totalCards, onNext, onPrev }) {
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
  const [submitted, setSubmitted] = useState(false);
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
    setSubmitted(false);
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

  async function handleSubmitReview() {
    if (!reviewText.trim()) return;
    const ok = await onReview(track, reviewText.trim(), ratedValue);
    if (ok) {
      setSubmitted(true);
      setReviewOpen(false);
    } else {
      setReviewError("Couldn't save. Try again.");
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

  // Prefer Apple Music's 1200×1200 render when we have it (sharper on
  // high-DPR phones than Spotify's 640×640 ceiling). Falls back to the
  // Spotify image immediately so the card paints something while Apple's
  // match request is in flight; the swap-on-arrival is a no-op visually
  // since both URLs point at the same cover.
  const coverImage = appleArtworkUrl || effectiveImage;

  return (
    <div style={{
      height: "100%",
      display: "flex", flexDirection: "column",
      position: "relative", overflow: "hidden",
      background: "#0a0a0a",
    }}>
      {/* Album art — top portion. Bumped to 65% of the viewport so the cover
          dominates the page and reads as the visual center, rather than
          sitting in the top half with empty space below. Section is flex-
          centered so the cover img renders at integer pixel positions
          (transform-translate centering was causing sub-pixel anti-alias
          blur on iOS). Backdrop and bottom vignette stay absolute and don't
          participate in flex. decoding="async" + fetchpriority="high" hint
          the browser to commit GPU resources to this image early.

          paddingTop reserves a clean band at the top of the art region for
          the floating chrome (gear button on the page container, "···"
          overflow on the card). Without it those buttons sat right on top
          of the cover image. Absolute children inside this region are
          positioned from the padding-box, so their `top:` values are
          measured from the actual top of the card — but the cover itself
          is flex-centered in the area BELOW the padding, so it's pushed
          down by ~half the padding amount. Net: chrome sits in a clear
          band, cover doesn't get covered. */}
      <div style={{
        flex: "0 0 65%", position: "relative", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
        paddingTop: 48,
      }}>
        {coverImage
          ? <>
              <div aria-hidden style={{
                position: "absolute", inset: "-20px",
                backgroundImage: `url(${coverImage})`,
                backgroundSize: "cover", backgroundPosition: "center",
                filter: "blur(40px) saturate(1.5) brightness(0.45)",
                transform: "scale(1.1)",
              }} />
              <img
                src={coverImage}
                alt={track.album_name}
                decoding="async"
                fetchpriority="high"
                style={{
                  // CSS aspect-ratio only computes a definite size if AT LEAST
                  // ONE dimension is constrained. With width:auto + height:auto
                  // the box defaults to intrinsic 0×0 until image bytes arrive
                  // (then re-flows to natural-image size, capped by max-*).
                  // That re-flow was the "image enlarges visibly when it
                  // loads" bug — the IMG was a 0×0 dot at first paint.
                  //
                  // Pin height to 94% so the layout box is definite from
                  // first paint; aspect-ratio computes width=height, and the
                  // maxWidth: 94% safety-caps it on the rare card where the
                  // section is narrower than tall (very wide aspect-ratio
                  // viewport).
                  height: "94%",
                  aspectRatio: "1 / 1",
                  maxWidth: "94%",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "var(--shadow-hero)",
                  objectFit: "cover",
                  position: "relative", zIndex: 1,
                  // Sharper upscale on Safari. Spotify's source images cap at
                  // 640×640 and on high-DPR phones (3x) the cover renders at
                  // ~1200px target, which means the browser is upsampling.
                  // optimize-contrast nudges Safari toward a sharper filter.
                  imageRendering: "-webkit-optimize-contrast",
                }}
              />
              {/* Bottom vignette — fades the art into the metadata strip
                  so the section seam disappears. */}
              <div aria-hidden style={{
                position: "absolute", left: 0, right: 0, bottom: 0,
                height: 80,
                background: "linear-gradient(to bottom, transparent 0%, #0a0a0a 100%)",
                pointerEvents: "none",
                zIndex: 2,
              }} />
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
            </div>
          )}
        </div>
      </div>

      {/* Info + controls — bottom section */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        padding: "14px 24px 12px",
        background: "linear-gradient(to bottom, #0a0a0a, #111)",
        gap: 10, overflowY: "auto",
      }}>

        {/* Track info */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <h2 style={{
              fontSize: 20, fontWeight: 800, margin: 0,
              color: "#fff", lineHeight: 1.2, flex: 1,
              overflow: "hidden", display: "-webkit-box",
              WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>
              {/* Always stay in-app: resolves Deezer tracks to Spotify on
                  click and navigates to the internal track page. Falls back
                  to opening Deezer only if no Spotify equivalent exists. */}
              <a
                href={track._source === "deezer" ? track.external_url : `/track/${track.id}`}
                onClick={(e) => { e.preventDefault(); onEntityClick?.(track, "track"); }}
                style={{ color: "#fff", textDecoration: "none", cursor: "pointer" }}
              >
                {track.name}
              </a>
            </h2>
            {track.explicit && (
              <span style={{ fontSize: 9, background: "rgba(255,255,255,0.15)", borderRadius: 3, padding: "2px 5px", color: "rgba(255,255,255,0.5)", fontWeight: 700, flexShrink: 0, marginTop: 2 }}>E</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <a
              href={track._source === "deezer" ? "#" : `/artist/${track.artist_ids?.[0]}`}
              onClick={(e) => { e.preventDefault(); onEntityClick?.(track, "artist"); }}
              style={{ color: "rgba(255,255,255,0.75)", fontWeight: 600, textDecoration: "none", cursor: "pointer" }}
            >
              {track.artists?.[0]}
            </a>
            {track.album_name && (track._source !== "deezer") && track.album_id && (
              <> · <Link to={`/album/${track.album_id}`} style={{ color: "rgba(255,255,255,0.6)", textDecoration: "none" }}>{track.album_name}</Link></>
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
          // Spotify's embed renders its own dark-themed player UI we can't restyle
          // (cross-origin). Wrapping it in a rounded container with our tokens at
          // least snaps the corners to the rest of the card's radius vocabulary,
          // and gives the widget a tiny breathing margin so it doesn't read as
          // crammed against the rating row below.
          <div style={{
            borderRadius: "var(--radius)",
            overflow: "hidden",
            background: "rgba(255,255,255,0.04)",
          }}>
            <iframe
              src={`https://open.spotify.com/embed/track/${track.id}?utm_source=generator&theme=0`}
              width="100%"
              height="70"
              style={{ border: "none", display: "block" }}
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              title={`${track.name} preview`}
            />
          </div>
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
                    borderRadius: 6, padding: "3px 9px", cursor: "pointer",
                  }}
                >
                  Couldn't save · Retry
                </button>
              )}
            </div>
          )}
        </div>

        {/* Review */}
        {user && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!reviewOpen && !submitted && (
              <button
                onClick={() => { setReviewOpen(true); setReviewError(""); }}
                style={{
                  alignSelf: "flex-start", fontSize: 12, color: "rgba(255,255,255,0.45)",
                  background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 6, padding: "5px 14px", cursor: "pointer",
                  letterSpacing: "0.01em",
                }}
              >
                Write a review
              </button>
            )}
            {submitted && (
              <span style={{ fontSize: 12, color: ACCENT_B, fontWeight: 600 }}>Review posted ✓</span>
            )}
            {reviewOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  autoFocus
                  value={reviewText}
                  onChange={(e) => { setReviewText(e.target.value.slice(0, 2000)); setReviewError(""); }}
                  placeholder="What did you think?"
                  rows={3}
                  style={{
                    width: "100%", padding: "10px 12px", fontSize: 13,
                    background: "rgba(255,255,255,0.07)",
                    border: `1px solid ${reviewError ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.15)"}`,
                    borderRadius: 10, color: "#fff", resize: "none",
                    outline: "none", boxSizing: "border-box",
                  }}
                />
                {reviewError && (
                  <span style={{ fontSize: 11, color: "#f87171" }}>{reviewError}</span>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleSubmitReview}
                    style={{
                      padding: "7px 18px", borderRadius: 20, fontSize: 13, fontWeight: 700,
                      background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                      border: "none", color: "#000", cursor: "pointer",
                    }}
                  >Post</button>
                  <button
                    onClick={() => { setReviewOpen(false); setReviewError(""); }}
                    style={{
                      padding: "7px 14px", borderRadius: 20, fontSize: 13,
                      background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
                      color: "rgba(255,255,255,0.5)", cursor: "pointer",
                    }}
                  >Cancel</button>
                </div>
              </div>
            )}
          </div>
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
              padding: "4px 10px", borderRadius: 6,
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
    </div>
  );
}

// ── Personalization-ramp progress banner ──────────────────────────────────────
// The feed adapts from rating #1; this banner just lets users see that more
// ratings = a stronger signal until they hit the ramp threshold.
//
// Segmented bar (one chunk per remaining rating) instead of a continuous fill
// because discrete chunks read as "I'm 1 of 3 done" rather than "the bar is
// 33% full" — the unit of progress matches the unit of action (one rating =
// one chunk lights up). The lit chunks carry a soft accent glow so a newly
// filled chunk reads as a small reward, not a passive state change.
function ColdStartBanner({ ratingCount }) {
  if (ratingCount >= PERSONALIZATION_RAMP) return null;
  const remaining = PERSONALIZATION_RAMP - ratingCount;
  const label = ratingCount === 0
    ? "Rate a track to tune your feed"
    : remaining === 1
      ? "One more — almost dialed in"
      : `${ratingCount} of ${PERSONALIZATION_RAMP} — feed is sharpening`;

  return (
    <div style={{
      // Right padding bumped to 54px (gear button is 30px wide + 10px right
      // inset + 14px breathing room) so the gear no longer eats the label.
      padding: "8px 54px 8px 16px",
      background: "rgba(167,139,250,0.08)",
      borderBottom: "1px solid rgba(167,139,250,0.15)",
      display: "flex", alignItems: "center", gap: 10,
      flexShrink: 0,
    }}>
      {/* Segmented progress — one chunk per rating up to the ramp */}
      <div style={{ flex: 1, display: "flex", gap: 4, height: 5 }}>
        {Array.from({ length: PERSONALIZATION_RAMP }, (_, i) => {
          const filled = i < ratingCount;
          return (
            <div
              key={i}
              style={{
                flex: 1, borderRadius: 3,
                background: filled
                  ? `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`
                  : "rgba(255,255,255,0.1)",
                boxShadow: filled ? `0 0 6px ${ACCENT_A}80` : "none",
                transition: "background 0.35s ease, box-shadow 0.35s ease",
              }}
            />
          );
        })}
      </div>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap", flexShrink: 0, fontWeight: 600 }}>
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
  const [englishOnly, setEnglishOnly] = useState(loadEnglishOnly);
  const englishOnlyRef = useRef(loadEnglishOnly());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const containerRef = useRef(null);
  const genresRef = useRef(loadGenres());
  const fetchingMoreRef = useRef(false);

  async function fetchBatch(append = false, attempt = 0) {
    if (append && fetchingMoreRef.current) return;
    if (append) fetchingMoreRef.current = true;

    const setter = append ? setLoadingMore : setLoading;
    setter(true);
    setFetchError(false);
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
      // Tell the backend which tracks we've already shown in this scroll
      // session so the next prefetch doesn't repeat them. Only pass on
      // append — a non-append fetch is a deliberate reset (e.g. toggling
      // englishOnly) where we want a fresh batch. Cap at 80 IDs to keep
      // the URL well under any reasonable length limit; that's ~8 batches
      // of memory, far more than needed to mask the Deezer chart cache
      // (which now expires every ~15 min after the signed-URL TTL fix).
      const sessionExclude = append
        ? tracks.slice(-80).map((t) => t.id).filter(Boolean)
        : [];
      const batch = await api.getDiscoverFeed({
        genres: genresRef.current.slice(0, 3),
        liked_artists: likedArtists,
        disliked_artists: dislikedArtists,
        exclude: sessionExclude,
        english_only: englishOnlyRef.current,
        limit: 10,
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

  function toggleEnglishOnly(val) {
    saveEnglishOnly(val);
    englishOnlyRef.current = val;
    setEnglishOnly(val);
    setTracks([]);
    setActiveIdx(0);
    fetchBatch();
  }

  useEffect(() => { fetchBatch(); }, []);

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
      } catch { /* ignore — try next session */ }
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
  const [dragOffset, setDragOffset] = useState(0);
  // `dragging` true → CSS transition disabled (finger follow + atomic commit
  // reset). False → 280ms ease for the snap animation.
  const [dragging, setDragging] = useState(false);
  // Latched true while the snap animation is running so new touchstarts
  // don't interrupt mid-flight.
  const [transitioning, setTransitioning] = useState(false);
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
    // Hard clamp at the deck boundaries — letting dragOffset go positive
    // at the first card would reveal page-bg above the first card (the
    // "extended header black bar" the user reported); same at the end.
    // Tinder behaves the same: at the end of the stack, drag does nothing.
    if (activeIdx === 0 && dy > 0) dy = 0;
    if (activeIdx >= tracks.length - 1 && dy < 0) dy = 0;
    // Convert finger-px to %-of-cardHeight at touchmove time so the wrapper
    // transform can be pure %. Mixing % and px in the calc() expression
    // caused a subpixel mismatch: `100%` resolves to the wrapper's rendered
    // (potentially fractional) height, while JS-measured cardHeight is the
    // integer clientHeight. The 0.5px gap was the "snaps too low / auto-
    // adjusts higher" overshoot at the commit moment.
    const h = cardHeightRef.current || containerRef.current?.clientHeight || 800;
    setDragOffset((dy / h) * 100);
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

    const SWIPE_PX = 50;
    const FLICK_VEL = 0.35;

    if (dy < -SWIPE_PX || (dy < 0 && velocity >= FLICK_VEL)) {
      advance(1);
    } else if (dy > SWIPE_PX || (dy > 0 && velocity >= FLICK_VEL)) {
      advance(-1);
    } else {
      // Sub-threshold — animate back to 0.
      setDragging(false);
      setDragOffset(0);
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

  function advance(direction) {
    if (transitioning) return;
    const target = activeIdx + direction;
    if (target < 0 || target >= tracks.length) {
      setDragging(false);
      setDragOffset(0);
      return;
    }
    setTransitioning(true);
    setDragging(false);                                 // enable CSS transition
    // dragOffset is now a PERCENT of cardHeight (not pixels). One full card
    // height = 100%. Combined with the wrapper transform using pure %,
    // there's no unit mismatch at the commit boundary.
    setDragOffset(direction === 1 ? -100 : 100);

    // Commit atomically when the transition actually finishes — not on a
    // pre-set timer. transitionend fires the frame the wrapper's transform
    // reaches its target value, so there's no animated-but-incomplete
    // state to interrupt.
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      setDragging(true);
      setActiveIdx(target);
      setDragOffset(0);
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
      // cancelled by an intervening style change, etc.). 400ms is comfortably
      // longer than the 240ms transition so it only kicks in on edge cases.
      setTimeout(() => {
        wrapper.removeEventListener("transitionend", onEnd);
        commit();
      }, 400);
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

  async function handleReview(track, body, ratingValue) {
    try {
      const spotifyId = await _resolveSpotifyId(track);
      if (!spotifyId) return false;
      await api.submitReview("track", spotifyId, body, ratingValue);
      analytics.reviewSubmitted("track", body.trim().length);
      return true;
    } catch {
      return false;
    }
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

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "rgba(255,255,255,0.4)" }}>
        Loading…
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
        <div style={{ fontSize: 40 }}>🎵</div>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#fff" }}>
          {fetchError ? "Couldn't reach server" : "Nothing to show right now"}
        </p>

        {/* Spotify-level diagnosis */}
        {debugInfo && spotifyOk === false && (
          <div style={{ padding: "10px 16px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, maxWidth: 300 }}>
            <p style={{ margin: 0, fontSize: 12, color: "#f87171", fontWeight: 700 }}>⚠ Spotify API unreachable</p>
            {spotifyErr && <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{spotifyErr}</p>}
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              Check that SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are set in Railway.
            </p>
          </div>
        )}

        {debugInfo && spotifyOk === true && tier3Ok === false && (
          <div style={{ padding: "10px 16px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, maxWidth: 300 }}>
            <p style={{ margin: 0, fontSize: 12, color: "#f59e0b", fontWeight: 700 }}>⚠ Spotify auth OK but track search failed</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              {tier3Err}
            </p>
          </div>
        )}

        {debugInfo && spotifyOk === true && tier3Ok === true && tier3Count === 0 && (
          <div style={{ padding: "10px 16px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, maxWidth: 300 }}>
            <p style={{ margin: 0, fontSize: 12, color: "#f59e0b", fontWeight: 700 }}>Spotify returned 0 tracks</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              {dislikedCount >= 5 ? `${dislikedCount} artists blocked by your not-interested list.` : "Playlist may be empty or region-restricted."}
            </p>
          </div>
        )}

        {!debugInfo && !fetchError && (
          <p style={{ margin: 0, fontSize: 13, maxWidth: 280, lineHeight: 1.6 }}>
            {dislikedCount >= 5
              ? `You've marked ${dislikedCount} artists as not interested. Try clearing that list to open up more music.`
              : "Diagnosing…"}
          </p>
        )}

        <button
          onClick={() => fetchBatch()}
          style={{
            marginTop: 4, padding: "10px 24px", borderRadius: 20,
            background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
            border: "none", color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}
        >Try again</button>
        {dislikedCount >= 5 && (
          <button
            onClick={clearNotInterested}
            style={{
              padding: "8px 20px", borderRadius: 20, fontSize: 12,
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
            <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Feed Settings
            </span>
            <button onClick={() => setSettingsOpen(false)} style={{ fontSize: 16, background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>✕</button>
          </div>

          {/* English-only toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "#fff", fontWeight: 600 }}>English / Latin songs only</p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                Filters out Cyrillic, Arabic, CJK, and other non-Latin scripts
              </p>
            </div>
            <button
              onClick={() => toggleEnglishOnly(!englishOnly)}
              style={{
                width: 44, height: 24, borderRadius: 12, flexShrink: 0,
                background: englishOnly ? ACCENT_A : "rgba(255,255,255,0.15)",
                border: "none", cursor: "pointer", position: "relative",
                transition: "background 0.2s",
              }}
            >
              <span style={{
                position: "absolute", top: 2, width: 20, height: 20, borderRadius: "50%",
                background: "#fff", transition: "left 0.2s",
                left: englishOnly ? 22 : 2,
              }} />
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
            // Pure-percent transform. dragOffset is stored as %-of-cardHeight
            // (touchmove handler converts the finger's px delta on the way in),
            // so the whole expression resolves consistently against the
            // wrapper's own height. The previous hybrid form `calc(-N*100% +
            // dragOffset_px)` mixed two units; `100%` resolves to the
            // wrapper's rendered (potentially subpixel) height, while
            // dragOffset_px was JS clientHeight (integer), and the half-
            // pixel discrepancy at the commit moment was the "snaps too low
            // first, then auto-adjusts higher" jump the user reported.
            transform: `translate3d(0, ${-activeIdx * 100 + dragOffset}%, 0)`,
            // Snappier ease-out curve (cubic-bezier-iOS-style) + shorter
            // duration so the snap feels closer to Tinder / TikTok's native
            // animation. The previous (0.2, 0, 0, 1) was a linear-snappy
            // curve that lingered slightly at the end; this one decelerates
            // hard from peak velocity for a clean "lock-in" feel.
            transition: dragging ? "none" : "transform 240ms cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
            // contain isolates the deck's rendering from the rest of the
            // page — the compositor can promote it to its own layer with
            // no surprise repaints from outside.
            contain: "layout paint",
          }}
        >
          {tracks.map((track, i) => {
            // Only mount neighbours — render budget stays bounded as the
            // user works through hundreds of swipes.
            if (Math.abs(i - activeIdx) > 1) return null;
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
                <DiscoverCard
                  track={track}
                  isActive={i === activeIdx && !transitioning}
                  onRate={handleRate}
                  onReview={handleReview}
                  onDislike={handleDislike}
                  onEntityClick={handleEntityClick}
                  userRating={userRatings[track.id] ?? null}
                  cardIndex={i}
                  totalCards={tracks.length}
                  onNext={() => goToCard(i + 1)}
                  onPrev={() => goToCard(i - 1)}
                />
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
// coachmark pointing at the Friends + Community tabs.
const LAST_VIEW_FRIENDS = "contour_lastview_friends_v1";
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
  // Internal state values are "discover" / "friends" / "community" — the
  // user-facing rename from "For You" → "Discover" lets the bottom-nav
  // "For You" label keep its meaning of "go to home" without colliding
  // with the home-page sub-tab name.
  const [tab, setTab] = useState("discover");
  const { user } = useAuth();

  // Activity badges + first-launch hint state.
  // `hasNewFriends` / `hasNewCommunity` drive the small purple dot on
  // each tab — set true when the latest activity timestamp on that
  // surface is newer than the user's last viewed-at timestamp (stored
  // in localStorage). Clearing the dot updates the stored timestamp.
  const [hasNewFriends, setHasNewFriends] = useState(false);
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

  // Probe Friends + Community feeds for newer-than-last-viewed activity.
  // Lightweight — pulls the top entry off each endpoint and compares its
  // created_at to the stored "last opened this tab" timestamp.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const feed = await api.getFeed?.();
        if (cancelled) return;
        const newest = feed?.[0]?.created_at ? new Date(feed[0].created_at).getTime() : 0;
        setHasNewFriends(newest > readTs(LAST_VIEW_FRIENDS));
      } catch {}
      try {
        const reviews = await api.getGlobalReviews?.("recent", "all");
        if (cancelled) return;
        const newest = reviews?.[0]?.created_at ? new Date(reviews[0].created_at).getTime() : 0;
        setHasNewCommunity(newest > readTs(LAST_VIEW_COMMUNITY));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Wrapped setTab that also: stamps the last-viewed timestamp and
  // clears the activity badge for the destination tab, plus dismisses
  // the first-launch hint on any tab interaction.
  function selectTab(next) {
    if (showTabsHint) dismissTabsHint();
    if (next === "friends") {
      writeTs(LAST_VIEW_FRIENDS);
      setHasNewFriends(false);
    } else if (next === "community") {
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
    } else {
      document.body.classList.remove("foryou-swipe-mode");
    }
    return () => document.body.classList.remove("foryou-swipe-mode");
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
        top: "env(safe-area-inset-top, 0px)",
        left: 0,
        right: 0,
        bottom: "calc(56px + env(safe-area-inset-bottom, 0px))",
        overflow: "hidden",
        // z 60 puts us ABOVE Layout's header (z 50) so the swipe page can
        // cover it. The bottom-nav (z 50) is outside our `bottom:` clamp so
        // there's no overlap to fight over.
        zIndex: 60,
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
        // Belt-and-suspenders: force the strip onto its own GPU layer so
        // nothing in the content panel paints above it regardless of
        // descendant stacking-context shenanigans.
        isolation: "isolate",
      }}>
        <button style={tabStyle(tab === "discover")} onClick={() => selectTab("discover")}>Discover</button>
        <button style={tabStyle(tab === "friends")} onClick={() => selectTab("friends")}>
          Friends
          {hasNewFriends && tab !== "friends" && activityDot}
        </button>
        <button style={tabStyle(tab === "community")} onClick={() => selectTab("community")}>
          Community
          {hasNewCommunity && tab !== "community" && activityDot}
        </button>
      </div>

      {/* First-launch coachmark — points users at the Friends + Community
          tabs which were previously easy to overlook ("everything I want
          is on Discover, what are these other tabs for?"). Auto-dismisses
          on any tab interaction; explicit X for impatient users. */}
      {showTabsHint && (
        <div style={{
          position: "relative",
          margin: "8px 14px 0",
          padding: "10px 36px 10px 14px",
          background: "rgba(167,139,250,0.12)",
          border: "1px solid rgba(167,139,250,0.35)",
          borderRadius: 10,
          fontSize: 12.5, lineHeight: 1.45,
          color: "rgba(255,255,255,0.85)",
        }}>
          <span style={{ fontWeight: 700, color: ACCENT_A }}>Tip:</span>{" "}
          tap <strong>Friends</strong> to see what people you follow are rating,
          or <strong>Community</strong> for the global review feed.
          <button
            onClick={dismissTabsHint}
            aria-label="Dismiss tip"
            style={{
              position: "absolute", top: 6, right: 8,
              width: 22, height: 22, borderRadius: 11,
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Content — all three panels stay mounted so ForYouFeed never loses
          its track list or scroll position when the user flips tabs.
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
        <div style={{ display: tab === "friends" ? "block" : "none" }}>
          <FollowingTab />
        </div>
        <div style={{ display: tab === "community" ? "block" : "none" }}>
          <GlobalReviewsFeed />
        </div>
      </div>
    </div>
  );
}
