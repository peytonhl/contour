// Vercel Edge Function — shareable head-to-head "taste match" PNG.
//
// /api/og/taste-match?viewer=<user_id>&other=<user_id>
//
// Design v3 (2026-05-21): retooled to mirror the actual /taste-match/:id
// page layout. Drops the heavy "Contour / TASTE MATCH" top bar (the page
// has neither — it lets the avatars + stat speak), bumps the avatars to
// 140px with thicker rings for visual weight, and rebuilds HighlightCard
// to match the page's EntityCard:
//
//   ┌──────────────────────────────────────────┐
//   │ BIGGEST AGREEMENT   (tint bg header bar) │
//   ├──────────────────────────────────────────┤
//   │ [img]  Title                             │
//   │  180   Artist                            │
//   │        N ratings on Contour              │
//   ├──────────────────────────────────────────┤
//   │ Viewer  3.0★  |  3.0★ apart  |  3.0★  Other │
//   └──────────────────────────────────────────┘
//
// Brand identifier is a small footer "Contour" wordmark at the bottom.
// Inline SVG star icon kept (Instrument Serif lacks U+2605). Each text
// element retains explicit `display: flex` because Satori's layout is
// undefined without it.

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

function truncate(text: string | null | undefined, max = 32): string {
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

// One of the two bottom cards. Mirrors frontend/src/pages/TasteMatchPage.jsx
// EntityCard structure: tinted section-header bar on top, image-left +
// meta-right body, footer with viewer rating | subline | other rating.
function HighlightCard({
  kind,
  item,
  viewerName,
  otherName,
}: {
  kind: 'agreement' | 'fight';
  item: any;
  viewerName: string;
  otherName: string;
}) {
  const tint = kind === 'agreement' ? GOLD : ACCENT;
  const heading = kind === 'agreement' ? 'Biggest agreement' : 'Biggest fight';

  const aRating = Number(item.viewer_rating).toFixed(1);
  const bRating = Number(item.other_rating).toFixed(1);
  const diff = Math.abs(Number(item.viewer_rating) - Number(item.other_rating)).toFixed(1);
  const subline = kind === 'agreement'
    ? `Both ${aRating}★`
    : `${diff}★ apart`;
  const totalRatings = item.total_ratings ?? 0;

  return (
    <div
      // NO `flex: 1` here — that was a hold-over from v2 when the
      // two cards rendered side-by-side and `flex: 1` made them
      // share horizontal width. In v3 the parent is a vertical
      // column flex container, so `flex: 1` resolves to flex-basis
      // 0 + flex-grow 1 against an unbounded height — both cards
      // collapsed to zero height and produced an empty gap below
      // the stat hero. Letting them size to content (header bar +
      // 180px image-row body + footer triptych) renders them at
      // their natural ~280px each, fitting comfortably in the
      // remaining canvas above the Contour footer.
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      {/* Section header bar — same eyebrow shape as the page's
          EntityCard: uppercase + tracked + tint color, with the tint
          also tinging the background at low alpha for visual weight. */}
      <div
        style={{
          display: 'flex',
          padding: '14px 22px',
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '0.10em',
          color: tint,
          textTransform: 'uppercase',
          borderBottom: `1px solid ${BORDER}`,
          background: kind === 'agreement'
            ? 'rgba(245, 158, 11, 0.08)'
            : 'rgba(217, 122, 59, 0.08)',
        }}
      >
        {heading}
      </div>

      {/* Body: album cover LEFT, title/artist/rating-count RIGHT. */}
      <div style={{ display: 'flex', padding: 22, gap: 20 }}>
        <div
          style={{
            display: 'flex',
            width: 180,
            height: 180,
            borderRadius: 8,
            overflow: 'hidden',
            backgroundColor: '#1a1a1d',
            flexShrink: 0,
          }}
        >
          {item.image_url && (
            <img src={item.image_url} width={180} height={180} style={{ objectFit: 'cover' }} />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, justifyContent: 'center', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              fontFamily: 'Instrument Serif',
              fontSize: 32,
              lineHeight: 1.1,
              color: TEXT,
            }}
          >
            {truncate(item.name, 22)}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 20,
              color: MUTED,
            }}
          >
            {truncate((item.artists || []).join(', '), 26)}
          </div>
          {totalRatings > 0 && (
            <div
              style={{
                display: 'flex',
                fontSize: 16,
                color: MUTED,
                marginTop: 4,
              }}
            >
              {totalRatings} {totalRatings === 1 ? 'rating' : 'ratings'} on Contour
            </div>
          )}
        </div>
      </div>

      {/* Footer: viewer rating | subline | other rating — same triptych
          as the page's EntityCard footer. The middle slot reads as an
          eyebrow / verdict; the side slots own each user's number. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 22px',
          borderTop: `1px solid ${BORDER}`,
          background: '#101013',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <div style={{ display: 'flex', fontSize: 14, color: MUTED }}>
            {truncate(viewerName, 14)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', fontSize: 24, color: ACCENT, fontWeight: 700, fontFamily: 'Instrument Serif' }}>
              {aRating}
            </div>
            <StarIcon size={20} color={ACCENT} />
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 16,
            fontWeight: 700,
            color: tint,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {subline}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <div style={{ display: 'flex', fontSize: 14, color: MUTED }}>
            {truncate(otherName, 14)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', fontSize: 24, color: ACCENT_B, fontWeight: 700, fontFamily: 'Instrument Serif' }}>
              {bRating}
            </div>
            <StarIcon size={20} color={ACCENT_B} />
          </div>
        </div>
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
          padding: '60px 60px 40px',
          gap: 28,
        }}
      >
        {/* Head-to-head — the page's hero. No "Contour / TASTE MATCH"
            bar above it; we keep brand in a small footer below so the
            avatars + stat get full visual weight, matching the page. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 44,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                width: 140,
                height: 140,
                borderRadius: '50%',
                overflow: 'hidden',
                border: `4px solid ${ACCENT}`,
                background: SURFACE,
              }}
            >
              <img src={avatarUrl(data.viewer, 280)} width={140} height={140} style={{ objectFit: 'cover' }} />
            </div>
            <div style={{ display: 'flex', fontSize: 34, color: TEXT, fontWeight: 600 }}>
              {viewerName}
            </div>
          </div>

          {/* "vs" — italic serif, same as the page. Anchor it slightly
              upward so it visually sits between the avatars, not the
              names. */}
          <div
            style={{
              display: 'flex',
              fontFamily: 'Instrument Serif',
              fontStyle: 'italic',
              fontSize: 52,
              color: MUTED,
              alignSelf: 'flex-start',
              marginTop: 52,
            }}
          >
            vs
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                width: 140,
                height: 140,
                borderRadius: '50%',
                overflow: 'hidden',
                border: `4px solid ${ACCENT_B}`,
                background: SURFACE,
              }}
            >
              <img src={avatarUrl(data.other, 280)} width={140} height={140} style={{ objectFit: 'cover' }} />
            </div>
            <div style={{ display: 'flex', fontSize: 34, color: TEXT, fontWeight: 600 }}>
              {otherName}
            </div>
          </div>
        </div>

        {/* Stat hero — wrap conditional in a single explicit flex column
            (Satori's React Fragment handling can collapse stacking
            otherwise). The fontSize echoes the page's 88px scaled up
            to the 1080-wide canvas. */}
        {sharedCount > 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontFamily: 'Instrument Serif',
                fontSize: 170,
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
                fontSize: 30,
                color: MUTED,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
              }}
            >
              Agreement on {agreementCount} of {sharedCount} shared ratings
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '20px 0',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontFamily: 'Instrument Serif',
                fontStyle: 'italic',
                fontSize: 56,
                color: MUTED,
              }}
            >
              No shared ratings yet
            </div>
          </div>
        )}

        {/* Highlight cards — restyled to match the page's EntityCard.
            Stacked vertically on the canvas just like the page (instead
            of side-by-side) so each card has room for the labeled
            header + image-left/meta-right body + bottom rating triptych
            without cramping. */}
        {(data.biggest_agreement || data.biggest_fight) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {data.biggest_agreement && (
              <HighlightCard
                kind="agreement"
                item={data.biggest_agreement}
                viewerName={viewerName}
                otherName={otherName}
              />
            )}
            {data.biggest_fight && (
              <HighlightCard
                kind="fight"
                item={data.biggest_fight}
                viewerName={viewerName}
                otherName={otherName}
              />
            )}
          </div>
        )}

        {/* Footer wordmark — small + bottom-anchored so the brand is
            present without competing with the head-to-head. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: 'auto',
          }}
        >
          <div style={{
            display: 'flex',
            fontFamily: 'Instrument Serif',
            fontSize: 56,
            letterSpacing: '-0.02em',
            color: MUTED,
            lineHeight: 1,
          }}>
            Contour
          </div>
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
