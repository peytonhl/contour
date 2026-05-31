import { useState, useEffect } from "react";
import { shareCard, saveCard } from "../utils/share.js";
import { ACCENT_A as ACCENT } from "../theme.js";
import { analytics } from "../services/analytics.js";

// Version stamp appended to every OG card URL. Bump this when the card
// design changes meaningfully — the OG handler sends Cache-Control with
// max-age=3600, and the iOS WebView honors that aggressively (the PNG
// stays cached for up to an hour even after we redeploy the renderer).
// A version param doesn't break Vercel's edge cache because each (id, v)
// pair is its own cache key, so once everyone's on v=N the new key gets
// edge-cached normally; old (id, v=N-1) URLs just go cold.
//
// Bump history:
//  v3 (2026-05-17): square 1080×1080, SVG star, Spotify cover for tracks,
//                   vertically-centered body row, 560×560 cover.
//  v4 (2026-05-17): wordmark 40 → 64, quote column vertically centered
//                   within cover height (no more right-side dead zone).
//  v5 (2026-05-17): inline error surfacing + Media→Share fallback when
//                   the save plugin can't reach the Photos library.
//  v6 (2026-05-17): wordmark 64 → 88, cover 560 → 640, body top-anchored
//                   so canvas fills better (no more empty band above).
//  v7 (2026-05-17): cover 640 → 600, tighter gap/padding to give the
//                   quote column room (v6 was cramping meta + quote).
//  v8 (2026-05-17): cover 600 → 660, vertically center body row again,
//                   quote 48 → 44 so the narrower column doesn't cramp.
//  v9 (2026-05-17): cover 660 → 720 (fills 67% of canvas width), meta
//                   stacked on two lines (title above, artist below) so
//                   long artist names don't break awkwardly. Quote 38px.
//  v10 (2026-05-17): switched from side-by-side to stacked (JQ Adams meme
//                    template). Cover top-centered, meta + quote
//                    centered below, rating + attribution bottom-bar.
//  v11 (2026-05-17): bumped meta (title 22→32, artist 18→24) and REVIEW
//                    tag (20→26) so they carry visual weight against the
//                    600px cover above.
//  v12 (2026-05-17): ported v10/v11 stacked layout to hot-take.tsx so
//                    both card types share a visual language. Hot-take
//                    cover sized 520 (vs review's 600) to leave room for
//                    the take + community + divergence + attribution.
//  v13 (2026-05-17): hot-take overflow fix — cover 520→480, take 56→50,
//                    community 28→26, freeing ~50px so the footer doesn't
//                    touch the divergence pill. Pill bumped 28→32 since
//                    it's the brand punchline.
//  v14 (2026-05-17): bumped meta and tag again — title 32→42, artist
//                    24→28, REVIEW/HOT TAKE 26→34. Cover shrunk to make
//                    room (review 600→560, hot-take 480→440). Also fixed
//                    the misleading "save plugin not available" message
//                    to surface the actual savePhoto error.
//  v15 (2026-05-20): taste-match card redesign. Shrunk avatars 168→120,
//                    grew album covers 96→220 so MUSIC is the visual
//                    hero (not faces). Inline SVG star replaces the
//                    Unicode ★ that rendered as tofu in Instrument Serif.
//                    Explicit display:flex on every text element (Satori
//                    layout was undefined without it — v14's 50% / sub-
//                    line rendered side-by-side instead of stacked).
//  v16 (2026-05-20): v15 still had the side-by-side bug — React Fragment
//                    around the conditional content was breaking column
//                    stacking. Wrap content in an explicit flex column
//                    div. Also: bumped title truncation 24→28 chars (was
//                    cutting "So Easy (To Fall In Love)"), 50% font 140
//                    →160, dropped marginTop:auto on the card row (was
//                    creating a 300px void between stat and cards).
//  v17 (2026-05-24): review.tsx layout fix. 560 cover + 56px quote
//                    (v14/16) overflowed 1080px so the rating row sat
//                    on top of the quote's last line — shrunk to cover
//                    440 / quote 44 / lineHeight 1.2 so a max-truncate
//                    body cleanly fits four lines.
//  v18 (2026-05-24): (misdiagnosis) — chased a "black cover" bug on
//                    review 73 (Donda / Life Of The Party) that turned
//                    out to be a real all-black 640×640 album jacket
//                    rendering correctly. Cover fetch path + debug
//                    surface added in this version were reverted in
//                    v19; only artifact kept is the inset 1px
//                    boxShadow so solid-black covers still have a
//                    visible edge against the card bg.
//  v19 (2026-05-24): added inset boxShadow on cover img + reverted
//                    the unnecessary fetchAsDataUrl pre-fetch and
//                    debug=1 path from v18.
//  v20 (2026-05-24): taste-card layout fix. Previous version stranded
//                    a ~150px black void between genre pills and the
//                    footer because marginTop:auto stretched the
//                    container against an under-filled body. Promoted
//                    rating breakdown to its own full-width section,
//                    folded total+avg into that section's eyebrow
//                    (kills the awkward dual-stat footer), removed
//                    marginTop:auto so content flows naturally. Also
//                    bumped artist tiles 180→210 + names 24→28 so the
//                    most-personality-defining row carries weight.
//                    Backend: deduped Spotify genres case/punctuation-
//                    insensitively so "hip-hop" and "hip hop" stop
//                    rendering as two separate pills.
//  v21 (2026-05-25): taste-card rebalance (tiles 210→160, eyebrows
//                    16→26, artist names 28→32, rating signature-stat
//                    treatment) + review.tsx auto-fit body. Three
//                    brackets: ≤200 chars at 44px / 440 cover,
//                    ≤350 chars at 36px / 440 cover, ≤550 chars at
//                    30px / 400 cover, > 550 chars truncate ellipsis.
//                    OG cards under v=20 were rendering with the old
//                    220-char hard truncate and the "— Author" em-dash
//                    attribution — both still cached by Vercel CDN
//                    + iOS WebView until this bump rotates the key.
const CARD_VERSION = "21";

