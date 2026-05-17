// Vercel Edge Function — renders a shareable review card as a PNG.
//
// Note: this comment line exists to force a Vercel rebuild after the
// 828282d backend cover-preference change. Vercel's edge cache holds OG
// renders for 1h per query; we need a new deployment ID to invalidate it
// so the next /api/og/review?id=X request re-renders against the updated
// Railway backend (which now prefers Spotify covers for tracks).
//
// Triggered by /api/og/review?id=<review_id>. The frontend share button
// fetches this URL and hands the PNG to navigator.share() (Web Share API,
// works on both iOS and Android Capacitor shells without any native plugin).
// The same URL also serves as the og:image for /album/<id> deep-links so
// link previews on social platforms render the card.
//
// Design follows the BACKLOG.md spec — JQ-Adams-meme-style editorial quote:
// album cover anchors the left, big Instrument Serif quote on the right,
// star rating + attribution beneath, Contour wordmark at the top. Dark
// background, no gradients, no busy backgrounds. 4:5 portrait (1080×1350)
// so it fits Instagram feed and IG Story crops without re-export.

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const API_BASE = 'https://contour-production.up.railway.app';
// Square (1:1) instead of 4:5 portrait — the previous 1080×1350 layout used
// `justifyContent: space-between` on the quote column, which pushed the
// rating + attribution to the bottom of the card and left ~600px of dead
// black space in the middle whenever the review body was short. Square
// crops fine for both Instagram feed and Stories (centered crop) and
// avoids the variable-content-height problem entirely.
const WIDTH = 1080;
const HEIGHT = 1080;
const BG = '#08080a';
const TEXT = '#fafafa';
const MUTED = 'rgba(250, 250, 250, 0.55)';
const GOLD = '#f59e0b';
const ACCENT = '#d97a3b';

