// Vercel Edge Function — renders a shareable comparison card as a PNG.
//
// Strategic card type: the only one that markets the era-adjusted-streams
// differentiator. Side-by-side album covers, era-adjusted stream counts as
// the hero stat, and a verdict line ("[winner] wins on era-adjusted
// streams"). Same editorial language as the review card: dark background,
// Instrument Serif headings, no gradients, 4:5 portrait so it fits IG feed
// and Story.
//
// Triggered by /api/og/comparison?id=<saved_comparison_id>.

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const API_BASE = 'https://contour-production.up.railway.app';
const WIDTH = 1080;
const HEIGHT = 1350;
const BG = '#08080a';
const TEXT = '#fafafa';
const MUTED = 'rgba(250, 250, 250, 0.55)';
const ACCENT_A = '#d97a3b';
const ACCENT_B = '#6a90b5';

// Same Instrument Serif loader as the review card — fetched once per cold
// start, reused across invocations.
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

function Side({ side, color, isWinner }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
      }}
    >
      {/* Cover with optional winner ring */}
      <div
        style={{
          width: 360,
          height: 360,
          borderRadius: 10,
          overflow: 'hidden',
          display: 'flex',
          backgroundColor: '#1a1a1d',
          // The accent ring is the only "winner" indicator on the covers
          // themselves — bigger / brighter feels gimmicky on a card. Both
          // covers stay the same size; the era-adjusted number does the
          // talking.
          border: isWinner ? `4px solid ${color}` : '4px solid transparent',
        }}
      >
        {side.cover_url ? (
          <img src={side.cover_url} width={360} height={360} style={{ objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex' }} />
        )}
      </div>

      {/* Name + artist + year */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          padding: '0 16px',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontFamily: 'Instrument Serif',
            fontSize: 36,
            lineHeight: 1.1,
            margin: 0,
            color: TEXT,
            textAlign: 'center',
          }}
        >
          {side.name}
        </p>
        <span style={{ fontSize: 18, color: MUTED, textAlign: 'center' }}>
          {[side.artist, side.release_year].filter(Boolean).join(' · ')}
        </span>
      </div>

      {/* Era-adjusted hero stat. tabular-nums keeps the digits aligned
          between the two sides so the eye can compare them at a glance. */}
      {side.era_adjusted_display ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span
            style={{
              fontFamily: 'Instrument Serif',
              fontSize: 64,
              lineHeight: 1,
              color: color,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {side.era_adjusted_display}
          </span>
          <span style={{ fontSize: 14, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Era-adjusted plays
          </span>
          {side.era_multiplier != null && (
            <span style={{ fontSize: 14, color: MUTED }}>
              ×{side.era_multiplier.toFixed(1)} multiplier
            </span>
          )}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span style={{ fontSize: 24, color: MUTED }}>—</span>
          <span style={{ fontSize: 14, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Era-adjusted plays
          </span>
        </div>
      )}
    </div>
  );
}

export default async function handler(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400 });

  let data;
  try {
    const res = await fetch(`${API_BASE}/comparisons/${encodeURIComponent(id)}/card-data`);
    if (!res.ok) return new Response('Comparison not found', { status: 404 });
    data = await res.json();
  } catch {
    return new Response('Failed to load comparison', { status: 502 });
  }

  const [fontRegular, fontItalic] = await Promise.all([fontPromise, fontItalicPromise]);
  const fonts = [];
  if (fontRegular) fonts.push({ name: 'Instrument Serif', data: fontRegular, weight: 400, style: 'normal' });
  if (fontItalic)  fonts.push({ name: 'Instrument Serif', data: fontItalic,  weight: 400, style: 'italic'  });

  const a = data.a;
  const b = data.b;
  const verdict = data.verdict;
  const winnerId = verdict?.winner_id;
  const winnerName = verdict?.winner_name;

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
          padding: '50px 50px 60px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <span style={{ fontFamily: 'Instrument Serif', fontSize: 40, color: TEXT }}>Contour</span>
          <span
            style={{
              fontSize: 16,
              color: MUTED,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Compared
          </span>
        </div>

        {/* Sides row */}
        <div style={{ display: 'flex', gap: 32, flex: 1, alignItems: 'flex-start' }}>
          <Side side={a} color={ACCENT_A} isWinner={!!winnerId && a.id === winnerId} />
          {/* vs. divider — italic serif feels editorial and doesn't compete
              with the album names. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              alignSelf: 'center',
              fontFamily: 'Instrument Serif',
              fontStyle: 'italic',
              fontSize: 56,
              color: MUTED,
            }}
          >
            vs.
          </div>
          <Side side={b} color={ACCENT_B} isWinner={!!winnerId && b.id === winnerId} />
        </div>

        {/* Verdict — italic serif, single line. Skipped when era-adjustment
            isn't computed yet (enrichment_pending), so the card never makes
            a claim it can't back up. */}
        {winnerName && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginTop: 28,
            }}
          >
            <span
              style={{
                fontFamily: 'Instrument Serif',
                fontStyle: 'italic',
                fontSize: 26,
                color: TEXT,
              }}
            >
              {winnerName} wins on era-adjusted streams.
            </span>
          </div>
        )}
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts,
      headers: {
        'Cache-Control': 'public, immutable, max-age=3600, s-maxage=3600',
      },
    },
  );
}