// Shown when the PNG fetch fails for a reason we can't make actionable
// (genuine 5xx, network blip, deleted entity). "In a moment" is honest here
// because these ARE transient / retryable, unlike the rating-floor case below.
const GENERIC_FETCH_ERROR = "Couldn't generate card. Try again in a moment.";

// Pull the card type out of an OG URL ("/api/og/taste-card?..." → "taste-card")
// so the failure event can be sliced per card in PostHog. Falls back to
// "unknown" for any URL shape we don't recognize.
function cardTypeFromUrl(url) {
  const m = /\/api\/og\/([a-z-]+)/i.exec(url || "");
  return m ? m[1] : "unknown";
}

// Classify a failed card-fetch Response into { message, reason, status }.
// `message` is what the user sees; `reason` + `status` are what we report to
// analytics so we can measure how often (and why) card generation fails.
//
// Most OG endpoints return a plain-text body on error, which maps to the
// generic "try again" line + an http-status-derived reason. The taste-card
// endpoint is special: below the rating floor it returns a STRUCTURED JSON 404
// carrying the live count + threshold, so we render an accurate, actionable
// nudge that counts down as the user rates more (the threshold is owned
// server-side, so this message stays correct across every page even if the
// floor changes) and tag the failure as `not_enough_ratings`.
async function classifyCardError(r) {
  const status = r.status;
  try {
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await r.json();
      if (body?.error === "not_enough_ratings") {
        const remaining = Math.max(
          1,
          (body.threshold ?? 3) - (body.total_ratings ?? 0),
        );
        const noun = remaining === 1 ? "card" : "cards";
        return {
          message: `Rate ${remaining} more ${noun} to unlock your taste card.`,
          reason: "not_enough_ratings",
          status,
        };
      }
    }
  } catch {
    // Body wasn't readable / not the shape we expected — fall through.
  }
  // Map the HTTP status to a coarse reason so failures stay groupable even
  // without a structured body.
  const reason =
    status >= 500 ? "server_error" : status === 404 ? "not_found" : "client_error";
  return { message: GENERIC_FETCH_ERROR, reason, status };
}