// Inline SVG star — Satori renders SVG natively, which is more reliable
// than relying on Unicode glyphs being present in the embedded TTF.
// Previously the code used U+2605 "★" rendered in Instrument Serif, and
// Instrument Serif doesn't include that codepoint → Satori drew a missing-
// glyph tofu box. The path below is a standard 5-point star sized to fill
// a 24×24 viewBox, rendered in GOLD wherever it appears.
function StarIcon({ size = 28, color = GOLD }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      style={{ display: 'block' }}
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

// Fetch a Google Font as ArrayBuffer for @vercel/og's `fonts` option.
// Module-level promises so this only runs on cold start, not per request —
// the edge function instance stays warm and reuses these across invocations.
async function loadFont(family, italic = false) {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital@${italic ? 1 : 0}&display=swap`,
    // Google serves a smaller WOFF2 to modern browser UAs but the v0.6 @vercel/og
    // satori bundle expects TTF — spoofing a legacy UA forces the TTF variant.
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } },
  ).then((r) => r.text());
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!match) throw new Error(`Could not extract font URL for ${family}`);
  return fetch(match[1]).then((r) => r.arrayBuffer());
}

const fontPromise = loadFont('Instrument Serif').catch(() => null);
const fontItalicPromise = loadFont('Instrument Serif', true).catch(() => null);

function truncate(text, max = 220) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

export default async function handler(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return new Response('Missing id', { status: 400 });
  }

  let data;
  try {
    const res = await fetch(`${API_BASE}/ratings/reviews/${encodeURIComponent(id)}/card-data`);
    if (!res.ok) return new Response('Review not found', { status: 404 });
    data = await res.json();
  } catch {
    return new Response('Failed to load review', { status: 502 });
  }

  const [fontRegular, fontItalic] = await Promise.all([fontPromise, fontItalicPromise]);
  const fonts = [];
  if (fontRegular) fonts.push({ name: 'Instrument Serif', data: fontRegular, weight: 400, style: 'normal' });
  if (fontItalic)  fonts.push({ name: 'Instrument Serif', data: fontItalic,  weight: 400, style: 'italic'  });

  const reviewBody = truncate(data.review.body, 220);
  const rating = data.review.rating;  // raw number; rendered with inline SVG star below
  const entityName = data.entity.name ?? 'Unknown';
  const entityArtist = data.entity.artist ?? '';
  const coverUrl = data.entity.cover_url;
  const authorName = data.author.display_name;
  const authorImage = data.author.image_url;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: BG,
          color: TEXT,
        }}
      >
        {/* Top bar — Contour wordmark, small */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '40px 50px 0',
          }}
        >
          <span
            style={{
              fontFamily: 'Instrument Serif',
              fontSize: 64,
              letterSpacing: '-0.01em',
              color: TEXT,
              lineHeight: 1,
            }}
          >
            Contour
          </span>
          <span style={{ fontSize: 18, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Review
          </span>
        </div>

        {/* Body wrapper — fills the remaining vertical space below the
            header and centers the body row vertically. With a square card
            and a compact body row (cover + quote column), the previous
            top-anchored layout left ~500px of dead canvas at the bottom;
            vertical centering balances that empty space top/bottom instead.
            Cover sized up to 560×560 to fill more of the canvas without
            overpowering the quote. */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 50px 50px' }}>
        <div style={{ display: 'flex', gap: 44, width: '100%' }}>
          <div
            style={{
              width: 560,
              height: 560,
              borderRadius: 8,
              overflow: 'hidden',
              flexShrink: 0,
              display: 'flex',
              backgroundColor: '#1a1a1d',
              alignSelf: 'flex-start',
            }}
          >
            {coverUrl ? (
              <img src={coverUrl} width={560} height={560} style={{ objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex' }} />
            )}
          </div>

          {/* Quote column — vertically centered within the cover's height
              (the row's `display: flex` stretches the column to match the
              cover's 560px), so a short review sits in the middle of the
              cover instead of pinned to the top with empty space below. */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            {/* Subject: entity name */}
            <span
              style={{
                fontSize: 20,
                color: MUTED,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                marginBottom: 16,
              }}
            >
              {entityArtist ? `${entityName} · ${entityArtist}` : entityName}
            </span>

            {/* The quote itself. Smaller (48px vs 54px) so a full 220-char
                review still fits comfortably alongside the cover. */}
            <p
              style={{
                fontFamily: 'Instrument Serif',
                fontSize: 48,
                lineHeight: 1.15,
                margin: 0,
                color: TEXT,
              }}
            >
              {`“${reviewBody}”`}
            </p>

            {/* Rating — number in Instrument Serif + inline SVG star
                (Unicode ★ rendered as tofu because the embedded Serif
                font doesn't include U+2605). */}
            {rating != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 28 }}>
                <span
                  style={{
                    fontFamily: 'Instrument Serif',
                    fontSize: 36,
                    color: GOLD,
                    fontWeight: 400,
                    lineHeight: 1,
                  }}
                >
                  {rating.toFixed(1)}
                </span>
                <StarIcon size={30} color={GOLD} />
              </div>
            )}

            {/* Attribution */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 24 }}>
              {authorImage ? (
                <img
                  src={authorImage}
                  width={52}
                  height={52}
                  style={{
                    borderRadius: 26,
                    objectFit: 'cover',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: ACCENT,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 26,
                    fontWeight: 700,
                    color: BG,
                  }}
                >
                  {(authorName || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
              <span
                style={{
                  fontFamily: 'Instrument Serif',
                  fontStyle: 'italic',
                  fontSize: 30,
                  color: TEXT,
                }}
              >
                — {authorName}
              </span>
            </div>
          </div>
        </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts,
      // Cache on Vercel's edge for 1h. Reviews can be edited so we don't
      // want a long cache, but bursts of shares (e.g. someone posts a
      // review to a group chat) should hit the cache rather than re-render.
      headers: {
        'Cache-Control': 'public, immutable, max-age=3600, s-maxage=3600',
      },
    },
  );
}
