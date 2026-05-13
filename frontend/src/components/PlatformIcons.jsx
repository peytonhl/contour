// Monochrome platform glyphs for "Listen on" pills. Fill via currentColor so
// the icon inherits whatever text color the surrounding link uses.
export function SpotifyIcon({ size = 12 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.84-.179-.96-.539-.12-.421.18-.84.54-.961 4.561-1.02 8.52-.6 11.64 1.32.42.18.479.659.359 1.08zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  );
}

export function AppleMusicIcon({ size = 12 }) {
  // Visual weight is lighter than Spotify/YouTube — bump ~10% so it doesn't
  // look smaller next to them in a row.
  const s = Math.round(size * 0.92);
  return (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M21.5 4.95c0-.85-.7-1.5-1.55-1.4l-12 1.4c-.7.1-1.25.7-1.25 1.4v10.85c-.55-.3-1.2-.45-1.85-.4-1.7.15-2.95 1.5-2.8 3 .15 1.5 1.65 2.6 3.35 2.45 1.7-.15 2.95-1.5 2.8-3V8.2l11-1.3v7.4c-.55-.3-1.2-.45-1.85-.4-1.7.15-2.95 1.5-2.8 3 .15 1.5 1.65 2.6 3.35 2.45 1.7-.15 2.95-1.5 2.8-3V4.95z"/>
    </svg>
  );
}

export function YouTubeIcon({ size = 12 }) {
  // Aspect ratio is wider than tall — render slightly larger so the play mark
  // matches the visual weight of the round Spotify circle.
  const w = Math.round(size * 1.15);
  return (
    <svg viewBox="0 0 24 24" width={w} height={size} fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
}
