// Vercel Edge Function — single-user "taste card" shareable PNG.
//
// /api/og/taste-card?user_id=<id>
//
// The acquisition-mechanic card. Unlike review / comparison / hot-take
// (which need a specific opinion to exist) and taste-match (which needs
// two users), every user with >= 3 ratings can generate one of these.
// Designed to read on its own: someone posting "look at my Contour card"
// should make a stranger want to make theirs.
//
// Visual language matches the sibling cards: 1080×1080 square (same as
// taste-match), dark BG, Instrument Serif headings, no gradients, inline
// SVG star (Instrument Serif has no U+2605 glyph), explicit display:flex
// on every text element (Satori's layout is undefined without it).
//
// Layout:
//   ┌──────────────────────────────────────────┐
//   │ [avatar]  Display name                   │  ← hero
//   │           Taste-label (italic accent)    │
//   ├──────────────────────────────────────────┤
//   │ MOST-LOVED ARTISTS                       │
//   │ [img] [img] [img] [img]                  │  ← signature stat
//   │  name  name  name  name                  │
//   ├──────────────────────────────────────────┤
//   │ LIVES IN THE                             │
//   │ [genre] [genre] [genre] [genre]          │
//   ├──────────────────────────────────────────┤
//   │ N ratings · X.X★ avg     [bar chart]     │
//   │                          Contour         │
//   └──────────────────────────────────────────┘

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const API_BASE = 'https://contour-production.up.railway.app';
const WIDTH = 1080;
const HEIGHT = 1080;
const BG = '#08080a';
const TEXT = '#fafafa';
const MUTED = 'rgba(250, 250, 250, 0.55)';
const SUBTLE = 'rgba(250, 250, 250, 0.10)';
const SURFACE = '#15151a';
const BORDER = 'rgba(250, 250, 250, 0.12)';
const ACCENT = '#d97a3b';
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

function truncate(text: string | null | undefined, max = 24): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

function avatarUrl(user: { display_name?: string; image_url?: string | null }, size = 256): string {
  if (user?.image_url) return user.image_url;
  const name = encodeURIComponent(user?.display_name || '?');
  return `https://ui-avatars.com/api/?name=${name}&background=d97a3b&color=fff&bold=true&size=${size}`;
}

// Spotify ships genres lowercase ("indie rock"). Title-case the first
// letter only — matches the editorial voice across the other cards (the
// taste-match card uses the same "first-letter-only" treatment).
function genrePretty(g: string): string {
  if (!g) return '';
  return g[0].toUpperCase() + g.slice(1);
}

