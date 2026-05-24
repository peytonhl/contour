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

// Pre-fetch a remote image and inline it as a base64 data URL.
//
// Why: @vercel/og 0.6.4's internal image fetcher couldn't pull from
// i.scdn.co (Spotify's cover CDN) — the wrapper rendered at the
// correct size but the img content came back transparent, leaving
// only the dark placeholder bg visible (repro: review 73, v16/v17).
// Satori either issued the fetch with a UA the CDN rejects or hit
// some Edge-runtime fetch quirk; either way doing the fetch ourselves
// with a permissive UA and handing Satori a `data:` URL sidesteps it.
//
// Returns { url: data-url-or-null, error: string-or-null } so callers
// can surface what happened in debug mode without breaking the card.
async function fetchAsDataUrl(url) {
  if (!url) return { url: null, error: 'no-url' };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Contour/1.0)' },
    });
    if (!res.ok) return { url: null, error: `http-${res.status}` };
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64 = btoa(binary);
    const ct = res.headers.get('content-type') || 'image/jpeg';
    return { url: `data:${ct};base64,${b64}`, error: null };
  } catch (e) {
    return { url: null, error: `exception: ${(e && (e.message || e.name)) || 'unknown'}` };
  }
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

  const reviewBody = truncate(data.review.body, 220);
  const rating = data.review.rating;  // raw number; rendered with inline SVG star below
  const entityName = data.entity.name ?? 'Unknown';
  const entityArtist = data.entity.artist ?? '';
  const authorName = data.author.display_name;

  // Pre-fetch fonts AND the cover/avatar in parallel. The author's
  // image is usually a `data:` URL already (Google profile pic baked
  // in at signup) so fetchAsDataUrl is skipped via the `data:` check.
  // The cover is the one that actually needs the inlining workaround.
  const wrapAlreadyData = (u) => Promise.resolve({ url: u ?? null, error: u ? null : 'no-url' });
  const [fontRegular, fontItalic, coverFetch, authorFetch] = await Promise.all([
    fontPromise,
    fontItalicPromise,
    data.entity.cover_url && !data.entity.cover_url.startsWith('data:')
      ? fetchAsDataUrl(data.entity.cover_url)
      : wrapAlreadyData(data.entity.cover_url),
    data.author.image_url && !data.author.image_url.startsWith('data:')
      ? fetchAsDataUrl(data.author.image_url)
      : wrapAlreadyData(data.author.image_url),
  ]);

  // Debug surface: ?debug=1 returns a JSON dump instead of the PNG so
  // we can confirm what the cover-fetch path actually did. Strips the
  // base64 payload so the response stays readable.
  if (url.searchParams.get('debug') === '1') {
    return new Response(JSON.stringify({
      original_cover_url: data.entity.cover_url,
      original_author_image: data.author.image_url?.slice(0, 80) + (data.author.image_url?.length > 80 ? '…' : ''),
      cover_fetch_error: coverFetch.error,
      cover_fetch_ok: !!coverFetch.url,
      cover_data_url_prefix: coverFetch.url?.slice(0, 60) ?? null,
      author_fetch_error: authorFetch.error,
      author_fetch_ok: !!authorFetch.url,
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const fonts = [];
  if (fontRegular) fonts.push({ name: 'Instrument Serif', data: fontRegular, weight: 400, style: 'normal' });
  if (fontItalic)  fonts.push({ name: 'Instrument Serif', data: fontItalic,  weight: 400, style: 'italic'  });

  const coverUrl = coverFetch.url;
  const authorImage = authorFetch.url;

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
              The inner img needs width/height *in style*, not just as
              HTML attributes — Satori (the satori-based renderer under
              @vercel/og 0.6.4) was rendering the bare <img width=…> at
              0×0 inside this flex wrapper, leaving only the placeholder
              bg visible. Explicit style sizing + display:block fixes it. */}
          <div
            style={{
              width: 440,
              height: 440,
              borderRadius: 8,
              overflow: 'hidden',
              display: 'flex',
              backgroundColor: '#1a1a1d',
              alignSelf: 'center',
              flexShrink: 0,
            }}
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                width={440}
                height={440}
                style={{ width: 440, height: 440, objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex' }} />
            )}
          </div>

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

          {/* The quote — centered, big serif, full canvas width. Sized
              to 44px so a max-length body (220 chars truncated) fits in
              four lines without crashing through the rating row below.
              At 56px (v16) a 178-char review wrapped to 4 lines = 258px,
              which overflowed by ~50px and rendered the rating bar
              on top of the last line. */}
          <p
            style={{
              fontFamily: 'Instrument Serif',
              fontSize: 44,
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
                — {authorName}
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
