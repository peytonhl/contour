// Vercel Edge Function — renders a shareable review card as a PNG.
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
const WIDTH = 1080;
const HEIGHT = 1350;
const BG = '#08080a';
const TEXT = '#fafafa';
const MUTED = 'rgba(250, 250, 250, 0.55)';
const GOLD = '#f59e0b';
const ACCENT = '#d97a3b';

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

function ratingDisplay(value) {
  // "4.5 ★" rather than rendering five star glyphs — small footprint, no
  // half-star unicode quirks across fonts, and reads cleanly at the
  // ~24pt size we render it.
  if (value == null) return null;
  return `${value.toFixed(1)} ★`;
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
  const rating = ratingDisplay(data.review.rating);
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
              fontSize: 40,
              letterSpacing: '-0.01em',
              color: TEXT,
            }}
          >
            Contour
          </span>
          <span style={{ fontSize: 16, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Review
          </span>
        </div>

        {/* Body row — cover left, quote right */}
        <div style={{ display: 'flex', flex: 1, padding: '40px 50px 50px', gap: 48 }}>
          {/* Cover — square, ~45% width */}
          <div
            style={{
              width: 420,
              height: 420,
              borderRadius: 8,
              overflow: 'hidden',
              flexShrink: 0,
              display: 'flex',
              backgroundColor: '#1a1a1d',
              alignSelf: 'flex-start',
            }}
          >
            {coverUrl ? (
              <img src={coverUrl} width={420} height={420} style={{ objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex' }} />
            )}
          </div>

          {/* Quote column */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Subject: entity name */}
              <span
                style={{
                  fontSize: 22,
                  color: MUTED,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  marginBottom: 18,
                }}
              >
                {entityArtist ? `${entityName} · ${entityArtist}` : entityName}
              </span>

              {/* The quote itself */}
              <p
                style={{
                  fontFamily: 'Instrument Serif',
                  fontSize: 54,
                  lineHeight: 1.15,
                  margin: 0,
                  color: TEXT,
                }}
              >
                {`“${reviewBody}”`}
              </p>
            </div>

            {/* Bottom: rating + attribution */}
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 32 }}>
              {rating && (
                <span style={{ fontSize: 32, color: GOLD, fontWeight: 700, marginBottom: 18 }}>
                  {rating}
                </span>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {authorImage ? (
                  <img
                    src={authorImage}
                    width={56}
                    height={56}
                    style={{
                      borderRadius: 28,
                      objectFit: 'cover',
                    }}
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
