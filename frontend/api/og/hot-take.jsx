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
const WIDTH = 1080;
const HEIGHT = 1350;
const BG = '#08080a';
const TEXT = '#fafafa';
const MUTED = 'rgba(250, 250, 250, 0.55)';
const GOLD = '#f59e0b';
const ACCENT = '#d97a3b';
const DANGER = '#f87171';

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

function fmtStars(value) {
  // "1.5 ★" — same convention as the review card. Tabular nums make the
  // user vs. community comparison line up vertically when the digits
  // differ in width.
  return `${value.toFixed(1)} ★`;
}

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
          <span style={{ fontFamily: 'Instrument Serif', fontSize: 40, color: TEXT }}>Contour</span>
          <span style={{ fontSize: 16, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Hot take
          </span>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, padding: '40px 50px 50px', gap: 48 }}>
          {/* Cover anchors the left, same pattern as the review card */}
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
            {entity.cover_url ? (
              <img src={entity.cover_url} width={420} height={420} style={{ objectFit: 'cover' }} />
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
                {entity.artist ? `${entity.name} · ${entity.artist}` : entity.name}
              </span>

              {/* The take, in big serif. The "★" carries the same visual
                  weight as the number so the eye reads them together. */}
              <p
                style={{
                  fontFamily: 'Instrument Serif',
                  fontSize: 64,
                  lineHeight: 1.1,
                  margin: 0,
                  color: TEXT,
                }}
              >
                {`I gave it ${fmtStars(data.rating)}`}
              </p>

              {/* Community line. Smaller, muted, italic serif so it sits
                  as commentary on the take rather than competing. The
                  count ("from N listeners") adds credibility — this isn't
                  the user being contrarian against one other person. */}
              <p
                style={{
                  fontFamily: 'Instrument Serif',
                  fontStyle: 'italic',
                  fontSize: 32,
                  lineHeight: 1.3,
                  margin: '24px 0 0',
                  color: MUTED,
                }}
              >
                {`Everyone else: ${fmtStars(data.community_avg)} (${data.community_count} listeners)`}
              </p>

              {/* Divergence badge — gold when hotter, danger when cooler.
                  Reads as a "+1.5★ hotter than the room" stat at a glance. */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 28,
                }}
              >
                <span
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    padding: '6px 16px',
                    borderRadius: 999,
                    backgroundColor: `${swingColor}26`,
                    color: swingColor,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {`${isHotter ? '+' : '−'}${Math.abs(data.divergence).toFixed(1)} ★ ${swingWord}`}
                </span>
              </div>
            </div>

            {/* Attribution */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 32 }}>
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
