// Vercel Edge Function — renders a "hot take" shareable card as a PNG.
//
// A hot take is the user's rating that most-diverges from community
// consensus. The card leans into the contrarian identity: big serif
// quote like the review card but the body reads "I gave [Album] X ★"
// with the community average juxtaposed beneath. Same dark editorial
// language as the other cards.
//
// Triggered by /api/og/hot-take?user_id=<id>. The backend picks which
// rating to highlight server-side (most-divergent ≥ 1.0 away from
// community avg, with ≥ 5 community ratings).

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const API_BASE = 'https://contour-production.up.railway.app';
// Square (1:1) — see the same comment in review.tsx. Short take + community
// line + divergence badge collapses to ~700px of actual content; a 1350px
// canvas left a dead zone at the bottom and the `justifyContent:
// space-between` on the column made it worse.
const WIDTH = 1080;
const HEIGHT = 1080;
const BG = '#08080a';
const TEXT = '#fafafa';
const MUTED = 'rgba(250, 250, 250, 0.55)';
const GOLD = '#f59e0b';
const ACCENT = '#d97a3b';
const DANGER = '#f87171';

// SVG star — Satori draws missing-glyph tofu when Unicode ★ (U+2605) is
// rendered in Instrument Serif because the embedded TTF doesn't include
// that codepoint. Inline SVG sidesteps the issue. Same pattern as review.tsx.
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

async function loadFont(family, italic = false) {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital@${italic ? 1 : 0}&display=swap`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } },
  ).then((r) => r.text());
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!match) throw new Error(`Could not extract font URL for ${family}`);
  return fetch(match[1]).then((r) => r.arrayBuffer());
}

const fontPromise = loadFont('Instrument Serif').catch(() => null);
const fontItalicPromise = loadFont('Instrument Serif', true).catch(() => null);

export default async function handler(request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) return new Response('Missing user_id', { status: 400 });

  let data;
  try {
    const res = await fetch(`${API_BASE}/ratings/users/${encodeURIComponent(userId)}/hot-take`);
    if (res.status === 404) return new Response('No hot take to show', { status: 404 });
    if (!res.ok) return new Response('Failed to load hot take', { status: 502 });
    data = await res.json();
  } catch {
    return new Response('Failed to load hot take', { status: 502 });
  }

  const [fontRegular, fontItalic] = await Promise.all([fontPromise, fontItalicPromise]);
  const fonts = [];
  if (fontRegular) fonts.push({ name: 'Instrument Serif', data: fontRegular, weight: 400, style: 'normal' });
  if (fontItalic)  fonts.push({ name: 'Instrument Serif', data: fontItalic,  weight: 400, style: 'italic'  });

  const entity = data.entity;
  const isHotter = data.divergence > 0;       // user rated higher than community
  const swingColor = isHotter ? GOLD : DANGER;
  const swingWord = isHotter ? 'Hotter' : 'Cooler';

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
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '40px 50px 0',
          }}
        >
          <span style={{ fontFamily: 'Instrument Serif', fontSize: 64, color: TEXT, lineHeight: 1, letterSpacing: '-0.01em' }}>Contour</span>
          <span style={{ fontSize: 18, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Hot take
          </span>
        </div>

        {/* Body wrapper — fills remaining vertical space and centers the
            body row, same fix as review.tsx. Cover bumped to 560×560 to
            fill more of the square canvas. */}
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
            {entity.cover_url ? (
              <img src={entity.cover_url} width={560} height={560} style={{ objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex' }} />
            )}
          </div>

          {/* Quote column — vertically centered within the cover's height,
              same fix as review.tsx. Short takes sit in the middle of the
              cover instead of top-anchored with empty space below. */}
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
              {entity.artist ? `${entity.name} · ${entity.artist}` : entity.name}
            </span>

            {/* The take — "I gave it 1.5 ★". Star is a flex-aligned SVG
                next to the number so it renders correctly regardless of
                what's in the embedded TTF. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontFamily: 'Instrument Serif',
                  fontSize: 56,
                  lineHeight: 1.1,
                  color: TEXT,
                }}
              >
                I gave it {data.rating.toFixed(1)}
              </span>
              <StarIcon size={48} color={GOLD} />
            </div>

            {/* Community line — smaller, muted italic serif */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontFamily: 'Instrument Serif',
                  fontStyle: 'italic',
                  fontSize: 28,
                  color: MUTED,
                }}
              >
                Everyone else: {data.community_avg.toFixed(1)}
              </span>
              <StarIcon size={22} color={MUTED} />
              <span
                style={{
                  fontFamily: 'Instrument Serif',
                  fontStyle: 'italic',
                  fontSize: 28,
                  color: MUTED,
                }}
              >
                ({data.community_count} listeners)
              </span>
            </div>

            {/* Divergence badge — gold when hotter, danger when cooler */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 24,
                padding: '8px 16px',
                borderRadius: 999,
                backgroundColor: `${swingColor}26`,
                alignSelf: 'flex-start',
              }}
            >
              <span
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: swingColor,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {isHotter ? '+' : '−'}{Math.abs(data.divergence).toFixed(1)}
              </span>
              <StarIcon size={20} color={swingColor} />
              <span style={{ fontSize: 24, fontWeight: 700, color: swingColor }}>
                {swingWord}
              </span>
            </div>

            {/* Attribution */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 28 }}>
              {data.user.image_url ? (
                <img
                  src={data.user.image_url}
                  width={52}
                  height={52}
                  style={{ borderRadius: 26, objectFit: 'cover' }}
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
                  {(data.user.display_name || '?').slice(0, 1).toUpperCase()}
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
                — {data.user.display_name}
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
      headers: {
        // Hot-take selection changes whenever the user rates something new
        // or the community avg shifts, so a tighter cache than the static
        // review/comparison cards. 5 min absorbs share bursts but doesn't
        // pin stale picks.
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    },
  );
}
