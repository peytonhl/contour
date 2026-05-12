import { useState, useEffect, useRef, useCallback } from "react";
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
const PERSONALIZATION_RAMP = 5;

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

function recordRating(trackId, artistId, rating) {
  const prev = loadHistory();
  const idx = prev.findIndex((h) => h.trackId === trackId);
  if (idx >= 0) {
    prev[idx] = { ...prev[idx], rating, ts: Date.now() };
  } else {
    prev.unshift({ trackId, artistId, rating, ts: Date.now() });
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(prev.slice(0, 300)));
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

  // Apple Music deep-link match — fetched lazily, 404 means no match / service
  // unconfigured, in which case we just don't render the button.
  const [appleMusicUrl, setAppleMusicUrl] = useState(null);
  useEffect(() => {
    setAppleMusicUrl(null);
    if (!track.id) return;
    let cancelled = false;
    api.getAppleMusicLink("track", track.id).then((data) => {
      if (!cancelled && data?.url) setAppleMusicUrl(data.url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [track.id]);
  const [progress, setProgress] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [ratedValue, setRatedValue] = useState(userRating ?? null);
  const [ratingDone, setRatingDone] = useState(!!userRating);
  const [copied, setCopied] = useState(false);
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
    setRatingDone(!!userRating);
    setCopied(false);
  }, [track.id]);

  function togglePlay() {
    if (!track.preview_url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(track.preview_url);
      audioRef.current.ontimeupdate = () => {
        const cur = audioRef.current?.currentTime ?? 0;
        // Cap at 30 s in case browser somehow loads more than the preview
        if (cur >= 30) {
          audioRef.current.pause();
          setPlaying(false);
          setProgress(1);
          return;
        }
        setProgress(cur / 30);
      };
      audioRef.current.onended = () => { setPlaying(false); setProgress(0); };
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
      analytics.forYouTrackPlayed(tierSourceOf(track));
    }
  }

  // Cleanup audio on unmount / track change
  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    };
  }, [track.id]);

  async function handleRate(value) {
    setRatedValue(value);
    setRatingDone(true);
    await onRate(track, value);
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

  return (
    <div style={{
      height: "100%",
      display: "flex", flexDirection: "column",
      position: "relative", overflow: "hidden",
      background: "#0a0a0a",
    }}>
      {/* Album art — top portion (44% leaves room for all controls below) */}
      <div style={{ flex: "0 0 44%", position: "relative", overflow: "hidden" }}>
        {effectiveImage
          ? <>
              <div style={{
                position: "absolute", inset: "-20px",
                backgroundImage: `url(${effectiveImage})`,
                backgroundSize: "cover", backgroundPosition: "center",
                filter: "blur(20px) brightness(0.4)",
              }} />
              <img
                src={effectiveImage}
                alt={track.album_name}
                style={{
                  position: "absolute", top: "50%", left: "50%",
                  transform: "translate(-50%, -50%)",
                  height: "86%", width: "auto", maxWidth: "86%",
                  borderRadius: 12,
                  boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
                  objectFit: "cover",
                }}
              />
            </>
          : <div style={{ width: "100%", height: "100%", background: "var(--surface2)" }} />
        }

        {/* Top-right action row: Share + Spotify */}
        <div style={{
          position: "absolute", top: 14, right: 14,
          display: "flex", gap: 8, alignItems: "center",
        }}>
          <button
            onClick={handleShare}
            title="Share this track"
            style={{
              fontSize: 11, color: copied ? ACCENT_B : "rgba(255,255,255,0.7)",
              background: "rgba(0,0,0,0.45)", borderRadius: 20,
              padding: "4px 10px", border: "none", cursor: "pointer",
              backdropFilter: "blur(4px)",
              display: "flex", alignItems: "center", gap: 5,
              fontWeight: copied ? 700 : 400,
              transition: "color 0.2s",
            }}
          >
            <ShareIcon />
            {copied ? "Copied!" : "Share"}
          </button>
          {/* Platform links — works regardless of which service the user has */}
          <div style={{ display: "flex", gap: 6 }}>
            {track.external_url && (
              <a
                href={track.external_url}
                target="_blank"
                rel="noreferrer"
                onClick={() => analytics.spotifyLinkClicked("track")}
                title="Open in Spotify"
                style={{
                  fontSize: 11, color: "rgba(255,255,255,0.6)",
                  background: "rgba(0,0,0,0.4)", borderRadius: 20,
                  padding: "4px 10px", textDecoration: "none",
                  backdropFilter: "blur(4px)",
                }}
              >
                Spotify ↗
              </a>
            )}
            {appleMusicUrl && (
              <a
                href={appleMusicUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => analytics.appleMusicLinkClicked("track")}
                title="Open in Apple Music"
                style={{
                  fontSize: 11, color: "rgba(255,255,255,0.6)",
                  background: "rgba(0,0,0,0.4)", borderRadius: 20,
                  padding: "4px 10px", textDecoration: "none",
                  backdropFilter: "blur(4px)",
                }}
              >
                Music ↗
              </a>
            )}
            <a
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.name} ${track.artists?.[0] ?? ""}`)}`}
              target="_blank"
              rel="noreferrer"
              title="Search on YouTube"
              style={{
                fontSize: 11, color: "rgba(255,255,255,0.6)",
                background: "rgba(0,0,0,0.4)", borderRadius: 20,
                padding: "4px 10px", textDecoration: "none",
                backdropFilter: "blur(4px)",
              }}
            >
              YT ↗
            </a>
          </div>
        </div>

        {/* Card position indicator */}
        <div style={{
          position: "absolute", top: 14, left: 14,
          fontSize: 10, color: "rgba(255,255,255,0.35)",
          fontWeight: 600, letterSpacing: "0.05em",
        }}>
          {cardIndex + 1} / {totalCards}
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
          <iframe
            src={`https://open.spotify.com/embed/track/${track.id}?utm_source=generator&theme=0`}
            width="100%"
            height="70"
            style={{ borderRadius: 10, border: "none", display: "block" }}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            title={`${track.name} preview`}
          />
        )}

        {/* Rating */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {!user ? (
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>Sign in to rate</p>
          ) : ratingDone ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StarPicker value={ratedValue} onChange={handleRate} disabled={false} />
              <span style={{ fontSize: 12, color: ACCENT_B, fontWeight: 700 }}>Saved ✓</span>
            </div>
          ) : (
            <StarPicker value={ratedValue} onChange={handleRate} disabled={false} />
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

        {/* Not interested */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 2 }}>
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
        </div>

        {/* Swipe hint — shown on first card only */}
        {cardIndex === 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 4, opacity: 0.28 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            <span style={{ fontSize: 11, color: "#fff", letterSpacing: "0.03em" }}>Swipe up for next</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Personalization-ramp progress banner ──────────────────────────────────────
// The feed adapts from rating #1; this banner just lets users see that more
// ratings = a stronger signal until they hit the ramp threshold.
function ColdStartBanner({ ratingCount }) {
  if (ratingCount >= PERSONALIZATION_RAMP) return null;
  const pct = (ratingCount / PERSONALIZATION_RAMP) * 100;
  const label = ratingCount === 0
    ? "Rate a track to start personalizing"
    : `${ratingCount} of ${PERSONALIZATION_RAMP} — feed gets sharper as you rate`;

  return (
    <div style={{
      padding: "8px 16px",
      background: "rgba(167,139,250,0.08)",
      borderBottom: "1px solid rgba(167,139,250,0.15)",
      display: "flex", alignItems: "center", gap: 10,
      flexShrink: 0,
    }}>
      {/* Progress bar */}
      <div style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 2,
          background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
          width: `${pct}%`, transition: "width 0.4s ease",
        }} />
      </div>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap", flexShrink: 0 }}>
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
  const [ratingCount, setRatingCount] = useState(() => getRatingCount());
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
      const batch = await api.getDiscoverFeed({
        genres: genresRef.current.slice(0, 3),
        liked_artists: likedArtists,
        disliked_artists: dislikedArtists,
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

  // Track which card is in view
  useEffect(() => {
    if (!containerRef.current) return;
    const cards = containerRef.current.querySelectorAll("[data-card]");
    if (!cards.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = parseInt(entry.target.dataset.card);
            setActiveIdx(idx);
            // Prefetch the next batch while the user is still 4 cards from the
            // end so it arrives before the loading spinner ever shows.
            if (idx >= tracks.length - 4) fetchBatch(true);
          }
        });
      },
      { root: containerRef.current, threshold: 0.6 },
    );

    cards.forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [tracks.length]);

  // Programmatic card navigation
  const goToCard = useCallback((idx) => {
    if (idx < 0 || idx >= tracks.length) return;
    const container = containerRef.current;
    if (!container) return;
    const card = container.querySelector(`[data-card="${idx}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tracks.length]);

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
    // tracks for 30d, repeated verifications of the same ID are free.
    async function verify(id) {
      if (!id) return false;
      try { await api.getTrack(id); return true; } catch { return false; }
    }

    // Strategy 1: name + artist. Exact-name match (case-insensitive) AND
    // some artist overlap. Take up to 3 candidates and return the first
    // one that verifies.
    try {
      const q1 = `${trackName} ${cleanArtist}`.trim();
      const candidates = (await api.searchTracks(q1) ?? []).filter((t) => {
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
    setUserRatings((prev) => ({ ...prev, [track.id]: value }));
    recordRating(track.id, track.artist_ids?.[0], value);
    setRatingCount(getRatingCount());
    const tier = tierSourceOf(track);
    analytics.forYouRated(tier, value);
    try {
      const spotifyId = await _resolveSpotifyId(track);
      if (!spotifyId) return; // Deezer-only track not on Spotify — skip silently

      // Pass artist_id so the server auto-updates the taste profile on high ratings
      await api.rateEntity("track", spotifyId, value, track.artist_ids?.[0] ?? null);
      analytics.ratingSubmitted("track", spotifyId, value);
      // Also update local genre cache for logged-out / cold-start scenarios
      if (value >= 4 && track.artist_ids?.[0]) {
        api.getArtist(track.artist_ids[0]).then((artist) => {
          artist.genres?.slice(0, 2).forEach((g) => {
            saveGenre(g);
            genresRef.current = loadGenres();
          });
        }).catch(() => {});
      }
    } catch { }
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Cold-start progress banner */}
      <ColdStartBanner ratingCount={ratingCount} />

      {/* Settings toggle row */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 12px", flexShrink: 0 }}>
        <button
          onClick={() => setSettingsOpen(o => !o)}
          title="Feed settings"
          style={{
            fontSize: 14, background: "none", border: "none", cursor: "pointer",
            color: settingsOpen ? ACCENT_A : "rgba(255,255,255,0.3)",
            padding: "4px 6px", transition: "color 0.15s",
          }}
        >⚙</button>
      </div>

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

      {/* Scroll container
          "proximity" snaps when close to a boundary but doesn't trap scroll
          events inside a card, so inner elements (textarea, review section)
          stay scrollable. "mandatory" was causing the lockout. */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: "scroll",
          scrollSnapType: "y proximity",
          scrollBehavior: "smooth",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {tracks.map((track, i) => (
          <div
            key={`${track.id}-${i}`}
            data-card={i}
            style={{ height: "100%", scrollSnapAlign: "start", flexShrink: 0 }}
          >
            <DiscoverCard
              track={track}
              isActive={activeIdx === i}
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
        ))}
        {loadingMore && (
          <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center", scrollSnapAlign: "start" }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Loading more…</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page shell with tabs ──────────────────────────────────────────────────────
export function ForYouPage() {
  const [tab, setTab] = useState("foryou");
  const { user } = useAuth();

  const tabStyle = (active) => ({
    flex: 1, padding: "12px 0", fontSize: 14,
    fontWeight: active ? 700 : 400,
    background: "none", border: "none",
    borderBottom: active ? `2px solid ${ACCENT_A}` : "2px solid transparent",
    color: active ? "#fff" : "rgba(255,255,255,0.45)",
    cursor: "pointer", transition: "all 0.15s",
  });

  // Layout publishes its measured header height as --layout-header-h via
  // ResizeObserver — survives safe-area inset changes, address-bar
  // collapse, and the desktop nav wrapping on narrow viewports. Fallback
  // value covers the brief pre-measurement render before the variable lands.
  const STICKY_TOP = "var(--layout-header-h, 53px)";

  // For the audio-swipe tab we need a fixed-height container so the swipe
  // gesture has room to operate. For the scrollable tabs (Friends, Community)
  // we let the page flow naturally so the document scroll moves them — that's
  // what allows the tab strip's `position: sticky` to actually stick.
  const isSwipe = tab === "foryou";

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      background: "#0a0a0a",
      ...(isSwipe ? { height: "calc(100dvh - 56px)", overflow: "hidden" } : {}),
    }}>
      {/* Three modes — For You (audio swipe), Friends (followed users'
          activity), Community (global review feed). /feed was retired:
          this is the single home for all three discovery modes.

          position: sticky pins the strip below Layout's sticky header as the
          page scrolls (Friends / Community tabs only — the swipe tab has no
          scroll). zIndex 40 sits under Layout's header (50) so the header
          remains the topmost layer if anything overlaps. */}
      <div style={{
        position: "sticky",
        top: STICKY_TOP,
        zIndex: 40,
        display: "flex",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        flexShrink: 0,
        background: "#0a0a0a",
      }}>
        <button style={tabStyle(tab === "foryou")} onClick={() => setTab("foryou")}>For You</button>
        <button style={tabStyle(tab === "friends")} onClick={() => setTab("friends")}>Friends</button>
        <button style={tabStyle(tab === "community")} onClick={() => setTab("community")}>Community</button>
      </div>

      {/* Content — all three panels stay mounted so ForYouFeed never loses
          its track list or scroll position when the user flips tabs. */}
      <div style={{
        position: "relative", background: "var(--bg)",
        ...(isSwipe ? { flex: 1, overflow: "hidden" } : {}),
      }}>
        <div style={{ display: tab === "foryou" ? "flex" : "none", flexDirection: "column", height: "100%" }}>
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
