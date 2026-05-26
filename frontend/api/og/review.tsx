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

  // Auto-fit font sizing for the review quote. Previously truncated at
  // 220 chars to fit four lines at 44px — but users complained that
  // longer reviews showed up CUT OFF on the share card even though the
  // in-app feed could show more (or be expanded). New approach: scale
  // the font down as the body gets longer, so reviews up to ~800 chars
  // fit in the quote region without truncation.
  //
  // Geometry note (from the v17 comment below): vertical room for the
  // quote ≈ 1080 - cover(440) - subject(~80) - rating(~80) - padding(72)
  // - gaps(96) ≈ 312px. At 44px font + 1.2 line-height = 53px/line, that's
  // ~5 lines. Smaller fonts get more lines.
  //
  // Brackets picked by eye on representative content + worked-example
  // math (chars/line ≈ canvas_width / (font_size * 0.55)). Cap at 800
  // chars — reviews longer than that get an ellipsis. Most reviews are
  // <300 chars in practice; the upper buckets exist for the long-form
  // edge case.
  const rawBody = data.review.body || "";
  const bodyLen = rawBody.length;
  let quoteFontSize: number;
  if (bodyLen <= 200) quoteFontSize = 44;
  else if (bodyLen <= 350) quoteFontSize = 38;
  else if (bodyLen <= 550) quoteFontSize = 32;
  else if (bodyLen <= 800) quoteFontSize = 27;
  else quoteFontSize = 24;
  const reviewBody = truncate(rawBody, 800);
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
              fontSize: 88,
              letterSpacing: '-0.02em',
              color: TEXT,
              lineHeight: 1,
            }}
          >
            Contour
          </span>
          <span style={{ fontSize: 34, color: MUTED, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Review
          </span>
        </div>

        {/* Stacked layout — cover dominates the top half, the editorial
            quote takes the full canvas width below it, and the rating +
            attribution row anchors the bottom. This is the literal JQ
            Adams meme template: image up top, quote in the body,
            attribution underneath. The side-by-side layout we tried
            previously (cover left, narrow text column right) couldn't
            fill the 1080-tall canvas without crushing the quote — covers
            are square, columns can't be wider than ~300px before the
            cover shrinks too far, and stretching the column down past
            the cover's bottom left awkward dead canvas. Stacked
            sidesteps all of that by letting each row use the full width.
        */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 60px 48px',
          gap: 32,
        }}>
          {/* Cover — centered horizontally, 440×440. Shrunk from 560 in
              v17 because 560 + 4-line 56px quote + bottom row literally
              didn't fit in 1080px — the quote was crashing through the
              rating row (see v16 bug repro on review 73, Life of the
              Party). 440 + 44px quote leaves clean spacing.
              The inset boxShadow gives all-black covers (Donda etc.) a
              visible edge against the page bg — without it the cover
              boundary disappears entirely for solid-black artwork. */}
          {coverUrl ? (
            <img
              src={coverUrl}
              width={440}
              height={440}
              style={{
                borderRadius: 8,
                objectFit: 'cover',
                alignSelf: 'center',
                flexShrink: 0,
                boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
              }}
            />
          ) : (
            <div
              style={{
                width: 440,
                height: 440,
                borderRadius: 8,
                backgroundColor: '#1a1a1d',
                alignSelf: 'center',
                flexShrink: 0,
              }}
            />
          )}

          {/* Subject — title centered above the quote, artist below.
              Caps-tracked for the editorial feel. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                fontSize: 42,
                color: TEXT,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                fontWeight: 700,
                textAlign: 'center',
              }}
            >
              {entityName}
            </span>
            {entityArtist && (
              <span
                style={{
                  fontSize: 28,
                  color: MUTED,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  textAlign: 'center',
                }}
              >
                {entityArtist}
              </span>
            )}
          </div>

          {/* The quote — centered, big serif, full canvas width. Font
              size auto-scales by body length (see quoteFontSize above):
              44px for short reviews (≤200 chars), down to 24px for the
              longest (~800 chars). The line-height stays at 1.2 because
              Satori multiplies it against whatever font-size is in
              effect, so vertical bounds scale together with the type.
              Previous v17 used a fixed 44px + 220-char truncate; users
              complained that long reviews showed up cut off on the share
              card even though the in-app feed could expand them. */}
          <p
            style={{
              fontFamily: 'Instrument Serif',
              fontSize: quoteFontSize,
              lineHeight: 1.2,
              margin: 0,
              color: TEXT,
              textAlign: 'center',
            }}
          >
            {`“${reviewBody}”`}
          </p>

          {/* Rating + attribution row — anchored to the bottom of the
              flex column (`marginTop: auto`) so it sits against the
              card's lower edge regardless of how long the quote is. */}
          <div style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 24,
            borderTop: '1px solid rgba(250, 250, 250, 0.12)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {authorImage ? (
                <img
                  src={authorImage}
                  width={56}
                  height={56}
                  style={{ borderRadius: 28, objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: ACCENT,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 28,
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
                  fontSize: 32,
                  color: TEXT,
                }}
              >
                by {authorName}
              </span>
            </div>
            {rating != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    fontFamily: 'Instrument Serif',
                    fontSize: 40,
                    color: GOLD,
                    fontWeight: 400,
                    lineHeight: 1,
                  }}
                >
                  {rating.toFixed(1)}
                </span>
                <StarIcon size={34} color={GOLD} />
              </div>
            )}
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
