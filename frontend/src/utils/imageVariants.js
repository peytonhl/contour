// Image-size variant helpers — swap Spotify CDN URLs to a smaller/larger
// rendition without re-fetching from the API.
//
// Why this matters: Spotify returns `images: [{640x640}, {300x300}, {64x64}]`
// per asset, but our AlbumCache / TrackCache / ArtistCache only stores the
// first (largest) URL. Pre-this util, a 24×24 avatar on a reply row was
// shipping the full 640×640 cover — ~80KB on the wire for a 24px render.
// On a thread with 30 replies that's ~2.4MB of avatar data on first scroll.
//
// Spotify's i.scdn.co URLs encode the size in a fixed position inside the
// image id. The 8-char chunk that starts at offset 32 of the path is the
// size code:
//   ab67616d0000b273...   640×640   "large"
//   ab67616d00001e02...   300×300   "medium"
//   ab67616d00004851...    64×64    "small"
// The chars BEFORE the size code (the 32-char type prefix) and AFTER the
// size code (the asset hash) stay the same when we swap sizes — same asset,
// different rendition.
//
// Non-Spotify URLs (Apple Music covers from is1-ssl.mzstatic.com, custom
// avatars, etc.) pass through unchanged. If Spotify ever rotates the URL
// scheme, the regex will no longer match and the original URL falls
// through — degraded but never broken.

// Match a Spotify image URL and capture (prefix-up-to-size-code, size-code,
// rest-of-id). Path component is 40 hex chars total — 32 prefix + 8 size code.
// We over-match the prefix length to be defensive against Spotify rotating
// future ID lengths; capture group 2 is anchored to the LAST 8 hex chars
// before the asset-hash tail.
const SPOTIFY_IMAGE_RE = /^(https?:\/\/i\.scdn\.co\/image\/[a-f0-9]{4,})([a-f0-9]{8})([a-f0-9]{32})$/;

const SIZE_CODES = {
  small:  "00004851",   //  64×64 — avatars, dense list rows
  medium: "00001e02",   // 300×300 — entity-list thumbnails, modal previews
  large:  "0000b273",   // 640×640 — hero images, default
};

function variant(url, target) {
  if (!url || typeof url !== "string") return url;
  const match = url.match(SPOTIFY_IMAGE_RE);
  if (!match) return url;
  const code = SIZE_CODES[target];
  if (!code) return url;
  const [, prefix, , hash] = match;
  return `${prefix}${code}${hash}`;
}

// Public helpers. Picked names that read as the rendered size hint at the
// call site, not the wire format.
export function imageThumb(url)  { return variant(url, "small"); }
export function imageMedium(url) { return variant(url, "medium"); }
export function imageLarge(url)  { return variant(url, "large"); }