/**
 * Modal preview for a shareable PNG card (review / comparison / hot-take).
 *
 * Why a modal preview instead of direct-to-share-sheet:
 *  - Lets the user verify the card looks right before sending — the previous
 *    direct-share flow on iOS Capacitor was silently falling back to URL-only
 *    share, so the user never saw whether a PNG was attached. The modal makes
 *    the artifact visible and the share intent explicit.
 *  - Separates "share" from "save to device" as two clear affordances, which
 *    is what we promised in the product brief ("save to their device OR
 *    directly share in the visual format").
 *
 * The actual share/save dispatch lives in utils/share.js — native path uses
 * @capacitor/share + @capacitor/filesystem, web path uses Web Share Level 2
 * with a download-anchor fallback.
 */
export function CardPreviewModal({
  open,
  onClose,
  cardUrl,
  shareUrl,
  shareText,
  fileName,
}) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);  // "share" | "save" | null
  // Error from the share / save action itself. Distinct from `error`
  // (which only covers the initial PNG fetch); rendered as an inline
  // line below the action buttons so the user sees what went wrong
  // instead of "nothing happens when you tap it".
  const [actionError, setActionError] = useState(null);

  // Append the version stamp so the WebView/browser cache treats new card
  // designs as a fresh URL instead of serving the stale 1080×1350 layout
  // it cached when the design first shipped. Same versioned URL is used
  // for the preview fetch AND the share/save dispatches so the modal
  // preview and the actual shared PNG can't drift apart.
  const versionedCardUrl = cardUrl
    ? cardUrl + (cardUrl.includes("?") ? "&" : "?") + "v=" + CARD_VERSION
    : cardUrl;

  // Fetch the PNG when the modal opens so the user sees the card immediately.
  // Revoke the object URL on close to free memory.
  useEffect(() => {
    if (!open || !versionedCardUrl) return;
    let cancelled = false;
    let createdUrl = null;
    setBlobUrl(null);
    setError(null);

    fetch(versionedCardUrl)
      .then(async (r) => {
        if (!r.ok) {
          const info = await classifyCardError(r);
          const err = new Error(info.message);
          err.cardError = info;  // structured info for the catch → analytics
          throw err;
        }
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((e) => {
        if (cancelled) return;
        // A network/CORS failure rejects before we get a Response, so there's
        // no cardError attached — classify it as network_error with no status.
        const info = e.cardError || {
          message: e.message || GENERIC_FETCH_ERROR,
          reason: "network_error",
          status: null,
        };
        setError(info.message);
        // Measure how often (and why) card generation fails — e.g. new users
        // hitting the taste-card rating floor (reason="not_enough_ratings").
        analytics.cardGenerationFailed(cardTypeFromUrl(cardUrl), info.reason, info.status);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, versionedCardUrl]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Surface errors in the modal instead of swallowing them. Previously a
  // failed save (plugin missing, permission denied, sandbox issue, etc.)
  // produced "nothing happens when you tap it" because every catch was
  // empty — caller and user both blind. Now any failure renders an inline
  // error line below the buttons; cleared on the next tap or modal close.
  // User-cancelled share/save (AbortError on Web Share, Cancel button on
  // share sheet) are filtered out so we don't accuse iOS of failing when
  // the user just changed their mind.
  function isUserCancel(e) {
    const msg = (e && (e.message || e.name || "")) + "";
    return msg.includes("Abort") || msg.includes("cancel") || msg.includes("Cancel");
  }

  async function handleShare() {
    if (busy) return;
    setActionError(null);
    setBusy("share");
    try { await shareCard({ cardUrl: versionedCardUrl, shareUrl, shareText, fileName }); }
    catch (e) {
      if (!isUserCancel(e)) setActionError(`Share failed: ${e?.message || e}`);
    }
    setBusy(null);
  }

  async function handleSave() {
    if (busy) return;
    setActionError(null);
    setBusy("save");
    try {
      const result = await saveCard({ cardUrl: versionedCardUrl, fileName });
      // saveCard returns { status, mediaError? }. "saved" → direct save
      // succeeded (Photos library on native, browser download on web),
      // no message needed. "shared-fallback" → Media.savePhoto rejected
      // for some reason and we routed through the share sheet instead;
      // surface the actual error (not the misleading "plugin not
      // available" copy we shipped previously — the plugin IS in the
      // build, savePhoto just rejected at runtime).
      if (result?.status === "shared-fallback") {
        setActionError(
          result.mediaError
            ? `Direct save threw: ${result.mediaError}. Used share menu — Save Image worked from there.`
            : `Direct save unavailable — used share menu instead.`
        );
      }
    } catch (e) {
      if (!isUserCancel(e)) setActionError(`Save failed: ${e?.message || e}`);
    }
    setBusy(null);
  }

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share your card"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
        paddingTop: "max(env(safe-area-inset-top, 0px), 20px)",
        paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          borderRadius: "var(--radius-xl)",
          maxWidth: 420, width: "100%",
          maxHeight: "100%",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          border: "1px solid var(--border)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: "var(--font-display)",
            fontSize: 20, color: "var(--text)",
          }}>Your card</span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none", border: "none", padding: "4px 8px",
              cursor: "pointer", color: "var(--text-muted)",
              fontSize: 24, lineHeight: 1,
            }}
          >×</button>
        </div>

        {/* Preview */}
        <div style={{
          flex: 1, padding: 16, display: "flex",
          alignItems: "center", justifyContent: "center",
          minHeight: 200, background: "#0a0a0a",
          overflow: "auto",
        }}>
          {error ? (
            <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 20, fontSize: 14 }}>
              {error}
            </div>
          ) : blobUrl ? (
            <img
              src={blobUrl}
              alt="Card preview"
              style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: 4, display: "block" }}
            />
          ) : (
            <div style={{ color: "var(--text-muted)", padding: 20, fontSize: 14 }}>
              Generating your card…
            </div>
          )}
        </div>

        {/* Inline error line — surfaces share/save failures (plugin missing,
            permission denied, fallback used, etc.) so the user can see what
            went wrong instead of nothing-happening on tap. */}
        {actionError && (
          <div style={{
            padding: "10px 16px", borderTop: "1px solid var(--border)",
            color: "var(--danger, #f87171)",
            fontSize: 12, lineHeight: 1.4,
            flexShrink: 0,
          }}>
            {actionError}
          </div>
        )}

        {/* Footer — two CTAs side by side. Save is secondary (outlined) so
            Share reads as the primary action. */}
        <div style={{
          padding: 16, borderTop: "1px solid var(--border)",
          display: "flex", gap: 10, flexShrink: 0,
        }}>
          <button
            onClick={handleSave}
            disabled={!blobUrl || busy !== null}
            style={{
              flex: 1, padding: "12px 16px",
              background: "transparent",
              color: blobUrl ? "var(--text)" : "var(--text-muted)",
              border: `1px solid ${blobUrl ? "var(--border)" : "var(--surface2)"}`,
              borderRadius: "var(--radius-xl)",
              fontSize: 14, fontWeight: 600,
              cursor: (blobUrl && !busy) ? "pointer" : "default",
            }}
          >
            {busy === "save" ? "Saving…" : "Save image"}
          </button>
          <button
            onClick={handleShare}
            disabled={!blobUrl || busy !== null}
            style={{
              flex: 1, padding: "12px 16px",
              background: blobUrl ? ACCENT : "var(--surface2)",
              color: blobUrl ? "#000" : "var(--text-muted)",
              border: "none", borderRadius: "var(--radius-xl)",
              fontSize: 14, fontWeight: 700,
              cursor: (blobUrl && !busy) ? "pointer" : "default",
            }}
          >
            {busy === "share" ? "Sharing…" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}