// Inline SVG star — Instrument Serif lacks U+2605, so a Unicode "★"
// renders as a missing-glyph box. Lifted verbatim from taste-match.tsx.
function StarIcon({ size = 20, color = GOLD }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

interface TopArtist {
  id?: string;
  name: string;
  image_url?: string | null;
}

interface CardData {
  user: { id: string; display_name?: string; image_url?: string | null };
  total_ratings: number;
  average_rating: number;
  rating_distribution: Record<string, number>;
  top_genres: string[];
  top_artists: TopArtist[];
  taste_label: string | null;
}

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) return new Response('Missing user_id', { status: 400 });

  let data: CardData;
  try {
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/taste/card-data`);
    if (res.status === 404) return new Response('User not found', { status: 404 });
    if (!res.ok) return new Response('Failed to load taste card data', { status: 502 });
    data = await res.json();
  } catch {
    return new Response('Failed to load taste card data', { status: 502 });
  }

  // Soft floor — accounts with < 3 ratings don't have enough signal to
  // render a useful card. Better to 404 than ship an empty stat sheet
  // that reflects badly on the share. The frontend hides the share CTA
  // below this threshold too, but the 404 protects against direct hits.
  if ((data.total_ratings ?? 0) < 3) {
    return new Response('Not enough ratings yet', { status: 404 });
  }

  const [fontRegular, fontItalic] = await Promise.all([fontPromise, fontItalicPromise]);
  const fonts: any[] = [];
  if (fontRegular) fonts.push({ name: 'Instrument Serif', data: fontRegular, weight: 400, style: 'normal' });
  if (fontItalic) fonts.push({ name: 'Instrument Serif', data: fontItalic, weight: 400, style: 'italic' });

  const user = data.user;
  const topArtists = (data.top_artists || []).slice(0, 4);
  const topGenres = (data.top_genres || []).slice(0, 4);
  const distribution = data.rating_distribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  // Normalize bars against the tallest one so sparse profiles still get
  // a readable shape. Defensive Math.max(1, …) guards divide-by-zero
  // even though the < 3 floor above already catches empty distributions.
  const distMax = Math.max(1, ...Object.values(distribution).map(Number));

  const displayName = truncate(user.display_name, 22) || 'A listener';
  // Hero secondary line. Prefer the taste_label (editorial flair) when
  // available; fall back to the raw average so the card always has a
  // shareable "what's my type" hook in the secondary slot.
  const heroSubline = data.taste_label
    ? data.taste_label
    : `${data.average_rating.toFixed(1)}★ average`;

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
          padding: '52px 56px 44px',
          gap: 28,
        }}
      >
        {/* Hero — avatar + display name + taste label. The taste label
            is the shareable "what's my type" hook, so it gets the big
            italic-serif treatment in accent color. Avatar size mirrors
            taste-match (140px) for visual continuity between the two
            taste cards. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 28,
          }}
        >
          <div
            style={{
              display: 'flex',
              width: 140,
              height: 140,
              borderRadius: '50%',
              overflow: 'hidden',
              border: `4px solid ${ACCENT}`,
              background: SURFACE,
              flexShrink: 0,
            }}
          >
            <img src={avatarUrl(user, 280)} width={140} height={140} style={{ objectFit: 'cover' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                fontFamily: 'Instrument Serif',
                fontSize: 64,
                color: TEXT,
                lineHeight: 1.05,
              }}
            >
              {displayName}
            </div>
            <div
              style={{
                display: 'flex',
                fontFamily: 'Instrument Serif',
                fontStyle: 'italic',
                fontSize: 40,
                color: ACCENT,
                marginTop: 6,
                lineHeight: 1.1,
              }}
            >
              {heroSubline}
            </div>
          </div>
        </div>

        {/* Most-loved artists. Section-header eyebrow + horizontal row of
            circular tiles. Empty-state copy preserves the editorial
            voice even when the user hasn't rated enough to populate. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 16,
              color: MUTED,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              marginBottom: 16,
              fontWeight: 700,
            }}
          >
            Most-loved artists
          </div>
          {topArtists.length === 0 ? (
            <div
              style={{
                display: 'flex',
                fontFamily: 'Instrument Serif',
                fontStyle: 'italic',
                fontSize: 28,
                color: MUTED,
                padding: '20px 0',
              }}
            >
              Still figuring it out…
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 18 }}>
              {topArtists.map((a, i) => (
                <div
                  key={a.id || a.name || i}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      width: 180,
                      height: 180,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      background: SURFACE,
                      border: `1px solid ${BORDER}`,
                    }}
                  >
                    {a.image_url && (
                      <img src={a.image_url} width={180} height={180} style={{ objectFit: 'cover' }} />
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      fontFamily: 'Instrument Serif',
                      fontSize: 24,
                      color: TEXT,
                      textAlign: 'center',
                      lineHeight: 1.15,
                      padding: '0 4px',
                    }}
                  >
                    {truncate(a.name, 16)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Genres — muted pills. Secondary signal under the artist row.
            Hidden entirely when there are none so we don't render an
            empty eyebrow. */}
        {topGenres.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                fontSize: 16,
                color: MUTED,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                marginBottom: 14,
                fontWeight: 700,
              }}
            >
              Lives in the
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {topGenres.map((g) => (
                <div
                  key={g}
                  style={{
                    display: 'flex',
                    fontFamily: 'Instrument Serif',
                    fontSize: 26,
                    color: TEXT,
                    padding: '8px 22px',
                    borderRadius: 999,
                    background: SUBTLE,
                  }}
                >
                  {genrePretty(g)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer — hero stat (total + avg) on the left, mini bar chart
            on the right, Contour wordmark below. mt:auto keeps it
            bottom-anchored so the body can grow without pushing the
            wordmark off-canvas. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 28,
              paddingBottom: 18,
              borderBottom: `1px solid ${BORDER}`,
            }}
          >
            {/* Stat block — total ratings as the magazine-style hero stat
                with the average underneath. tabular-nums keeps the digits
                aligned visually with the bar-chart counts on the right. */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'flex',
                  fontFamily: 'Instrument Serif',
                  fontSize: 88,
                  color: TEXT,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-0.02em',
                }}
              >
                {data.total_ratings.toLocaleString()}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 6,
                  fontSize: 18,
                  color: MUTED,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                <div style={{ display: 'flex' }}>ratings · {data.average_rating.toFixed(1)}</div>
                <StarIcon size={18} color={MUTED} />
                <div style={{ display: 'flex' }}>avg</div>
              </div>
            </div>

            {/* Mini bar chart — five rows, 5★ at top descending. Bars
                normalize against distMax so the shape stays readable
                even when one star bucket dominates. Width-constrained
                (~360px) so the stat block keeps visual priority. */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                width: 360,
              }}
            >
              {[5, 4, 3, 2, 1].map((star) => {
                const count = Number(distribution[star] || 0);
                const widthPct = (count / distMax) * 100;
                return (
                  <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        width: 40,
                        fontSize: 16,
                        color: MUTED,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      <div style={{ display: 'flex' }}>{star}</div>
                      <StarIcon size={12} color={MUTED} />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flex: 1,
                        height: 12,
                        background: SUBTLE,
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          width: `${widthPct}%`,
                          height: '100%',
                          background: GOLD,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        width: 44,
                        fontSize: 14,
                        color: MUTED,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {count}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Wordmark + url. Same shape as taste-match's footer wordmark
              but with the URL beside it so a share recipient knows where
              the artifact came from. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginTop: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontFamily: 'Instrument Serif',
                fontSize: 44,
                color: TEXT,
                lineHeight: 1,
                letterSpacing: '-0.02em',
              }}
            >
              Contour
            </div>
            <div
              style={{
                display: 'flex',
                fontFamily: 'Instrument Serif',
                fontStyle: 'italic',
                fontSize: 22,
                color: MUTED,
              }}
            >
              contour-rosy.vercel.app
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
        // Taste shifts every time the user rates something new, but bursts
        // of shares (same card to multiple chats) should hit the cache.
        // 5 min mirrors hot-take's TTL — same shape of "data changes
        // continuously but bursts are real."
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    },
  );
}
