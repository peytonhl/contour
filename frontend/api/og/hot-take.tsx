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

  // TEMPORARY: `?test=1` short-circuits the backend call with a synthetic
  // payload so the layout can be visually verified without needing a user
  // whose ratings diverge from the community average by ≥1.0★. Remove
  // this branch once the card design is locked.
  const isTest = url.searchParams.get('test') === '1';

  let data;
  if (isTest) {
    data = {
      user: { id: userId, display_name: 'Peyton Lindogan', image_url: null },
      rating: 1.5,
      community_avg: 4.7,
      community_count: 247,
      divergence: -3.2,
      entity: {
        type: 'track',
        id: 'test-entity',
        name: 'Please Please Please',
        artist: 'Sabrina Carpenter',
        cover_url: 'https://i.scdn.co/image/ab67616d0000b273de84adf0e48248ea2d769c3e',
      },
    };
  } else {
    try {
      const res = await fetch(`${API_BASE}/ratings/users/${encodeURIComponent(userId)}/hot-take`);
      if (res.status === 404) return new Response('No hot take to show', { status: 404 });
      if (!res.ok) return new Response('Failed to load hot take', { status: 502 });
      data = await res.json();
    } catch {
      return new Response('Failed to load hot take', { status: 502 });
    }
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
        {/* Header — same wordmark + small caps tag scheme as review.tsx
            for visual consistency between the two card types. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '40px 50px 0',
          }}
        >
          <span style={{ fontFamily: 'Instrument Serif', fontSize: 88, color: TEXT, lineHeight: 1, letterSpacing: '-0.02em' }}>Contour</span>
          <span style={{ fontSize: 26, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Hot take
          </span>
        </div>

        {/* Stacked layout — matches review.tsx v11. Cover sized slightly
            smaller (520 vs 600) because the hot-take has more vertical
            content below it: take line, community line, divergence pill,
            and attribution. */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 60px 48px',
          gap: 28,
        }}>
          {/* Cover — centered, 520×520 */}
          <div
            style={{
              width: 520,
              height: 520,
              borderRadius: 8,
              overflow: 'hidden',
              display: 'flex',
              backgroundColor: '#1a1a1d',
              alignSelf: 'center',
              flexShrink: 0,
            }}
          >
            {entity.cover_url ? (
              <img src={entity.cover_url} width={520} height={520} style={{ objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex' }} />
            )}
          </div>

          {/* Subject — same caps-tracked title/artist as review.tsx v11 */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 32,
                color: TEXT,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                fontWeight: 700,
                textAlign: 'center',
              }}
            >
              {entity.name}
            </span>
            {entity.artist && (
              <span
                style={{
                  fontSize: 24,
                  color: MUTED,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  textAlign: 'center',
                }}
              >
                {entity.artist}
              </span>
            )}
          </div>

          {/* The take + community comparison — centered editorial block.
              "I gave it X.X ★" is the hero line; the community line sits
              just below it as italic commentary. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
              <StarIcon size={46} color={GOLD} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
          </div>

          {/* Divergence badge — the punchline of the card. Centered pill,
              "+1.5 ★ Hotter" or "−2.0 ★ Cooler". Gold when hotter,
              danger color when cooler. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 22px',
              borderRadius: 999,
              backgroundColor: `${swingColor}26`,
              alignSelf: 'center',
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: swingColor,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {isHotter ? '+' : '−'}{Math.abs(data.divergence).toFixed(1)}
            </span>
            <StarIcon size={24} color={swingColor} />
            <span style={{ fontSize: 28, fontWeight: 700, color: swingColor }}>
              {swingWord}
            </span>
          </div>

          {/* Footer — attribution pinned to the bottom with marginTop:auto,
              same pattern as review.tsx v11. Single-cell here (no rating
              to pair with) since the rating is the hero line above. */}
          <div style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            paddingTop: 24,
            borderTop: '1px solid rgba(250, 250, 250, 0.12)',
          }}>
            {data.user.image_url ? (
              <img
                src={data.user.image_url}
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
                {(data.user.display_name || '?').slice(0, 1).toUpperCase()}
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
              — {data.user.display_name}
            </span>
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
