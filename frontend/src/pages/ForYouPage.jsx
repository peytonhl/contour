import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api.js";
import { useAuth } from "../contexts/AuthContext.jsx";

// ── Pulled from FeedPage so Following tab reuses the same logic ───────────────
import { FollowingTab } from "./FeedPage.jsx";

const ACCENT_A = "#a78bfa";
const ACCENT_B = "#34d399";
const GOLD = "#f59e0b";

const GENRES_KEY = "contour_genres_v1";
const SEEN_KEY = "contour_seen_v1";

function loadGenres() {
  try { return JSON.parse(localStorage.getItem(GENRES_KEY) || "[]"); } catch { return []; }
}
function saveGenre(genre) {
  const prev = loadGenres();
  if (!prev.includes(genre)) {
    localStorage.setItem(GENRES_KEY, JSON.stringify([genre, ...prev].slice(0, 10)));
  }
}
function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); }
}
function saveSeen(ids) {
  const all = [...loadSeen(), ...ids];
  localStorage.setItem(SEEN_KEY, JSON.stringify(all.slice(-200))); // keep last 200
}

// ── Star rating component ─────────────────────────────────────────────────────
function StarPicker({ value, onChange, disabled }) {
  const [hover, setHover] = useState(null);
  const display = hover ?? value;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          disabled={disabled}
          onClick={() => onChange(n)}
          onMouseEnter={() => !disabled && setHover(n)}
          onMouseLeave={() => !disabled && setHover(null)}
          style={{
            fontSize: 28, background: "none", border: "none", padding: "2px 1px",
            cursor: disabled ? "default" : "pointer",
            color: display >= n ? GOLD : "rgba(255,255,255,0.25)",
            transition: "color 0.1s, transform 0.1s",
            transform: hover === n ? "scale(1.2)" : "scale(1)",
          }}
        >★</button>
      ))}
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

