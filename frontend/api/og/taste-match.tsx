// Vercel Edge Function — shareable head-to-head "taste match" PNG.
//
// /api/og/taste-match?viewer=<user_id>&other=<user_id>
//
// Design v2 (2026-05-20): rebalanced after the user reported v1 felt
// avatar-heavy and the music content was tiny. Avatars shrunk to 120px;
// album covers grow to 220×220 as the visual heroes (it's a music app —
// MUSIC should be the hero, not the faces). Inline SVG star icon
// replaces the Unicode ★ (Instrument Serif doesn't include U+2605, same
// missing-glyph tofu as the review card). Each text element gets an
// explicit `display: flex` because Satori's layout is undefined
// without it.

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const API_BASE = 'https://contour-production.up.railway.app';
const WIDTH = 1080;
const HEIGHT = 1080;
const BG = '#08080a';
const TEXT = '#fafafa';
const MUTED = 'rgba(250, 250, 250, 0.55)';
const SURFACE = '#15151a';
const BORDER = 'rgba(250, 250, 250, 0.12)';
const ACCENT = '#d97a3b';
const ACCENT_B = '#6a90b5';
const GOLD = '#f59e0b';

async function loadFont(family: string, italic = false) {
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

function truncate(text: string | null | undefined, max = 30): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

function avatarUrl(user: { display_name?: string; image_url?: string | null }, size = 256): string {
  if (user?.image_url) return user.image_url;
  const name = encodeURIComponent(user?.display_name || '?');
  return `https://ui-avatars.com/api/?name=${name}&background=7c3aed&color=fff&bold=true&size=${size}`;
}

// Inline SVG star — Instrument Serif doesn't include U+2605 ("★") so a
// Unicode glyph renders as a missing-character box. Same fix as
// review.tsx; lifted here verbatim.
function StarIcon({ size = 28, color = GOLD }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

// One of the two big bottom cards. Album cover dominates; minimal text.
function HighlightCard({
  kind,
  item,
}: {
  kind: 'agreement' | 'fight';
  item: any;
}) {
  const tint = kind === 'agreement' ? GOLD : ACCENT;
  const heading = kind === 'agreement' ? 'Common ground' : 'Great divide';

  // Build the rating-summary string + star color. For agreement we render
  // ONE star + the shared rating; for a fight we render two ratings split
  // by a separator.
  const aRating = Number(item.viewer_rating).toFixed(1);
  const bRating = Number(item.other_rating).toFixed(1);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 20,
        overflow: 'hidden',
        padding: 24,
        gap: 16,
      }}
    >
      {/* Section label */}
      <div
        style={{
          display: 'flex',
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '0.14em',
          color: tint,
          textTransform: 'uppercase',
        }}
      >
        {heading}
      </div>

      {/* Album cover — the hero of each card */}
      <div
        style={{
          display: 'flex',
          width: 220,
          height: 220,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: '#1a1a1d',
          alignSelf: 'center',
        }}
      >
        {item.image_url && (
          <img src={item.image_url} width={220} height={220} style={{ objectFit: 'cover' }} />
        )}
      </div>

      {/* Track / album title */}
      <div
        style={{
          display: 'flex',
          fontFamily: 'Instrument Serif',
          fontSize: 30,
          lineHeight: 1.1,
          color: TEXT,
        }}
      >
        {truncate(item.name, 24)}
      </div>

      {/* Artist */}
      <div
        style={{
          display: 'flex',
          fontSize: 20,
          color: MUTED,
          marginTop: -8,
        }}
      >
        {truncate((item.artists || []).join(', '), 26)}
      </div>

      {/* Rating row — anchored to the bottom */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 'auto',
          paddingTop: 12,
          borderTop: `1px solid ${BORDER}`,
        }}
      >
        <StarIcon size={24} color={tint} />
        {kind === 'agreement' ? (
          <div style={{ display: 'flex', fontSize: 22, color: TEXT, fontWeight: 700 }}>
            Both {aRating}
          </div>
        ) : (
          <div style={{ display: 'flex', fontSize: 22, color: TEXT, fontWeight: 700 }}>
            {aRating} <span style={{ display: 'flex', color: MUTED, padding: '0 8px' }}>vs</span> {bRating}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const viewer = url.searchParams.get('viewer');
  const other = url.searchParams.get('other');
  if (!viewer || !other) {
    return new Response('Missing viewer/other', { status: 400 });
  }

  let data: any;
  try {
    const apiUrl = `${API_BASE}/users/${encodeURIComponent(other)}/taste-match?viewer_id=${encodeURIComponent(viewer)}`;
    const res = await fetch(apiUrl);
    if (!res.ok) return new Response('Match not found', { status: 404 });
    data = await res.json();
  } catch {
    return new Response('Failed to load match', { status: 502 });
  }

  const [fontRegular, fontItalic] = await Promise.all([fontPromise, fontItalicPromise]);
  const fonts: any[] = [];
  if (fontRegular) fonts.push({ name: 'Instrument Serif', data: fontRegular, weight: 400, style: 'normal' });
  if (fontItalic) fonts.push({ name: 'Instrument Serif', data: fontItalic, weight: 400, style: 'italic' });

  const pct = Math.round((data.agreement_pct || 0) * 100);
  const sharedCount = data.shared_count || 0;
  const agreementCount = data.agreement_count || 0;

  const viewerName = truncate(data.viewer?.display_name, 18) || 'You';
  const otherName = truncate(data.other?.display_name, 18) || 'Them';

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
          padding: '40px 50px',
          gap: 22,
        }}
      >
        {/* Top bar — wordmark + eyebrow */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{
            display: 'flex',
            fontFamily: 'Instrument Serif',
            fontSize: 64,
            letterSpacing: '-0.02em',
            color: TEXT,
            lineHeight: 1,
          }}>
            Contour
          </div>
          <div style={{
            display: 'flex',
            fontSize: 22,
            color: MUTED,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}>
            Taste Match
          </div>
        </div>

        {/* Head-to-head — avatars smaller than v1 so they don't compete
            with the album covers for visual hierarchy. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 36,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                display: 'flex',
                width: 120,
                height: 120,
                borderRadius: '50%',
                overflow: 'hidden',
                border: `3px solid ${ACCENT}`,
                background: SURFACE,
              }}
            >
              <img src={avatarUrl(data.viewer, 256)} width={120} height={120} style={{ objectFit: 'cover' }} />
            </div>
            <div style={{ display: 'flex', fontSize: 22, color: TEXT, fontWeight: 600 }}>
              {viewerName}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              fontFamily: 'Instrument Serif',
              fontStyle: 'italic',
              fontSize: 44,
              color: MUTED,
              alignSelf: 'flex-start',
              marginTop: 36,
            }}
          >
            vs
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                display: 'flex',
                width: 120,
                height: 120,
                borderRadius: '50%',
                overflow: 'hidden',
                border: `3px solid ${ACCENT_B}`,
                background: SURFACE,
              }}
            >
              <img src={avatarUrl(data.other, 256)} width={120} height={120} style={{ objectFit: 'cover' }} />
            </div>
            <div style={{ display: 'flex', fontSize: 22, color: TEXT, fontWeight: 600 }}>
              {otherName}
            </div>
          </div>
        </div>

        {/* Stat hero — every text element gets explicit display:flex
            because Satori's layout is undefined without it. v1's
            missing display:flex on the % span made it render inline
            beside the subline instead of stacking. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {sharedCount > 0 ? (
            <>
              <div
                style={{
                  display: 'flex',
                  fontFamily: 'Instrument Serif',
                  fontSize: 140,
                  color: TEXT,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.03em',
                }}
              >
                {pct}%
              </div>
              <div
                style={{
                  display: 'flex',
                  marginTop: 8,
                  fontSize: 20,
                  color: MUTED,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                }}
              >
                Match · {agreementCount} of {sharedCount} shared
              </div>
            </>
          ) : (
            <div
              style={{
                display: 'flex',
                fontFamily: 'Instrument Serif',
                fontStyle: 'italic',
                fontSize: 48,
                color: MUTED,
              }}
            >
              No shared ratings yet
            </div>
          )}
        </div>

        {/* Highlight cards — album covers are 220×220, the visual hero
            of each card. Cards take the full bottom band. */}
        <div
          style={{
            display: 'flex',
            gap: 22,
            marginTop: 'auto',
          }}
        >
          {data.biggest_agreement ? (
            <HighlightCard kind="agreement" item={data.biggest_agreement} />
          ) : (
            <div style={{ flex: 1, display: 'flex' }} />
          )}
          {data.biggest_fight ? (
            <HighlightCard kind="fight" item={data.biggest_fight} />
          ) : (
            <div style={{ flex: 1, display: 'flex' }} />
          )}
        </div>
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
