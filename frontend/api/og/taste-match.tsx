// Vercel Edge Function — renders a shareable "head-to-head taste match" PNG.
//
// Triggered by /api/og/taste-match?viewer=<user_id>&other=<user_id>. The
// frontend share button (TasteMatchPage) feeds this URL into the same
// CardPreviewModal flow used for reviews and hot-takes, so the share /
// save plumbing is identical — only the rendered art differs.
//
// Design: square 1080×1080. Two circular avatars sit at the top of the
// canvas with a serif "vs" between them, the agreement % is the signature
// stat in the middle (matching the magazine-stat treatment of Era Score),
// and the biggest-agreement + biggest-fight picks anchor the bottom as
// two side-by-side mini-cards. Same dark BG + Instrument Serif vocabulary
// as the review card so the brand reads consistently across share types.

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

function truncate(text: string | null | undefined, max = 36): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

// Generated initials avatar fallback (matches the in-app userAvatar helper).
function avatarUrl(user: { display_name?: string; image_url?: string | null }, size = 256): string {
  if (user?.image_url) return user.image_url;
  const name = encodeURIComponent(user?.display_name || '?');
  return `https://ui-avatars.com/api/?name=${name}&background=7c3aed&color=fff&bold=true&size=${size}`;
}

function StarIcon({ size = 28, color = GOLD }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

// One of the two bottom mini-cards. "kind" toggles palette + heading
// between agreement (gold) and fight (orange).
function HighlightCard({
  kind,
  item,
}: {
  kind: 'agreement' | 'fight';
  item: any;
}) {
  const tint = kind === 'agreement' ? GOLD : ACCENT;
  const heading = kind === 'agreement' ? 'Biggest agreement' : 'Biggest fight';
  const subline =
    kind === 'agreement'
      ? `Both ${Number(item.viewer_rating).toFixed(1)}★`
      : `${Number(item.diff ?? Math.abs(item.viewer_rating - item.other_rating)).toFixed(1)}★ apart`;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          padding: '10px 16px',
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: tint,
          textTransform: 'uppercase',
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        {heading}
      </div>
      <div style={{ display: 'flex', padding: 16, gap: 16, alignItems: 'center' }}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 10,
            overflow: 'hidden',
            display: 'flex',
            backgroundColor: '#1a1a1d',
            flexShrink: 0,
          }}
        >
          {item.image_url && (
            <img src={item.image_url} width={96} height={96} style={{ objectFit: 'cover' }} />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 4 }}>
          <span
            style={{
              fontFamily: 'Instrument Serif',
              fontSize: 28,
              color: TEXT,
              lineHeight: 1.15,
              overflow: 'hidden',
            }}
          >
            {truncate(item.name, 28)}
          </span>
          <span style={{ display: 'flex', fontSize: 18, color: MUTED }}>
            {truncate((item.artists || []).join(', '), 32)}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <StarIcon size={20} color={tint} />
            <span style={{ fontSize: 18, fontWeight: 700, color: tint, letterSpacing: '0.04em' }}>
              {subline}
            </span>
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

  const viewerName = truncate(data.viewer?.display_name, 20) || 'You';
  const otherName = truncate(data.other?.display_name, 20) || 'Them';

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
        {/* Top bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '36px 50px 0',
          }}
        >
          <span style={{ fontFamily: 'Instrument Serif', fontSize: 72, letterSpacing: '-0.02em', color: TEXT, lineHeight: 1 }}>
            Contour
          </span>
          <span style={{ fontSize: 28, color: MUTED, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            Taste Match
          </span>
        </div>

        {/* Head-to-head row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 56,
            padding: '36px 50px 0',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 168,
                height: 168,
                borderRadius: '50%',
                overflow: 'hidden',
                display: 'flex',
                border: `4px solid ${ACCENT}`,
                background: SURFACE,
              }}
            >
              <img src={avatarUrl(data.viewer, 256)} width={168} height={168} style={{ objectFit: 'cover' }} />
            </div>
            <span style={{ display: 'flex', fontSize: 24, color: TEXT, fontWeight: 700 }}>
              {viewerName}
            </span>
          </div>
          <span
            style={{
              fontFamily: 'Instrument Serif',
              fontStyle: 'italic',
              fontSize: 56,
              color: MUTED,
            }}
          >
            vs
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 168,
                height: 168,
                borderRadius: '50%',
                overflow: 'hidden',
                display: 'flex',
                border: `4px solid ${ACCENT_B}`,
                background: SURFACE,
              }}
            >
              <img src={avatarUrl(data.other, 256)} width={168} height={168} style={{ objectFit: 'cover' }} />
            </div>
            <span style={{ display: 'flex', fontSize: 24, color: TEXT, fontWeight: 700 }}>
              {otherName}
            </span>
          </div>
        </div>

        {/* Agreement headline — the signature stat. Same Instrument Serif
            magazine-stat treatment as Era Score on the album page. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px 50px 8px',
          }}
        >
          {sharedCount > 0 ? (
            <>
              <span
                style={{
                  fontFamily: 'Instrument Serif',
                  fontSize: 180,
                  color: TEXT,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.02em',
                }}
              >
                {pct}%
              </span>
              <span
                style={{
                  display: 'flex',
                  marginTop: 10,
                  fontSize: 22,
                  color: MUTED,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                }}
              >
                Agreement · {agreementCount} of {sharedCount} shared
              </span>
            </>
          ) : (
            <span
              style={{
                display: 'flex',
                fontFamily: 'Instrument Serif',
                fontStyle: 'italic',
                fontSize: 56,
                color: MUTED,
                textAlign: 'center',
              }}
            >
              No shared ratings yet
            </span>
          )}
        </div>

        {/* Bottom mini-cards. Padded with marginTop: auto so the row hugs
            the bottom of the canvas regardless of stat-headline height. */}
        <div
          style={{
            display: 'flex',
            gap: 20,
            padding: '0 50px 48px',
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
        // 1h edge cache. Match a user with someone, ratings shift over
        // time, but a card someone just shared to iMessage should hit the
        // edge for the burst of clicks that follow. Same TTL as review.tsx.
        'Cache-Control': 'public, immutable, max-age=3600, s-maxage=3600',
      },
    },
  );
}