// ── Individual discover card ──────────────────────────────────────────────────
function DiscoverCard({ track, isActive, onRate, onReview, userRating }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [ratedValue, setRatedValue] = useState(userRating ?? null);
  const [ratingDone, setRatingDone] = useState(!!userRating);
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
    setRatedValue(userRating ?? null);
    setRatingDone(!!userRating);
  }, [track.id]);

  function togglePlay() {
    if (!track.preview_url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(track.preview_url);
      audioRef.current.ontimeupdate = () => {
        setProgress(audioRef.current.currentTime / 30);
      };
      audioRef.current.onended = () => {
        setPlaying(false);
        setProgress(0);
      };
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  }

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [track.id]);

  async function handleRate(value) {
    setRatedValue(value);
    setRatingDone(true);
    await onRate(track, value);
  }

  async function handleSubmitReview() {
    if (!reviewText.trim()) return;
    await onReview(track, reviewText.trim(), ratedValue);
    setSubmitted(true);
    setReviewOpen(false);
  }

  const year = track.release_date?.slice(0, 4);

  return (
    <div style={{
      height: "100%", flexShrink: 0,
      scrollSnapAlign: "start",
      display: "flex", flexDirection: "column",
      position: "relative", overflow: "hidden",
      background: "#0a0a0a",
    }}>
      {/* Album art — top half */}
      <div style={{ flex: "0 0 52%", position: "relative", overflow: "hidden" }}>
        {track.image_url
          ? <>
              {/* Blurred background fill */}
              <div style={{
                position: "absolute", inset: "-20px",
                backgroundImage: `url(${track.image_url})`,
                backgroundSize: "cover", backgroundPosition: "center",
                filter: "blur(20px) brightness(0.4)",
              }} />
              {/* Crisp centered art */}
              <img
                src={track.image_url}
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

        {/* Spotify link */}
        {track.external_url && (
          <a
            href={track.external_url}
            target="_blank"
            rel="noreferrer"
            style={{
              position: "absolute", top: 14, right: 14,
              fontSize: 11, color: "rgba(255,255,255,0.6)",
              background: "rgba(0,0,0,0.4)", borderRadius: 20,
              padding: "4px 10px", textDecoration: "none",
              backdropFilter: "blur(4px)",
            }}
          >
            Open ↗
          </a>
        )}
      </div>

      {/* Info + controls — bottom half */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        padding: "20px 24px 16px",
        background: "linear-gradient(to bottom, #0a0a0a, #111)",
        gap: 14,
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
              {track.name}
            </h2>
            {track.explicit && (
              <span style={{ fontSize: 9, background: "rgba(255,255,255,0.15)", borderRadius: 3, padding: "2px 5px", color: "rgba(255,255,255,0.5)", fontWeight: 700, flexShrink: 0, marginTop: 2 }}>E</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <Link to={`/artist/${track.artist_ids?.[0]}`} style={{ color: "rgba(255,255,255,0.75)", fontWeight: 600, textDecoration: "none" }}>
              {track.artists?.[0]}
            </Link>
            {track.album_name && ` · ${track.album_name}`}
            {year && ` · ${year}`}
          </div>
        </div>

        {/* Preview player */}
        {track.preview_url ? (
          // Custom player when Spotify provides a preview URL
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
              {playing ? "⏸" : "▶"}
            </button>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <AudioBar progress={progress} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>30s preview</span>
            </div>
          </div>
        ) : (
          // Spotify embed iframe fallback — works without preview_url
          <iframe
            src={`https://open.spotify.com/embed/track/${track.id}?utm_source=generator&theme=0`}
            width="100%"
            height="80"
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
                onClick={() => setReviewOpen(true)}
                style={{
                  alignSelf: "flex-start", fontSize: 12, color: "rgba(255,255,255,0.45)",
                  background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 20, padding: "5px 14px", cursor: "pointer",
                }}
              >
                ✎ Write a review
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
                  onChange={(e) => setReviewText(e.target.value.slice(0, 2000))}
                  placeholder="What did you think?"
                  rows={3}
                  style={{
                    width: "100%", padding: "10px 12px", fontSize: 13,
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 10, color: "#fff", resize: "none",
                    outline: "none", boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleSubmitReview}
                    style={{
                      padding: "7px 18px", borderRadius: 20, fontSize: 13, fontWeight: 700,
                      background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
                      border: "none", color: "#000", cursor: "pointer",
                    }}
                  >
                    Post
                  </button>
                  <button
                    onClick={() => setReviewOpen(false)}
                    style={{
                      padding: "7px 14px", borderRadius: 20, fontSize: 13,
                      background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
                      color: "rgba(255,255,255,0.5)", cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── For You scroll feed ───────────────────────────────────────────────────────
function ForYouFeed() {
  const { user } = useAuth();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [userRatings, setUserRatings] = useState({});
  const containerRef = useRef(null);
  const seenRef = useRef(loadSeen());
  const genresRef = useRef(loadGenres());
  const fetchingMoreRef = useRef(false); // guard against concurrent fetches

  async function fetchBatch(append = false) {
    if (append && fetchingMoreRef.current) return;
    if (append) fetchingMoreRef.current = true;

    const setter = append ? setLoadingMore : setLoading;
    setter(true);
    setFetchError(false);
    try {
      const batch = await api.getDiscoverFeed({
        genres: genresRef.current.slice(0, 3),
        exclude: [...seenRef.current].slice(0, 100),
        limit: 10,
      });
      saveSeen(batch.map((t) => t.id));
      batch.forEach((t) => seenRef.current.add(t.id));
      setTracks((prev) => append ? [...prev, ...batch] : batch);
    } catch {
      if (!append) setFetchError(true);
    } finally {
      setter(false);
      if (append) fetchingMoreRef.current = false;
    }
  }

  useEffect(() => { fetchBatch(); }, []);

  // IntersectionObserver — track which card is visible
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
            // Load more when 2 cards from end
            if (idx >= tracks.length - 2) {
              fetchBatch(true);
            }
          }
        });
      },
      { root: containerRef.current, threshold: 0.6 }
    );

    cards.forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [tracks.length]);

  async function handleRate(track, value) {
    setUserRatings((prev) => ({ ...prev, [track.id]: value }));
    try {
      await api.rateEntity("track", track.id, value);
      // If 4+ stars, learn the genre from this artist
      if (value >= 4 && track.artist_ids?.[0]) {
        api.getArtist(track.artist_ids[0]).then((artist) => {
          artist.genres?.slice(0, 2).forEach((g) => {
            saveGenre(g);
            genresRef.current = loadGenres();
          });
        }).catch(() => {});
      }
    } catch { /* not logged in or error — rating already shown optimistically */ }
  }

  async function handleReview(track, body, ratingValue) {
    try {
      await api.submitReview("track", track.id, body, ratingValue);
    } catch { }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "rgba(255,255,255,0.4)" }}>
        Loading…
      </div>
    );
  }

  if (!tracks.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, color: "rgba(255,255,255,0.5)", padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>🎵</div>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#fff" }}>
          {fetchError ? "Couldn't load tracks" : "Nothing to show"}
        </p>
        <p style={{ margin: 0, fontSize: 13, maxWidth: 260, lineHeight: 1.6 }}>
          {fetchError
            ? "There was a problem reaching the server. Check your connection and try again."
            : "Spotify's feed may be temporarily unavailable."}
        </p>
        <button
          onClick={() => fetchBatch()}
          style={{
            marginTop: 4, padding: "10px 24px", borderRadius: 20,
            background: `linear-gradient(90deg, ${ACCENT_A}, ${ACCENT_B})`,
            border: "none", color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        overflowY: "scroll",
        scrollSnapType: "y mandatory",
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
            userRating={userRatings[track.id] ?? null}
          />
        </div>
      ))}
      {loadingMore && (
        <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center", scrollSnapAlign: "start" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Loading more…</span>
        </div>
      )}
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

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "calc(100dvh - 56px)", // minus top nav; bottom nav is fixed
      background: "#0a0a0a",
      overflow: "hidden",
    }}>
      {/* Tab bar */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        flexShrink: 0,
        background: "#0a0a0a",
      }}>
        <button style={tabStyle(tab === "foryou")} onClick={() => setTab("foryou")}>For You</button>
        <button style={tabStyle(tab === "following")} onClick={() => setTab("following")}>
          Following {!user && <span style={{ fontSize: 11, opacity: 0.5 }}>(sign in)</span>}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {tab === "foryou" && <ForYouFeed />}
        {tab === "following" && <FollowingTab />}
      </div>
    </div>
  );
}
